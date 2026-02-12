# micro-analysis-tool

Browser-based geospatial screening tool for transit station-area analysis. Click a map to place stations, and the tool computes demographics, employment, and land-use metrics using live Census APIs. All data stays in the browser — no backend required.

## Quick Start

1. Open `index.html` in a browser (or serve with any static file server)
2. Click the map to place transit station points (0.5-mile buffers are drawn automatically)
3. Choose a variable, year, and geography level, then click **Update summary**
4. Upload data files (LODES, CRE, essential services, LBAR) for additional metrics

For local development with file uploads, use a static server to avoid CORS issues:

```
python -m http.server 8000
# then open http://localhost:8000
```

## What It Computes

**Core (always available):**
- ACS demographic variables (population, households, median income, etc.) via area-weighted aggregation
- Employment served (LODES WAC block-level point-in-polygon)

**FTA Small Starts project (optional):**
- FTA Project Justification (Land Use) breakpoint ratings
- Population density, employment, LBAR ratio, community risk, essential services
- Automatic classification into High / Medium-High / Medium / Medium-Low / Low

## Adding a New Project

Projects are self-contained analysis modules. Each is two files: a JS file and an HTML sidebar fragment.

1. Create `js/projects/my-project.js` with an `App.registerProject({...})` call
2. Create `projects/my-project.html` with sidebar markup
3. Add `<script src="js/projects/my-project.js"></script>` to `index.html` (after `app.js`)

See `CLAUDE.md` for the full project API and `core` object reference.

## External Dependencies (CDN)

- [MapLibre GL JS](https://maplibre.org/) — map rendering
- [Turf.js](https://turfjs.org/) — geospatial operations
- [pako](https://github.com/nicmart/pako) — gzip decompression for LODES files
- [PapaParse](https://www.papaparse.com/) — CSV parsing

## Project Structure

See `CLAUDE.md` for full architecture documentation, including file descriptions, namespace API, script load order, and conventions.
