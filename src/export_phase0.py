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
import statistics
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


def filter_coordinate_outliers(exp_to_inj_structs, all_experiments, br, k=3.0, min_exps=5):
    """Remove (experiment, structure) pairs where the injection centroid is a 3D outlier.

    For each structure with >= min_exps experiments, computes the median injection
    centroid and excludes experiments farther than median_dist + k*MAD from it.
    Only removes a pair, not the full experiment — a lateral VTA injection may still
    correctly contribute to SNc or MRN.

    Approximation: assumes roughly spherical coordinate distribution per structure.
    More precise fix (CCF annotation volume boundary check) tracked in
    parcellation_mismatches.md §13.
    """
    exp_coords = {}
    for e in all_experiments:
        eid = e.get('data_set_id')
        x, y, z = e.get('injection_x'), e.get('injection_y'), e.get('injection_z')
        if None not in (x, y, z):
            exp_coords[eid] = (float(x), float(y), float(z))

    struct_to_eids = {}
    for eid, sids in exp_to_inj_structs.items():
        for sid in sids:
            struct_to_eids.setdefault(sid, []).append(eid)

    outlier_pairs = set()
    log_lines = []
    for sid, eids in struct_to_eids.items():
        coords = [(eid, exp_coords[eid]) for eid in eids if eid in exp_coords]
        if len(coords) < min_exps:
            continue
        mx = statistics.median(c[0] for _, c in coords)
        my = statistics.median(c[1] for _, c in coords)
        mz = statistics.median(c[2] for _, c in coords)
        dists = {eid: ((cx-mx)**2 + (cy-my)**2 + (cz-mz)**2)**0.5
                 for eid, (cx, cy, cz) in coords}
        dist_vals = list(dists.values())
        med_d = statistics.median(dist_vals)
        mad = statistics.median(abs(d - med_d) for d in dist_vals)
        if mad == 0:
            continue
        threshold = med_d + k * mad
        removed = [eid for eid, d in dists.items() if d > threshold]
        for eid in removed:
            outlier_pairs.add((eid, sid))
        if removed:
            idx = np.where(br.id == sid)[0]
            acr = br.acronym[idx[0]] if len(idx) else str(sid)
            log_lines.append(f"  {acr} ({sid}): {len(removed)}/{len(coords)} removed (threshold={threshold:.0f}µm)")
    return outlier_pairs, log_lines


