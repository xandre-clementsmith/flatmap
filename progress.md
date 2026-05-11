# Phase 0 Export Progress

## ✅ Completed Tasks
- Installed allensdk in venv
- Explored iblatlas.flatmaps module: swanson_json(), _swanson_labels_positions()
- Explored allensdk.api.queries.mouse_connectivity_api: MouseConnectivityApi class with methods like get_structure_unionizes, get_projection_matrix
- Explored allensdk.core.mouse_connectivity_cache: MouseConnectivityCache class with get_projection_matrix method
- Verified swanson_json() returns list of dicts with keys: ['thisID', 'hole', 'coordsReg']
- Verified _swanson_labels_positions() returns dict of Allen ID -> (x,y) coordinates
- Found that Allen IDs from _swanson_labels_positions() can be used to map to acronyms, colors, etc. via BrainRegions()
- Created src/export_phase0.py script
- Successfully exported swanson_regions.json (396 regions with vector paths)
- Successfully exported region_metadata.json (156 valid Allen regions with acronym, name, hexcolor, level, parent, order)
- Successfully exported connectivity_matrix.json (185 sparse connections between Swanson structures, normalized 0-1)

## Current Status
- All three Phase 0 output files completed successfully!
- Connectivity matrix uses sample experiments (6 experiments from 6 injection structures)
- Data is aggregated and normalized as required

## Files Created
- `src/data/swanson_regions.json` (625KB): All Swanson flatmap regions with paths
- `src/data/region_metadata.json` (25KB): Brain region metadata for 156 structures  
- `src/data/connectivity_matrix.json` (varies): Sparse connectivity matrix with 185 connections

## Next Steps
- Phase 0 complete! Ready for Phase 1 development
- Consider expanding connectivity to more experiments for fuller coverage
- Validate data formats match requirements