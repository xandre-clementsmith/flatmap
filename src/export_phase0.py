#!/usr/bin/env python3
"""
Phase 0 Export Script

Produces three JSON files consumed by the Swanson flatmap web app:
  swanson_regions.json     — polygon paths for every flatmap region
  region_metadata.json     — Allen CCF metadata (acronym, name, color, hierarchy)
  connectivity_matrix.json — sparse mean projection energy, normalized 0–1

All parcellation and connectivity decisions are documented in
parcellation_mismatches.md.  Section numbers below (§N) refer to entries there.
"""

import csv
import json
import operator as op
import statistics
from functools import reduce

import numpy as np
from pathlib import Path
from iblatlas.flatmaps import swanson_json
from iblatlas.regions import BrainRegions
from allensdk.core.mouse_connectivity_cache import MouseConnectivityCache


# ---------------------------------------------------------------------------
# allensdk compatibility patch
# ---------------------------------------------------------------------------
# allensdk's filter_structure_unionizes uses df.is_injection (attribute access)
# which raises AttributeError on newer pandas.  Patch to use bracket notation.
# Applied inside main() to avoid side effects at import time.

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


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Output directory — parallel to src/, i.e. app/public/data/
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "app" / "public" / "data"

# Manual sibling overrides: maps region_id → proxy_id.
# When the proxy appears as an injection target, the override also gets credit.
# Used for regions that have no Allen experiments but are anatomically part of
# a sibling that does.  §6 Category C.
SIBLING_OVERRIDES = {
    934: 926,  # ENTmv (Entorhinal medial, ventral zone) <- ENTm (Entorhinal medial part)
}


# ---------------------------------------------------------------------------
# Hierarchy helpers
# ---------------------------------------------------------------------------

def build_children_map(br):
    """Return a dict mapping Allen CCF parent_id → list of child Allen CCF IDs."""
    children = {}
    for aid, parent_id in zip(br.id, br.parent):
        if not np.isnan(parent_id):
            children.setdefault(int(parent_id), []).append(int(aid))
    return children


def flatmap_descendants(struct_id, valid_set, children_map):
    """Return all nodes in struct_id's subtree that are members of valid_set.

    Always recurses into children even when the current node is already in
    valid_set, so that an injection into a parent (e.g. ZI, PAG) also credits
    child regions drawn separately on the flatmap (e.g. FF/A13, ND/INC/PRC).
    §3, §5.
    """
    result = []
    stack = [struct_id]
    while stack:
        cur = stack.pop()
        if cur in valid_set:
            result.append(cur)
        stack.extend(children_map.get(cur, []))  # always recurse, regardless of valid_set membership
    return result


# ---------------------------------------------------------------------------
# Coordinate outlier filter
# ---------------------------------------------------------------------------

def filter_coordinate_outliers(exp_to_inj_structs, all_experiments, id_to_acronym=None, k=3.0, min_exps=5):
    """Remove (experiment, structure) pairs where the injection centroid is a 3D outlier.

    For each structure with >= min_exps experiments:
      1. Compute the median 3D injection centroid.
      2. Compute each experiment's Euclidean distance from that median.
      3. Exclude any experiment with distance > median_dist + k * MAD.

    Operates on (exp, struct) pairs, not whole experiments — a lateral VTA
    injection excluded from VTA's pool may still contribute correctly to SNc.
    Assumes a roughly spherical coordinate distribution per structure.  §13.
    """
    # Build coordinate lookup from experiments.json
    exp_coords = {}
    for e in all_experiments:
        eid = e.get('data_set_id')
        x, y, z = e.get('injection_x'), e.get('injection_y'), e.get('injection_z')
        if None not in (x, y, z):
            exp_coords[eid] = (float(x), float(y), float(z))

    # Invert exp→structs to struct→exps for per-structure iteration
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

        # Median injection centroid for this structure
        median_x = statistics.median(c[0] for _, c in coords)
        median_y = statistics.median(c[1] for _, c in coords)
        median_z = statistics.median(c[2] for _, c in coords)

        # Euclidean distance of each experiment from the median centroid
        dist_by_eid = {
            eid: ((cx - median_x)**2 + (cy - median_y)**2 + (cz - median_z)**2) ** 0.5
            for eid, (cx, cy, cz) in coords
        }
        dist_vals = list(dist_by_eid.values())
        median_dist = statistics.median(dist_vals)
        mad = statistics.median(abs(d - median_dist) for d in dist_vals)
        if mad == 0:
            continue  # all equidistant — skip to avoid spurious exclusions

        threshold = median_dist + k * mad
        removed = [eid for eid, d in dist_by_eid.items() if d > threshold]
        for eid in removed:
            outlier_pairs.add((eid, sid))
        if removed:
            acr = id_to_acronym.get(sid, str(sid)) if id_to_acronym else str(sid)
            log_lines.append(
                f"  {acr} ({sid}): {len(removed)}/{len(coords)} removed "
                f"(threshold={threshold:.0f}µm)"
            )

    return outlier_pairs, log_lines


