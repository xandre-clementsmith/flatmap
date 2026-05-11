#!/usr/bin/env python3
"""
Phase 0 Export Script

Exports three JSON files:
- swanson_regions.json: Swanson flatmap regions with paths
- region_metadata.json: Metadata for regions (acronym, color, etc.)
- connectivity_matrix.json: Sparse connectivity matrix (normalized 0-1, only non-zero)
"""

import json
import numpy as np
from pathlib import Path
from iblatlas.flatmaps import swanson_json, _swanson_labels_positions
from iblatlas.regions import BrainRegions
from allensdk.core.mouse_connectivity_cache import MouseConnectivityCache

# Output directory
OUTPUT_DIR = Path(__file__).parent / "data"
OUTPUT_DIR.mkdir(exist_ok=True)

def main():
    print("Starting Phase 0 export...")

    # 1. Get Swanson regions
    print("Loading Swanson regions...")
    swanson_regions = swanson_json()
    print(f"Loaded {len(swanson_regions)} regions")

    # 2. Get Allen ID mappings
    print("Loading Allen ID mappings...")
    allen_positions = _swanson_labels_positions()
    allen_ids = list(allen_positions.keys())
    print(f"Found {len(allen_ids)} Allen IDs")

    # 3. Get BrainRegions metadata
    print("Loading BrainRegions metadata...")
    br = BrainRegions()
    # Filter to our Allen IDs that exist in BrainRegions
    valid_allen_ids = [aid for aid in allen_ids if aid in br.id]
    print(f"Valid Allen IDs: {len(valid_allen_ids)} out of {len(allen_ids)}")
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
    
    # Get all experiments that inject into any mapped Swanson structures
    print(f"Getting experiments for {len(valid_allen_ids)} structures...")
    exp_to_inj_struct = {}  # Map experiment_id to injection_structure_id
    all_exp_ids = set()
    for struct_id in valid_allen_ids:
        try:
            experiments = mcc.get_experiments(injection_structure_ids=[struct_id])
            if isinstance(experiments, list):
                exp_ids = [e['id'] for e in experiments]
            else:
                exp_ids = experiments.index.tolist()
            for exp_id in exp_ids:
                all_exp_ids.add(exp_id)
                exp_to_inj_struct[exp_id] = struct_id
        except Exception as e:
            print(f"Error getting experiments for structure {struct_id}: {e}")
    
    exp_ids = list(all_exp_ids)
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
                    "note": "Connectivity aggregated from sample experiments, normalized 0-1"
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