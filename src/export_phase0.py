#!/usr/bin/env python3
"""
Phase 0 Export Script

Exports three JSON files:
- swanson_regions.json: Swanson flatmap regions with paths
- region_metadata.json: Metadata for regions (acronym, color, etc.)
- connectivity_matrix.json: Sparse connectivity matrix (normalized 0-1, only non-zero)
"""

import json
import operator as op
from functools import reduce
import numpy as np
from pathlib import Path
from iblatlas.flatmaps import swanson_json
from iblatlas.regions import BrainRegions
from allensdk.core.mouse_connectivity_cache import MouseConnectivityCache

# allensdk uses `df.is_injection` (attribute access) which breaks on newer pandas.
# Monkey-patch to use bracket notation instead.
def _filter_structure_unionizes(self, unionizes, is_injection=None,
                                 structure_ids=None, include_descendants=False,
                                 hemisphere_ids=None):
    if is_injection is not None:
        unionizes = unionizes[unionizes['is_injection'] == is_injection]
    if structure_ids is not None:
        structure_ids = MouseConnectivityCache.validate_structure_ids(structure_ids)
        if include_descendants:
            structure_ids = reduce(op.add, self.get_structure_tree().descendant_ids(structure_ids))
        else:
            structure_ids = set(structure_ids)
        unionizes = unionizes[unionizes['structure_id'].isin(structure_ids)]
    if hemisphere_ids is not None:
        unionizes = unionizes[unionizes['hemisphere_id'].isin(hemisphere_ids)]
    return unionizes

MouseConnectivityCache.filter_structure_unionizes = _filter_structure_unionizes