# ---------------------------------------------------------------------------
# Connectivity helpers
# ---------------------------------------------------------------------------

def make_sparse(mean_dict):
    """Convert a {(inj_id, proj_id): value} dict to a normalized sorted list of dicts.

    Values are divided by the global maximum so all entries are in [0, 1].
    Entries below floating-point noise (1e-9) are dropped.
    Result is sorted strongest-first.
    """
    if not mean_dict:
        return []
    max_val = max(mean_dict.values())
    conns = [
        {
            "injection_structure_id":  int(inj_id),
            "projection_structure_id": int(proj_id),
            "normalized_value":        float(vol / max_val),
        }
        for (inj_id, proj_id), vol in mean_dict.items()
        if vol / max_val > 1e-9
    ]
    conns.sort(key=lambda x: x["normalized_value"], reverse=True)
    return conns


# ---------------------------------------------------------------------------
# Main export pipeline
# ---------------------------------------------------------------------------

def main():
    print("Starting Phase 0 export...")

    # Apply the allensdk pandas-compatibility patch and create the output directory
    # here rather than at import time to avoid side effects when this module is imported.
    MouseConnectivityCache.filter_structure_unionizes = _filter_structure_unionizes
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── Phase 1: Load Swanson flatmap regions and resolve Allen CCF IDs ──────
    #
    # thisID in swanson_json() is a ROW INDEX into BrainRegions arrays, NOT an
    # Allen CCF ID.  The real CCF ID is br.id[thisID].  §1.

    print("Loading Swanson regions and BrainRegions...")
    swanson_regions = swanson_json()
    br = BrainRegions()
    for r in swanson_regions:
        r['allenId'] = int(br.id[r['thisID']])
    print(f"Loaded {len(swanson_regions)} regions")

    valid_allen_ids = sorted(set(r['allenId'] for r in swanson_regions))
    valid_set = set(valid_allen_ids)
    children_map = build_children_map(br)

    # ── Phase 2: Export swanson_regions.json and region_metadata.json ────────

    print("Exporting swanson_regions.json...")
    with open(OUTPUT_DIR / "swanson_regions.json", "w") as f:
        json.dump(swanson_regions, f, indent=2)

    print("Exporting region_metadata.json...")
    metadata = br.get(valid_allen_ids)
    meta_dict = {}
    for i, aid in enumerate(metadata.id):
        rgb = metadata.rgb[i]
        meta_dict[int(aid)] = {
            "acronym":  metadata.acronym[i],
            "name":     metadata.name[i],
            "hexcolor": f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}",
            "level":    int(metadata.level[i]),
            "parent":   int(metadata.parent[i]) if not np.isnan(metadata.parent[i]) else None,
            "order":    int(metadata.order[i]),
        }
    with open(OUTPUT_DIR / "region_metadata.json", "w") as f:
        json.dump(meta_dict, f, indent=2)
    print(f"Exported metadata for {len(meta_dict)} regions")

    # ── Phase 3: Build experiment → injection structure mapping ───────────────
    #
    # Each experiment is attributed to ALL flatmap structures it injected.
    # If an injection target is not on the flatmap, propagate to its flatmap
    # descendants (e.g. IC → ICc/ICd/ICe; SCs → SCop/SCsg/SCzo).  §2, §3.

    repo_root = Path(__file__).resolve().parents[1]
    with open(repo_root / "mouse_connectivity" / "experiments.json") as f:
        all_experiments = json.load(f)

    exp_injection_volume = {
        e["data_set_id"]: e.get("injection_volume")
        for e in all_experiments
    }

    print(f"Mapping {len(all_experiments)} experiments to {len(valid_allen_ids)} flatmap structures...")
    exp_to_inj_structs = {}  # exp_id → [struct_id, ...]
    for exp in all_experiments:
        exp_id = exp.get("data_set_id")
        if not exp_id:
            continue
        inj_str = exp.get("injection_structures", "")
        if not inj_str:
            continue
        inj_ids = [int(s) for s in str(inj_str).split("/") if s.strip()]

        # Propagate each injection ID to all valid flatmap descendants
        targets = set()
        for sid in inj_ids:
            targets.update(flatmap_descendants(sid, valid_set, children_map))

        # Give sibling proxies (e.g. ENTmv) credit when their proxy (ENTm) was injected
        for override_id, proxy_id in SIBLING_OVERRIDES.items():
            if proxy_id in targets and override_id in valid_set:
                targets.add(override_id)

        if targets:
            exp_to_inj_structs[exp_id] = list(targets)

    # ── Phase 4: Coordinate outlier filter ────────────────────────────────────
    #
    # Remove (exp, struct) pairs where the injection centroid is far from the
    # median for that structure — catches off-target injections (e.g. lateral
    # VTA experiments drifting into SNc).  §13.

    id_to_acronym = {int(sid): acr for sid, acr in zip(br.id, br.acronym)}
    outlier_pairs, outlier_log = filter_coordinate_outliers(
        exp_to_inj_structs, all_experiments, id_to_acronym
    )
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

    # ── Phase 5: Read cached structure_unionizes.csv files ────────────────────
    #
    # Two metrics accumulated in parallel:
    #   rel: projection_energy / injection_volume    (energy-based; mitigates fibers-of-passage, §10)
    #   abs: projection_volume × intensity / inj_vol (volume-based alternative)
    #
    # Filters applied per CSV row:
    #   is_injection != True         — exclude injection-site rows (§7, §11)
    #   hemisphere_id == '3'         — bilateral total only; avoids triple-counting (§9)
    #   structure_id in valid_set    — only include flatmap regions
    #   structure_id not in inj_set  — exclude co-injected structures (§7)
    #   projection_energy > 0        — skip unlabeled rows

    cache_dir = repo_root / "mouse_connectivity"
    connectivity_rel = {}   # (inj_id, proj_id) → summed projection_energy / inj_vol
    connectivity_abs = {}   # (inj_id, proj_id) → summed proj_volume × intensity / inj_vol
    exp_counts     = {}     # inj_struct_id → number of experiments attributed to it
    cached_count   = 0
    skipped_count  = 0
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

        # Count this experiment toward every injection structure it's attributed to.
        # Denominator for mean aggregation must include experiments where a given
        # target was unlabeled — otherwise the mean is biased toward consistently
        # present connections rather than consistently strong ones.  §8.
        for inj_id in inj_struct_ids:
            exp_counts[inj_id] = exp_counts.get(inj_id, 0) + 1

        with open(unionize_path) as f:
            rows = list(csv.DictReader(f))

        # Parse both metrics in a single pass through the CSV
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

        # Accumulate summed values — converted to means in Phase 6
        for inj_id in inj_struct_ids:
            for proj_id, rel_val, abs_val in proj_data:
                key = (inj_id, proj_id)
                connectivity_rel[key] = connectivity_rel.get(key, 0) + rel_val
                connectivity_abs[key] = connectivity_abs.get(key, 0) + abs_val

    print(
        f"Read {cached_count} cached experiments, "
        f"skipped {skipped_count} uncached, {skipped_no_vol} missing injection_volume"
    )
    print(f"Aggregated {len(connectivity_rel)} rel / {len(connectivity_abs)} abs connections (pre-mean)")

    # ── Phase 6: Convert summed totals to per-experiment means ────────────────
    #
    # Dividing by exp_counts equalizes regions with many experiments (hippocampus:
    # 90+) against those with few (small brainstem nuclei: 2–3).  Without this,
    # high-count regions dominate the global max and compress the dynamic range of
    # weakly-studied regions into near-zero normalized values.  §8.

    mean_rel = {key: vol / exp_counts[key[0]] for key, vol in connectivity_rel.items()}
    mean_abs = {key: vol / exp_counts[key[0]] for key, vol in connectivity_abs.items()}

    sparse_rel = make_sparse(mean_rel)
    sparse_abs = make_sparse(mean_abs)

    if sparse_rel or sparse_abs:
        max_rel = max(mean_rel.values()) if mean_rel else 0
        max_abs = max(mean_abs.values()) if mean_abs else 0
        print(f"Max mean relative: {max_rel:.4f}, absolute: {max_abs:.4f}")
        connectivity_data = {
            "structure_ids":              valid_allen_ids,
            "experiment_count":           cached_count,
            "total_connections_relative": len(sparse_rel),
            "total_connections_absolute": len(sparse_abs),
            "sparse_connections_relative": sparse_rel,
            "sparse_connections_absolute": sparse_abs,
            "note": (
                f"relative = mean(projection_energy/inj_vol); "
                f"absolute = mean(projection_volume*intensity/inj_vol). "
                f"{cached_count} cached experiments "
                f"({skipped_count} uncached, {skipped_no_vol} missing inj_vol). "
                f"Allen CCF IDs via br.id[thisID]."
            ),
        }
    else:
        connectivity_data = {
            "note":             "No connectivity found",
            "experiment_count": cached_count,
            "status":           "no_connections",
        }

    # ── Phase 7: Write connectivity_matrix.json ───────────────────────────────

    with open(OUTPUT_DIR / "connectivity_matrix.json", "w") as f:
        json.dump(connectivity_data, f, indent=2)
    print("Exported connectivity_matrix.json")
    print("Phase 0 export complete.")


if __name__ == "__main__":
    main()
