# Flatmap

Interactive Swanson flatmap visualization of Allen Mouse Connectivity Atlas data.

## Setup

```bash
pip install -r requirements.txt
cd app && npm install
```

## Workflow

### 1. Generate data

Run from the repo root (requires internet on first run to cache Allen data):

```bash
python3 src/export_phase0.py
```

Outputs three files to `app/public/data/`:
- `swanson_regions.json` — SVG paths for all 396 Swanson flatmap regions
- `region_metadata.json` — acronym, name, color for 156 Allen-mapped structures
- `connectivity_matrix.json` — sparse projection matrix (47 injection structures)

### 2. Run the app

```bash
cd app && npm run dev
```

### 3. Build for Netlify

```bash
cd app && npm run build
```

Drag the `app/dist/` folder to Netlify.