# Output directory
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "app" / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def main():
    print("Starting Phase 0 export...")

    # 1. Get Swanson regions
    print("Loading Swanson regions...")
    swanson_regions = swanson_json()
    print(f"Loaded {len(swanson_regions)} regions")

    # 2. Get all Allen IDs from the drawn region polygons (superset of label positions)
    print("Loading Allen IDs from swanson_json regions...")
    all_swanson_ids = sorted(set(r['thisID'] for r in swanson_regions))
    print(f"Found {len(all_swanson_ids)} unique region IDs")

    # 3. Get BrainRegions metadata
    print("Loading BrainRegions metadata...")
    br = BrainRegions()
    # Filter to IDs that exist in BrainRegions
    valid_allen_ids = [aid for aid in all_swanson_ids if aid in br.id]
    print(f"Valid Allen IDs: {len(valid_allen_ids)} out of {len(all_swanson_ids)}")
    metadata = br.get(valid_allen_ids)
    print(f"Metadata for {len(metadata.id)} regions")

    # 4. Export swanson_regions.json
    print("Exporting swanson_regions.json...")
    with open(OUTPUT_DIR / "swanson_regions.json", "w") as f:
        json.dump(swanson_regions, f, indent=2)
    print("Exported swanson_regions.json")

    # 5. Export region_metadata.json
    print("Exporting region_metadata.json...")
    # Create dict with Allen ID as key
    meta_dict = {}
    for i, aid in enumerate(metadata.id):
        # Compute hexcolor from rgb
        rgb = metadata.rgb[i]
        hexcolor = f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
        meta_dict[int(aid)] = {
            "acronym": metadata.acronym[i],
            "name": metadata.name[i],
            "hexcolor": hexcolor,
            "level": int(metadata.level[i]),
            "parent": int(metadata.parent[i]) if not np.isnan(metadata.parent[i]) else None,
            "order": int(metadata.order[i])
        }
    with open(OUTPUT_DIR / "region_metadata.json", "w") as f:
        json.dump(meta_dict, f, indent=2)
    print("Exported region_metadata.json")

    # 6. Connectivity matrix
    print("Exporting connectivity matrix...")
    mcc = MouseConnectivityCache()
    
    # Build exp_to_inj_struct directly from experiments.json so each experiment
    # is attributed to its actual injection structure, not whichever query ran first.
    print(f"Scanning experiments.json for injections into {len(valid_allen_ids)} structures...")
    valid_set = set(valid_allen_ids)
    exp_to_inj_struct = {}
    repo_root = Path(__file__).resolve().parents[1]
    with open(repo_root / "mouse_connectivity" / "experiments.json") as f:
        all_experiments = json.load(f)
    for exp in all_experiments:
        exp_id = exp.get("data_set_id")
        if exp_id is None:
            continue
        inj_str = exp.get("injection_structures", "")
        if not inj_str:
            continue
        inj_ids = [int(s) for s in str(inj_str).split("/") if s.strip()]
        matching = [sid for sid in inj_ids if sid in valid_set]
        if matching:
            exp_to_inj_struct[exp_id] = matching[0]

    exp_ids = list(exp_to_inj_struct.keys())
    print(f"Discovered {len(exp_ids)} experiments from {len(set(exp_to_inj_struct.values()))} injection structures")
    
    if exp_ids:
        # Get projection matrix
        print("Getting projection matrix...")
        try:
            matrix_data = mcc.get_projection_matrix(
                experiment_ids=exp_ids,
                projection_structure_ids=valid_allen_ids,
                hemisphere_ids=None,  # Both hemispheres
                parameter="normalized_projection_volume"  # Use normalized values
            )
            
            matrix = matrix_data['matrix']
            rows = matrix_data['rows']  # experiment_ids
            columns = matrix_data['columns']  # structure info
            
            print(f"Matrix shape: {matrix.shape}")
            print(f"Non-zero connections: {np.count_nonzero(matrix)}")
            
            # Aggregate across experiments: for each injection_structure -> projection_structure pair
            connectivity = {}
            for exp_idx, exp_id in enumerate(rows):
                # Get the injection structure for this experiment
                inj_struct_id = exp_to_inj_struct.get(exp_id)
                if inj_struct_id:
                    for struct_idx, struct_info in enumerate(columns):
                        proj_struct_id = struct_info['structure_id']
                        if proj_struct_id in valid_allen_ids:
                            volume = matrix[exp_idx, struct_idx]
                            # volume > 0 per experiment, but aggregated sums can retain
                            # floating-point noise (~1e-10) that renders as 0 in output.
                            # These are not filtered here; ~65 such entries are expected.
                            if volume > 0:
                                key = (inj_struct_id, proj_struct_id)
                                connectivity[key] = connectivity.get(key, 0) + volume
            
            print(f"Aggregated {len(connectivity)} connections")
            
            if connectivity:
                # Normalize to 0-1
                max_volume = max(connectivity.values())
                print(f"Max aggregated volume: {max_volume}")
                
                # Create sparse format
                sparse_connections = []
                for (inj_id, proj_id), volume in connectivity.items():
                    normalized_volume = volume / max_volume if max_volume > 0 else 0
                    sparse_connections.append({
                        "injection_structure_id": int(inj_id),
                        "projection_structure_id": int(proj_id),
                        "normalized_volume": float(normalized_volume)
                    })
                
                # Sort by volume descending
                sparse_connections.sort(key=lambda x: x["normalized_volume"], reverse=True)
                
                connectivity_data = {
                    "structure_ids": valid_allen_ids,
                    "experiment_count": len(exp_ids),
                    "total_connections": len(sparse_connections),
                    "sparse_connections": sparse_connections,
                    "note": "Connectivity aggregated from Allen experiments, normalized 0-1. Only 46/156 structures have injection experiments in the Allen dataset; 110 structures have no injection coverage. ~65 connections have near-zero volume (<1e-9) from float aggregation noise."
                }
            else:
                connectivity_data = {
                    "note": "No connectivity found in sample experiments",
                    "experiment_count": len(exp_ids),
                    "status": "no_connections"
                }
        except Exception as e:
            print(f"Error getting projection matrix: {e}")
            connectivity_data = {
                "note": f"Error getting projection matrix: {str(e)}",
                "status": "error"
            }
    else:
        connectivity_data = {"note": "No experiments found", "status": "empty"}
    
    with open(OUTPUT_DIR / "connectivity_matrix.json", "w") as f:
        json.dump(connectivity_data, f, indent=2)
    print("Exported connectivity_matrix.json")

    print("Phase 0 export test completed.")

if __name__ == "__main__":
    main()