# Plan: New Sidebar (v2) — Build Alongside, Then Swap

## Strategy

Build a new left sidebar (`#sidebar-v2`) in parallel with the existing `#sidebar`. The legacy sidebar remains fully functional during development. Once all core features are migrated and working in the new sidebar, the legacy one is hidden/removed.

### Why this approach

- **No regression risk** — the old sidebar keeps working while the new one is built
- **Clean CSS** — new styles in a separate file won't conflict with existing rules
- **Incremental migration** — features can be moved one section at a time
- **Easy rollback** — if something goes wrong, the old sidebar is still there
- **Accommodates planned features** — collapsible panels, dynamic loading, and reorderable sections can be designed in from the start rather than retrofitted

---

## Architecture

### New Files
- `css/sidebar-v2.css` — All styles for the new sidebar, fully isolated from legacy CSS
- `js/core/sidebar.js` — Sidebar manager module: panel registration, collapse/expand, show/hide, state management

### Modified Files
- `index.html` — Add `#sidebar-v2` container, link new CSS, add `sidebar.js` script tag, add toggle mechanism
- `js/app.js` — Add element resolution layer so event bindings work with whichever sidebar is active
- `css/style.css` — Minor additions only (toggle button styling, hiding inactive sidebar)

### Key Design Decisions
- New sidebar element IDs use `v2-` prefix to avoid conflicts (e.g., `v2-varSelect`, `v2-geoLevel`)
- Each section is a **collapsible panel** with a header that toggles content visibility
- Panels are registered programmatically via `App.sidebar.addPanel({ id, title, html, collapsed })`
- The project system uses `App.sidebar.addPanel()` instead of raw innerHTML injection
- All new CSS is scoped under `#sidebar-v2` to prevent any style leakage

---

## Panel System Design

Each panel in the new sidebar follows this structure:

```html
<div class="sb2-panel" data-panel-id="station-data">
  <div class="sb2-panel-header">
    <span class="sb2-panel-title">Station-area Data</span>
    <button class="sb2-panel-toggle" aria-expanded="true">&#9662;</button>
  </div>
  <div class="sb2-panel-body">
    <!-- panel content here -->
  </div>
</div>
```

Clicking the header toggles `.sb2-collapsed` on the panel div, which hides the body via CSS (`display: none`). No JavaScript animation needed initially.

The `App.sidebar` manager exposes:
- `addPanel(config)` — registers a panel (id, title, content HTML or DOM, default collapsed state, sort order)
- `removePanel(id)` — removes a panel
- `render()` — builds/rebuilds the sidebar DOM from registered panels
- `toggle(id)` — collapse/expand a specific panel
- `isActive()` — returns true if v2 sidebar is the visible one

---

## Phases

### Phase 1: Scaffold
**Goal:** Empty new sidebar visible alongside the old one, with toggle to switch between them.

1. Create `css/sidebar-v2.css` with:
   - Base container styles for `#sidebar-v2` (same width/border as legacy, or slightly wider)
   - Panel system styles: `.sb2-panel`, `.sb2-panel-header`, `.sb2-panel-body`, `.sb2-collapsed`
   - Scoped form control styles (selects, buttons, inputs) so they don't inherit the legacy `width: 100%` rules
   - Typography and spacing
2. Create `js/core/sidebar.js` with the panel manager API (described above)
3. Add `#sidebar-v2` container to `index.html` (initially hidden via a CSS class `.sb2-hidden`)
4. Add `sidebar.js` to script load order in `index.html` (after `utils.js`, before `map.js`)
5. Add a small toggle button in the toolbar to switch between old/new sidebar (temporary development aid)
6. Link `css/sidebar-v2.css` in `<head>`

**Verification:** Toggle button switches visibility between the two sidebars. New sidebar is empty but styled.

### Phase 2: Core Data Panel
**Goal:** Station-area data controls (variable picker, year, geography level, run button, results card) working in the new sidebar.

1. Create the "Station-area Data" panel content with new element IDs:
   - `v2-varSelect`, `v2-yearSelect`, `v2-geoLevel` (dropdowns)
   - `v2-run` (button)
   - `v2-nGeos`, `v2-total`, `v2-notes`, `v2-aggWarning`, `v2-aggMethod` (results display)
2. Register it via `App.sidebar.addPanel()` during app startup
3. Add an element resolver to `app.js`: a helper function `el(baseId)` that returns the `v2-` element when sidebar-v2 is active, or the legacy element otherwise
4. Update `runSummary()`, `runAcsSummary()`, `runLodesEmploymentSummary()` in `app.js` to use the resolver
5. Wire event listeners for new elements (variable change triggers `setAggUI`, run button calls `runSummary`)