def main():
    print("Starting Phase 0 export...")

    # 1. Get Swanson regions
    print("Loading Swanson regions...")
    swanson_regions = swanson_json()
    print(f"Loaded {len(swanson_regions)} regions")

    # 2. Resolve Allen CCF IDs
    # thisID in swanson_json() is a ROW INDEX into BrainRegions arrays, not an Allen CCF ID.
    # The actual Allen CCF ID is br.id[thisID].
    print("Loading BrainRegions and resolving Allen CCF IDs...")
    br = BrainRegions()
    for r in swanson_regions:
        r['allenId'] = int(br.id[r['thisID']])

    all_swanson_ids = sorted(set(r['allenId'] for r in swanson_regions))
    print(f"Found {len(all_swanson_ids)} unique Allen CCF IDs")

    # Build parent->children map for propagating injections from parent to flatmap descendants
    children_map = {}
    for aid, parent_id in zip(br.id, br.parent):
        if not np.isnan(parent_id):
            pid = int(parent_id)
            if pid not in children_map:
                children_map[pid] = []
            children_map[pid].append(int(aid))

    def flatmap_descendants(struct_id, valid):
        """Return all valid-set nodes in the subtree rooted at struct_id.
        Always recurses into children even when the current node is in valid,
        so that injections into a parent (e.g. ZI, PAG) also credit sub-regions
        (e.g. FF/A13, ND/INC/PRC) drawn separately on the flatmap."""
        result = []
        stack = [struct_id]
        while stack:
            cur = stack.pop()
            if cur in valid:
                result.append(cur)
            stack.extend(children_map.get(cur, []))
        return result

    # 3. Get BrainRegions metadata — all allenIds are already valid (derived from br.id)
    valid_allen_ids = all_swanson_ids
    print(f"Valid Allen IDs: {len(valid_allen_ids)}")
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

    # Build exp_to_inj_struct directly from experiments.json so each experiment
    # is attributed to its actual injection structure, not whichever query ran first.
    print(f"Scanning experiments.json for injections into {len(valid_allen_ids)} structures...")
    valid_set = set(valid_allen_ids)
    repo_root = Path(__file__).resolve().parents[1]
    with open(repo_root / "mouse_connectivity" / "experiments.json") as f:
        all_experiments = json.load(f)
    exp_injection_volume = {
        e["data_set_id"]: e.get("injection_volume") or None
        for e in all_experiments
    }
    # Manual sibling overrides: region has no Allen experiments but is anatomically
    # part of a sibling that does. Maps override_id -> proxy_id.
    # When the proxy appears as an injection target, the override also gets credit.
    SIBLING_OVERRIDES = {
        934: 926,  # ENTmv (Entorhinal medial part, ventral zone) <- ENTm (Entorhinal medial part)
    }

    # Map each experiment to ALL matching injection structures.
    # If an injection structure isn't on the flatmap, propagate to its flatmap descendants
    # (e.g. IC -> ICc/ICd/ICe, SCs -> SCop/SCsg/SCzo).
    exp_to_inj_structs = {}  # exp_id -> [struct_id, ...]
    for exp in all_experiments:
        exp_id = exp.get("data_set_id")
        if exp_id is None:
            continue
        inj_str = exp.get("injection_structures", "")
        if not inj_str:
            continue
        inj_ids = [int(s) for s in str(inj_str).split("/") if s.strip()]
        targets = set()
        for sid in inj_ids:
            targets.update(flatmap_descendants(sid, valid_set))
        for override_id, proxy_id in SIBLING_OVERRIDES.items():
            if proxy_id in targets and override_id in valid_set:
                targets.add(override_id)
        if targets:
            exp_to_inj_structs[exp_id] = list(targets)

    # Coordinate outlier filter: remove (exp, struct) pairs where the injection
    # centroid is a 3D outlier among other experiments for that structure.
    # Catches off-target injections (e.g. lateral VTA hits drifting into SNc)
    # that Allen's injection_structures annotation missed. See §13 in
    # parcellation_mismatches.md for full rationale and known limitations.
    #
    # TODO (optional): replace with CCF annotation volume boundary check.
    # from allensdk.core.reference_space_cache import ReferenceSpaceCache
    # rspc = ReferenceSpaceCache(resolution=10, reference_space_key='annotation/ccf_2017')
    # annotation, _ = rspc.get_annotation_volume()  # ~500MB, cached after first download
    # Then for each experiment: annotation[y//10, z//10, x//10] gives the true structure
    # at the injection centroid — no tunable k, works for any experiment count.
    outlier_pairs, outlier_log = filter_coordinate_outliers(exp_to_inj_structs, all_experiments, br)
    if outlier_log:
        print(f"Coordinate outlier filter removed {len(outlier_pairs)} (exp, struct) pairs:")
        for line in outlier_log:
            print(line)
        filtered = {}
        for eid, sids in exp_to_inj_structs.items():
            kept = [s for s in sids if (eid, s) not in outlier_pairs]
            if kept:
                filtered[eid] = kept
        exp_to_inj_structs = filtered
    else:
        print("Coordinate outlier filter: no outliers detected")

    exp_ids = list(exp_to_inj_structs.keys())
    all_inj_structs = set(sid for sids in exp_to_inj_structs.values() for sid in sids)
    print(f"Discovered {len(exp_ids)} experiments from {len(all_inj_structs)} injection structures")
    
    if exp_ids:
        # Read cached structure_unionizes.csv files directly — avoids get_projection_matrix
        # network calls which hang on uncached experiments.
        import csv
        cache_dir = repo_root / "mouse_connectivity"
        # Two connectivity dicts — same experiments, different normalization strategies:
        # rel: projection_energy / injection_volume (density × intensity; size-normalized per target)
        # abs: projection_volume × projection_intensity / injection_volume (total labeled fluorescence;
        #      favors large terminal fields, naturally penalizes small structures with passing fibers)
        connectivity_rel = {}
        connectivity_abs = {}
        exp_counts = {}         # inj_struct_id -> number of cached experiments attributed to it
        cached_count = 0
        skipped_count = 0
        skipped_no_vol = 0

        for exp_id in exp_ids:
            unionize_path = cache_dir / f"experiment_{exp_id}" / "structure_unionizes.csv"
            if not unionize_path.exists():
                skipped_count += 1
                continue
            inj_vol = exp_injection_volume.get(exp_id)
            if not inj_vol:
                skipped_no_vol += 1
                continue
            cached_count += 1
            inj_struct_ids = exp_to_inj_structs[exp_id]
            inj_struct_set = set(inj_struct_ids)
            # Count this experiment toward each injection structure it was attributed to.
            # Denominator for mean aggregation: total experiments per injection structure,
            # not just those where a given target was labeled. This prevents bias toward
            # connections that happen to be consistently present vs. consistently absent.
            for inj_struct_id in inj_struct_ids:
                exp_counts[inj_struct_id] = exp_counts.get(inj_struct_id, 0) + 1
            with open(unionize_path) as f:
                rows = list(csv.DictReader(f))

            # Compute both metrics per row in a single pass.
            # is_injection=True rows excluded (see prior session notes on density-ratio failure).
            # hemisphere_id=3 only: bilateral total; 1/2/3 would triple-count every connection.
            # Co-injection structures excluded via inj_struct_set.
            proj_data = [
                (
                    int(row['structure_id']),
                    float(row['projection_energy']) / inj_vol,
                    float(row['projection_volume']) * float(row['projection_intensity']) / inj_vol,
                )
                for row in rows
                if row['is_injection'].strip().lower() != 'true'
                and row['hemisphere_id'] == '3'
                and int(row['structure_id']) in valid_set
                and int(row['structure_id']) not in inj_struct_set
                and float(row['projection_energy']) > 0
            ]
            for inj_struct_id in inj_struct_ids:
                for proj_struct_id, rel_val, abs_val in proj_data:
                    key = (inj_struct_id, proj_struct_id)
                    connectivity_rel[key] = connectivity_rel.get(key, 0) + rel_val
                    connectivity_abs[key] = connectivity_abs.get(key, 0) + abs_val

        print(f"Read {cached_count} cached experiments, skipped {skipped_count} uncached, {skipped_no_vol} missing injection_volume")
        print(f"Aggregated {len(connectivity_rel)} rel / {len(connectivity_abs)} abs connections (pre-mean)")

        # Divide each summed value by the number of experiments attributed to that
        # injection structure. Without this, well-studied regions (hippocampus: 90+
        # experiments; small nuclei: 2-3) dominate the global max and compress the
        # dynamic range of weakly-studied regions into near-zero values.
        connectivity_mean_rel = {key: vol / exp_counts[key[0]] for key, vol in connectivity_rel.items()}
        connectivity_mean_abs = {key: vol / exp_counts[key[0]] for key, vol in connectivity_abs.items()}

        def make_sparse(mean_dict):
            if not mean_dict:
                return []
            max_val = max(mean_dict.values())
            conns = [
                {
                    "injection_structure_id": int(inj_id),
                    "projection_structure_id": int(proj_id),
                    "normalized_volume": float(vol / max_val),
                }
                for (inj_id, proj_id), vol in mean_dict.items()
                if vol / max_val > 1e-9
            ]
            conns.sort(key=lambda x: x["normalized_volume"], reverse=True)
            return conns

        sparse_rel = make_sparse(connectivity_mean_rel)
        sparse_abs = make_sparse(connectivity_mean_abs)

        if sparse_rel or sparse_abs:
            max_rel = max(connectivity_mean_rel.values()) if connectivity_mean_rel else 0
            max_abs = max(connectivity_mean_abs.values()) if connectivity_mean_abs else 0
            print(f"Max mean relative: {max_rel:.4f}, absolute: {max_abs:.4f}")
            connectivity_data = {
                "structure_ids": valid_allen_ids,
                "experiment_count": cached_count,
                "total_connections_relative": len(sparse_rel),
                "total_connections_absolute": len(sparse_abs),
                "sparse_connections_relative": sparse_rel,
                "sparse_connections_absolute": sparse_abs,
                "note": (
                    f"relative = mean(projection_energy/inj_vol); "
                    f"absolute = mean(projection_volume*intensity/inj_vol). "
                    f"{cached_count} cached experiments ({skipped_count} uncached, {skipped_no_vol} missing inj_vol). "
                    f"Allen CCF IDs via br.id[thisID]."
                ),
            }
        else:
            connectivity_data = {
                "note": "No connectivity found",
                "experiment_count": cached_count,
                "status": "no_connections",
            }

    else:
        connectivity_data = {"note": "No experiments found", "status": "empty"}
    
    with open(OUTPUT_DIR / "connectivity_matrix.json", "w") as f:
        json.dump(connectivity_data, f, indent=2)
    print("Exported connectivity_matrix.json")

    print("Phase 0 export test completed.")

if __name__ == "__main__":
    main()