**Verification:** Switch to new sidebar, add stations, click "Update summary", confirm results display correctly.

### Phase 3: LODES Panel
**Goal:** LODES download/upload controls working in the new sidebar.

1. Create the "LODES" panel content with new element IDs:
   - `v2-lodesState`, `v2-lodesLoaded` (status display)
   - `v2-downloadLodes` (button)
   - `v2-lodesFile` (file input)
   - `v2-lodesInfo` (status text)
2. Register as a panel via `App.sidebar.addPanel()`
3. Wire event listeners for download button and file upload
4. Update `app.js` LODES handlers to use the element resolver

**Verification:** Switch to new sidebar, download/upload LODES file, verify status updates correctly.

### Phase 4: Features Panel (migrated from right-side panel)
**Goal:** Station list, buffer controls, lines/polygons management appear as a collapsible panel in the new sidebar.

This is an architectural improvement over the legacy layout. Currently the right-side feature panel is cramped at 240px. Moving feature management into the sidebar consolidates all controls in one place.

1. Create a "Features" panel in the new sidebar replicating the right-side feature panel:
   - Station list with editable names + delete buttons
   - Buffer radius input
   - Lines list with delete
   - Polygons list with delete
2. Wire to existing `App.refreshFeaturePanel()` — update it to populate the active sidebar's features section
3. Keep the right-side panel working for the legacy sidebar (don't break it)

**Verification:** Add stations, verify they appear in the new sidebar's Features panel with working delete/rename. Buffer radius changes update buffers on map.

### Phase 5: Project Panel
**Goal:** Project system (FTA Small Starts) working in the new sidebar.

1. Add a `v2-project-panel` container registered as a panel
2. Update `loadProjectPanel()` in `app.js` to inject project HTML into the correct container based on active sidebar
3. The FTA project's element IDs (e.g., `bpPopPill`, `creFile`) are unique — they aren't shared with core sidebar IDs — so they should work in either container without changes to `fta-small-starts.js`

**Verification:** FTA breakpoint ratings compute correctly, CRE/ESS/LBAR uploads all function via new sidebar.

### Phase 6: Polish & Cutover
**Goal:** New sidebar becomes the default; legacy sidebar is removed.

1. Style refinements: spacing, typography, colors, hover states, card designs
2. Make new sidebar the default (old one hidden)
3. End-to-end testing of all workflows
4. Remove legacy `#sidebar` HTML from `index.html`
5. Remove legacy sidebar CSS from `css/style.css`
6. Remove the toggle mechanism and element resolver
7. Rename `v2-` prefixed IDs to final names (or keep them — cosmetic choice)
8. Consider whether to remove the right-side feature panel entirely (if Features moved into sidebar)
9. Update `CLAUDE.md` to reflect new file structure and sidebar architecture

---

## What This Enables (from features.md)

Building the sidebar this way makes these planned features straightforward to add later:

| Planned Feature | How the new sidebar supports it |
|---|---|
| Dynamic panel loading/unloading | Already built into panel manager (`addPanel`/`removePanel`) |
| Collapsible sections | Built in from Phase 1 |
| Reorderable sidebar panels | Panel manager tracks order; drag-and-drop can be added to panel headers later |
| Multiple simultaneous census summaries | Results area can be redesigned as a multi-row table within the panel |
| Basemap switcher | Add as a small utility panel at the top or bottom |
| Modern UI refresh | New CSS file is a clean slate — no legacy rules to fight |
| Local cache with reset | Sidebar manager state (which panels are open, order) can be persisted to localStorage |
| Resizable sidebar | One CSS rule + a drag handle on the new container |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Element ID conflicts during coexistence | All new IDs use `v2-` prefix; no overlap with legacy IDs |
| `app.js` event handlers break | Element resolver function tested after each phase |
| FTA project breaks in new sidebar | Project HTML element IDs are unique (not shared with core); should work in either container |
| CSS leakage between sidebars | New styles scoped under `#sidebar-v2`; separate CSS file |
| Scope creep during migration | Phases 1-5 strictly replicate existing functionality; new features come only after Phase 6 |
| Toggle adds complexity | Toggle is a thin show/hide mechanism; removed in Phase 6 |

---

## Script Load Order (updated)

```
utils.js      (no deps)
sidebar.js    (needs utils — for setStatus)  <-- NEW
map.js        (creates App.map)
stations.js   (needs App.map, turf)
lines.js      (needs App.map)
polygons.js   (needs App.map)
features.js   (needs App.stations, App.lines, App.polygons)
census.js     (needs App.map, turf)
lodes.js      (needs App.map, pako, turf)
app.js        (wires everything; registers panels with sidebar manager)
<project>     (calls App.registerProject)
```
