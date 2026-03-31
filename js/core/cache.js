// js/core/cache.js
// Session cache: save/restore/reset via localStorage.
// JSON import/export via file download/upload.
// Depends on: App.stations, App.lines, App.routes, App.polygons,
//             App.rebuildBuffers, App.rebuildLineBuffers, App.rebuildRouteBuffers,
//             App.renderPolygonLayers, App.clearRoutes, App.refreshFeaturePanel.
// Exports: App.cache

(function () {
  var App = window.App = window.App || {};

  var STORAGE_KEY = "mat-session";
  var SCHEMA_VERSION = 1;
  var _saveTimer = null;
  var DEBOUNCE_MS = 500;
  var _viewOnly = false;

  // ---- Module state registry ----
  // Analysis modules register collect/apply hooks to persist their own state.
  // collect(mode) returns a serializable object; mode is "light" (localStorage)
  // or "full" (file export, may include geometry).
  // apply(data) restores state from a previously collected object.

  var _moduleHandlers = [];

  // ---- Collect current state into a serialisable object ----
  // mode: "light" (default, for localStorage — skips heavy geometry)
  //       "full"  (for file export — includes geos for choropleth restore)

  function collectState(mode) {
    var state = {
      version: SCHEMA_VERSION,
      stations: App.stations.slice(),
      lines: App.lines.slice(),
      routes: App.routes.slice(),
      polygons: App.polygons.slice(),
      labels: App.labels ? App.labels.slice() : [],
      bufferRadius: parseFloat(document.getElementById("bufferRadius").value) || 0.5,
      lineBufferRadius: parseFloat(document.getElementById("lineBufferRadius").value) || 0.5,
      routeBufferRadius: parseFloat(document.getElementById("routeBufferRadius").value) || 0.5,
      stationLineWidth:  parseFloat(document.getElementById("stationLineWidth").value)  || 1,
      lineLineWidth:     parseFloat(document.getElementById("lineLineWidth").value)     || 1,
      routeLineWidth:    parseFloat(document.getElementById("routeLineWidth").value)    || 1,
      polygonLineWidth:  parseFloat(document.getElementById("polygonLineWidth").value)  || 1,
      offsetOverlap: !!document.getElementById("offsetOverlap").checked,
      lodesFileNames: App.lodesFileNames || [],
      projFileName: App.projFileName || "",
      projYear: App.projYear || null
    };

    // Checkbox selections are now managed by the buffer-summary module
    // via cache.registerModule("buffer-summary"). Kept for backward compat on restore.
    // Note: geoLevel and year are also in state.moduleState["buffer-summary"].

    // Module state (TPI, RF, buffer-summary, etc.)
    state.moduleState = {};
    for (var mi = 0; mi < _moduleHandlers.length; mi++) {
      var mh = _moduleHandlers[mi];
      if (typeof mh.handlers.collect === "function") {
        try {
          state.moduleState[mh.id] = mh.handlers.collect(mode || "light");
        } catch (e) {
          console.warn("Cache: module collect failed for", mh.id, e);
        }
      }
    }

    return state;
  }

  // ---- Apply a state object to the app (shared by restore + import) ----

  function applyState(state) {
    // 1. Clear all feature arrays unconditionally (in-place to preserve closure refs)
    App.stations.length = 0;
    App.lines.length = 0;
    App.routes.length = 0;
    App.polygons.length = 0;
    if (App.labels) App.labels.length = 0;

    // 2. Push features
    if (Array.isArray(state.stations)) {
      for (var i = 0; i < state.stations.length; i++) App.stations.push(state.stations[i]);
    }
    if (Array.isArray(state.lines)) {
      for (var j = 0; j < state.lines.length; j++) App.lines.push(state.lines[j]);
    }
    if (Array.isArray(state.routes)) {
      for (var r = 0; r < state.routes.length; r++) App.routes.push(state.routes[r]);
    }
    if (Array.isArray(state.polygons)) {
      for (var k = 0; k < state.polygons.length; k++) App.polygons.push(state.polygons[k]);
    }
    if (App.labels && Array.isArray(state.labels)) {
      for (var li = 0; li < state.labels.length; li++) App.labels.push(state.labels[li]);
    }

    // 3. Set buffer radius DOM inputs before rebuilding
    var bufRadEl = document.getElementById("bufferRadius");
    if (bufRadEl && state.bufferRadius != null) {
      bufRadEl.value = state.bufferRadius;
    }
    var lineBufRadEl = document.getElementById("lineBufferRadius");
    if (lineBufRadEl && state.lineBufferRadius != null) {
      lineBufRadEl.value = state.lineBufferRadius;
    }
    var routeBufRadEl = document.getElementById("routeBufferRadius");
    if (routeBufRadEl && state.routeBufferRadius != null) {
      routeBufRadEl.value = state.routeBufferRadius;
    }

    // 3b. Restore line width DOM inputs and apply paint properties
    var stWEl = document.getElementById("stationLineWidth");
    if (stWEl && state.stationLineWidth != null) {
      stWEl.value = state.stationLineWidth;
      var sw = state.stationLineWidth;
      App.map.setPaintProperty("stations-layer", "circle-radius", 6 * sw);
      App.map.setPaintProperty("stations-layer", "circle-stroke-width", 2 * sw);
    }
    var liWEl = document.getElementById("lineLineWidth");
    if (liWEl && state.lineLineWidth != null) {
      liWEl.value = state.lineLineWidth;
      App.map.setPaintProperty("lines-layer", "line-width", 3 * state.lineLineWidth);
    }
    var rtWEl = document.getElementById("routeLineWidth");
    if (rtWEl && state.routeLineWidth != null) {
      rtWEl.value = state.routeLineWidth;
      App.map.setPaintProperty("routes-layer", "line-width", 3 * state.routeLineWidth);
    }
    var polyWEl = document.getElementById("polygonLineWidth");
    if (polyWEl && state.polygonLineWidth != null) {
      polyWEl.value = state.polygonLineWidth;
      App.map.setPaintProperty("polygons-outlines-layer", "line-width", 3 * state.polygonLineWidth);
    }

    // 3c. Restore offset toggle (actual offset computed after render via auto-recompute hook)
    var offsetEl = document.getElementById("offsetOverlap");
    if (offsetEl && state.offsetOverlap) {
      offsetEl.checked = true;
    }

    // 4. Rebuild derived buffers and re-render map layers
    var stationRadius = parseFloat(bufRadEl ? bufRadEl.value : "0.5") || 0.5;
    var lineRadius = parseFloat(lineBufRadEl ? lineBufRadEl.value : "0.5") || 0.5;
    var routeRadius = parseFloat(routeBufRadEl ? routeBufRadEl.value : "0.5") || 0.5;
    App.rebuildBuffers(stationRadius);
    App.rebuildLineBuffers(lineRadius);
    App.rebuildRouteBuffers(routeRadius);
    App.renderPolygonLayers();
    if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();

    // 5. Restore checkbox selections — checkboxes now live in buffer-summary popup
    // (lazy-loaded, not in DOM at restore time). Migrate into moduleState so the
    // buffer-summary module's apply() handler picks them up.
    if (!state.moduleState) state.moduleState = {};
    if (!state.moduleState["buffer-summary"]) {
      state.moduleState["buffer-summary"] = {
        geoLevel: state.geoLevel || "bg",
        year: state.year || "2024",
        apportionByArea: true
      };
    }
    // Migrate checkedVars from top-level into buffer-summary module state
    if (Array.isArray(state.checkedVars) && !state.moduleState["buffer-summary"].checkedVars) {
      state.moduleState["buffer-summary"].checkedVars = state.checkedVars;
    }

    // 7. LODES filename hint (data is NOT cached — too large)
    // Support both new array format (lodesFileNames) and old string format (lodesFileName)
    var lodesHints = state.lodesFileNames ||
      (state.lodesFileName ? [state.lodesFileName] : []);
    if (lodesHints.length > 0) {
      var lodesInfoEl = document.getElementById("lodesInfo");
      if (lodesInfoEl) {
        lodesInfoEl.textContent =
          "Previously loaded: " + lodesHints.join(", ") + " \u2014 re-upload to use";
      }
    }

    // 8. Projection filename hint (data is NOT cached — small CSV, re-upload is fast)
    if (state.projFileName) {
      var projInfoEl = document.getElementById("projInfo");
      if (projInfoEl) {
        projInfoEl.textContent = "Previously loaded: " + state.projFileName + " \u2014 re-upload to use";
      }
    }
    if (state.projYear) {
      var projYearEl = document.getElementById("projYear");
      if (projYearEl) projYearEl.value = state.projYear;
      App.projYear = state.projYear;
    }

    // 9. Module state (TPI, RF, etc.) — optional field, skip if absent
    if (state.moduleState) {
      for (var mi = 0; mi < _moduleHandlers.length; mi++) {
        var mh = _moduleHandlers[mi];
        var moduleData = state.moduleState[mh.id];
        if (moduleData && typeof mh.handlers.apply === "function") {
          try {
            mh.handlers.apply(moduleData);
          } catch (e) {
            console.warn("Cache: module apply failed for", mh.id, e);
          }
        }
      }
    }
  }

  // ---- Save (debounced) ----

  function save() {
    if (_viewOnly) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      try {
        var json = JSON.stringify(collectState());
        localStorage.setItem(STORAGE_KEY, json);
      } catch (e) {
        console.warn("Cache save failed:", e);
      }
    }, DEBOUNCE_MS);
  }

  // ---- Restore ----
  // Returns true if cached data was found and applied.

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      var state = JSON.parse(raw);
      if (!state || state.version !== SCHEMA_VERSION) {
        console.warn("Cache: schema version mismatch, ignoring cached data.");
        return false;
      }

      applyState(state);

      return (App.stations.length > 0 || App.lines.length > 0 ||
              App.routes.length > 0 || App.polygons.length > 0 ||
              (App.labels && App.labels.length > 0));
    } catch (e) {
      console.warn("Cache restore failed:", e);
      return false;
    }
  }

  // ---- Reset: clear cache and all app state ----

  function reset() {
    // 1. Clear localStorage
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Cache clear failed:", e);
    }

    // 2. Clear all features
    if (typeof App.exitEditMode === "function") App.exitEditMode();
    App.clearStations();
    App.clearLines();
    App.clearRoutes();
    App.clearPolygons();
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();

    // 3. Reset buffer radii to defaults
    var bufRadEl = document.getElementById("bufferRadius");
    if (bufRadEl) bufRadEl.value = "0.5";
    var lineBufRadEl = document.getElementById("lineBufferRadius");
    if (lineBufRadEl) lineBufRadEl.value = "0.5";
    var routeBufRadEl = document.getElementById("routeBufferRadius");
    if (routeBufRadEl) routeBufRadEl.value = "0.5";

    // 4. Clear LODES state
    if (typeof App.clearLodesData === "function") {
      App.clearLodesData();
    }

    // 4b. Clear projection state
    if (typeof App.clearProjectionsData === "function") {
      App.clearProjectionsData();
    }

    // 5. Uncheck all variable checkboxes
    var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
    var lodesCb = document.getElementById("lodesCheckbox");
    if (lodesCb) lodesCb.checked = false;

    // 6. Reset buffer-summary popup state (if popup DOM exists)
    var basGeoEl = document.getElementById("basGeoLevel");
    if (basGeoEl) basGeoEl.value = "bg";
    var basYearEl = document.getElementById("basYearSelect");
    if (basYearEl) basYearEl.value = "2024";
    var basApportionEl = document.getElementById("basApportionByArea");
    if (basApportionEl) basApportionEl.checked = true;

    // 7. Update status
    App.setStatus("Session reset");
  }

  // ---- Validate imported state ----

  function validateState(state) {
    if (!state || typeof state !== "object") {
      return "File does not contain a valid JSON object.";
    }
    if (state.version !== SCHEMA_VERSION) {
      return "Unsupported file version (expected " + SCHEMA_VERSION +
             ", got " + (state.version || "none") + ").";
    }
    if (state.stations != null && !Array.isArray(state.stations)) {
      return "Invalid stations data.";
    }
    if (state.lines != null && !Array.isArray(state.lines)) {
      return "Invalid lines data.";
    }
    if (state.routes != null && !Array.isArray(state.routes)) {
      return "Invalid routes data.";
    }
    if (state.polygons != null && !Array.isArray(state.polygons)) {
      return "Invalid polygons data.";
    }
    return null; // null = valid
  }

  // ---- Export to JSON file ----

  function exportToFile() {
    try {
      var state = collectState("full");
      var json = JSON.stringify(state, null, 2);
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);

      var now = new Date();
      var filename = "analysis-" + now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + ".json";

      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      App.setStatus("Exported " + filename);
    } catch (e) {
      console.warn("Export failed:", e);
      App.setStatus("Export failed: " + (e.message || e));
    }
  }

  // ---- Import from JSON file ----

  function importFromFile(file) {
    var reader = new FileReader();

    reader.onload = function (e) {
      try {
        var state = JSON.parse(e.target.result);
        var err = validateState(state);
        if (err) {
          App.setStatus("Import failed");
          alert("Import failed: " + err);
          return;
        }

        // Confirm if replacing existing features
        var hasExisting = (App.stations.length > 0 || App.lines.length > 0 ||
                           App.routes.length > 0 || App.polygons.length > 0);
        if (hasExisting) {
          if (!confirm("Import will replace all current features and settings. Continue?")) {
            return;
          }
        }

        // Exit edit mode if active (handles would reference stale features)
        if (typeof App.exitEditMode === "function") App.exitEditMode();

        applyState(state);
        save(); // persist imported state to localStorage

        if (typeof App.notifyProject === "function") App.notifyProject();

        var nFeatures = App.stations.length + App.lines.length + App.routes.length + App.polygons.length + (App.labels ? App.labels.length : 0);
        App.setStatus("Imported " + nFeatures + " feature" + (nFeatures !== 1 ? "s" : ""));
      } catch (parseErr) {
        App.setStatus("Import failed");
        alert("Import failed: the file does not contain valid JSON.");
      }
    };

    reader.onerror = function () {
      App.setStatus("Import failed");
      alert("Import failed: could not read file.");
    };

    reader.readAsText(file);
  }

  // ---- Shared download helper ----

  function _triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _dateStamp() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // ---- Export: JSON (Features only) ----

  function exportFeaturesOnly() {
    try {
      var state = {
        version: SCHEMA_VERSION,
        exportType: "features",
        stations: App.stations.slice(),
        lines: App.lines.slice(),
        routes: App.routes.slice(),
        polygons: App.polygons.slice(),
        labels: App.labels ? App.labels.slice() : [],
        bufferRadius: parseFloat(document.getElementById("bufferRadius").value) || 0.5,
        lineBufferRadius: parseFloat(document.getElementById("lineBufferRadius").value) || 0.5,
        routeBufferRadius: parseFloat(document.getElementById("routeBufferRadius").value) || 0.5
      };
      var json = JSON.stringify(state, null, 2);
      var blob = new Blob([json], { type: "application/json" });
      var filename = "features-" + _dateStamp() + ".json";
      _triggerDownload(blob, filename);
      App.setStatus("Exported " + filename);
    } catch (e) {
      console.warn("Export failed:", e);
      App.setStatus("Export failed: " + (e.message || e));
    }
  }

  // ---- Export: CSV ----

  var CSV_ATTR_COLS = [
    "routeGroup", "direction", "mode", "routeId", "frequency",
    "spanStart", "spanEnd", "daysOfService", "avgSpeed",
    "lineMode", "notes", "stopId", "stationGroup", "lineGroup",
    "polygonGroup", "labelGroup"
  ];

  function _featureToCSVRow(feat, typeName) {
    var geom = feat.geometry || {};
    var props = feat.properties || {};
    var attrs = props.attributes || {};
    var coords = geom.coordinates || [];
    var lon = "", lat = "";
    if (geom.type === "Point" && coords.length >= 2) {
      lon = coords[0]; lat = coords[1];
    } else if (coords.length > 0) {
      var first = coords;
      while (Array.isArray(first[0])) first = first[0];
      if (first.length >= 2) { lon = first[0]; lat = first[1]; }
    }
    var row = {
      type: typeName,
      name: props.name || "",
      color: props.color || "",
      geometry_type: geom.type || "",
      coordinates: JSON.stringify(coords),
      longitude: lon,
      latitude: lat
    };
    for (var i = 0; i < CSV_ATTR_COLS.length; i++) {
      var key = CSV_ATTR_COLS[i];
      var val = attrs[key];
      row[key] = (val != null) ? String(val) : "";
    }
    return row;
  }

  function exportCSV() {
    try {
      var rows = [];
      for (var si = 0; si < App.stations.length; si++) rows.push(_featureToCSVRow(App.stations[si], "station"));
      for (var li = 0; li < App.lines.length; li++) rows.push(_featureToCSVRow(App.lines[li], "line"));
      for (var ri = 0; ri < App.routes.length; ri++) rows.push(_featureToCSVRow(App.routes[ri], "route"));
      for (var pi = 0; pi < App.polygons.length; pi++) rows.push(_featureToCSVRow(App.polygons[pi], "polygon"));
      if (App.labels) {
        for (var lb = 0; lb < App.labels.length; lb++) rows.push(_featureToCSVRow(App.labels[lb], "label"));
      }
      if (rows.length === 0) {
        App.setStatus("Nothing to export — no features drawn.");
        return;
      }
      var csv = Papa.unparse(rows);
      var blob = new Blob([csv], { type: "text/csv" });
      var filename = "features-" + _dateStamp() + ".csv";
      _triggerDownload(blob, filename);
      App.setStatus("Exported " + filename);
    } catch (e) {
      console.warn("CSV export failed:", e);
      App.setStatus("CSV export failed: " + (e.message || e));
    }
  }

  // ---- Export: KML ----

  function _hexToKmlColor(hex) {
    // Convert #RRGGBB to KML aaBBGGRR (fully opaque)
    hex = (hex || "#3182ce").replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var r = hex.substring(0, 2), g = hex.substring(2, 4), b = hex.substring(4, 6);
    return "ff" + b + g + r;
  }

  function _coordsToKmlString(coords) {
    // coords is [lon,lat] or [[lon,lat],...] or [[[lon,lat],...]]
    if (typeof coords[0] === "number") {
      return coords[0] + "," + coords[1] + ",0";
    }
    var flat = coords;
    // Unwrap one level for polygons (outer ring)
    if (Array.isArray(flat[0]) && Array.isArray(flat[0][0])) flat = flat[0];
    var parts = [];
    for (var i = 0; i < flat.length; i++) {
      parts.push(flat[i][0] + "," + flat[i][1] + ",0");
    }
    return parts.join(" ");
  }

  function _xmlEscape(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function _buildPlacemark(feat, typeName) {
    var props = feat.properties || {};
    var attrs = props.attributes || {};
    var geom = feat.geometry || {};
    var name = props.name || typeName;
    var color = _hexToKmlColor(props.color);
    var kml = "    <Placemark>\n";
    kml += "      <name>" + _xmlEscape(name) + "</name>\n";
    kml += "      <Style><IconStyle><color>" + color + "</color></IconStyle>";
    kml += "<LineStyle><color>" + color + "</color><width>3</width></LineStyle>";
    kml += "<PolyStyle><color>" + color.substring(0, 2) + "80" + color.substring(4) + "</color></PolyStyle></Style>\n";

    // ExtendedData for attributes
    var attrKeys = Object.keys(attrs);
    if (attrKeys.length > 0 || typeName) {
      kml += "      <ExtendedData>\n";
      kml += "        <Data name=\"type\"><value>" + _xmlEscape(typeName) + "</value></Data>\n";
      for (var i = 0; i < attrKeys.length; i++) {
        var v = attrs[attrKeys[i]];
        if (v != null && v !== "") {
          kml += "        <Data name=\"" + _xmlEscape(attrKeys[i]) + "\"><value>" + _xmlEscape(v) + "</value></Data>\n";
        }
      }
      kml += "      </ExtendedData>\n";
    }

    // Geometry
    if (geom.type === "Point") {
      kml += "      <Point><coordinates>" + _coordsToKmlString(geom.coordinates) + "</coordinates></Point>\n";
    } else if (geom.type === "LineString") {
      kml += "      <LineString><coordinates>" + _coordsToKmlString(geom.coordinates) + "</coordinates></LineString>\n";
    } else if (geom.type === "Polygon") {
      kml += "      <Polygon><outerBoundaryIs><LinearRing><coordinates>" +
        _coordsToKmlString(geom.coordinates) +
        "</coordinates></LinearRing></outerBoundaryIs></Polygon>\n";
    }
    kml += "    </Placemark>\n";
    return kml;
  }

  function exportKML() {
    try {
      var kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n';
      kml += "  <name>Micro Analysis Tool Export</name>\n";

      var groups = [
        { name: "Stations", items: App.stations, type: "station" },
        { name: "Lines", items: App.lines, type: "line" },
        { name: "Routes", items: App.routes, type: "route" },
        { name: "Polygons", items: App.polygons, type: "polygon" }
      ];
      if (App.labels && App.labels.length > 0) {
        groups.push({ name: "Labels", items: App.labels, type: "label" });
      }

      var totalCount = 0;
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi];
        if (g.items.length === 0) continue;
        totalCount += g.items.length;
        kml += "  <Folder>\n    <name>" + g.name + "</name>\n";
        for (var fi = 0; fi < g.items.length; fi++) {
          kml += _buildPlacemark(g.items[fi], g.type);
        }
        kml += "  </Folder>\n";
      }

      kml += "</Document>\n</kml>";

      if (totalCount === 0) {
        App.setStatus("Nothing to export — no features drawn.");
        return;
      }

      var blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
      var filename = "features-" + _dateStamp() + ".kml";
      _triggerDownload(blob, filename);
      App.setStatus("Exported " + filename);
    } catch (e) {
      console.warn("KML export failed:", e);
      App.setStatus("KML export failed: " + (e.message || e));
    }
  }

  // ---- Export: Shapefile (SHP) — self-contained binary writer ----
  // Uses JSZip v3 (already loaded globally). No external shp-write dependency.

  var SHP_PRJ_WGS84 =
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  // SHP shape type constants
  var SHP_NULL = 0, SHP_POINT = 1, SHP_POLYLINE = 3, SHP_POLYGON = 5;

  function _featureProps(feat, typeName) {
    var props = feat.properties || {};
    var attrs = props.attributes || {};
    var out = { name: (props.name || "").substring(0, 50), type: typeName, color: props.color || "" };
    for (var i = 0; i < CSV_ATTR_COLS.length; i++) {
      var key = CSV_ATTR_COLS[i];
      var val = attrs[key];
      var dbfKey = key.substring(0, 10);
      out[dbfKey] = (val != null) ? String(val).substring(0, 254) : "";
    }
    return out;
  }

  // Collect coordinate rings from a geometry. Returns array of arrays of [x,y].
  // For Point: [[x,y]]. For LineString: [coords]. For Polygon: rings.
  // For Multi* types: flattens into parts array.
  function _extractParts(geometry) {
    var type = geometry.type;
    var coords = geometry.coordinates;
    if (type === "Point")              return [[coords]];
    if (type === "MultiPoint")         return coords.map(function (c) { return [c]; });
    if (type === "LineString")         return [coords];
    if (type === "MultiLineString")    return coords;
    if (type === "Polygon")            return coords;
    if (type === "MultiPolygon") {
      var parts = [];
      for (var i = 0; i < coords.length; i++) {
        for (var j = 0; j < coords[i].length; j++) parts.push(coords[i][j]);
      }
      return parts;
    }
    return [];
  }

  // Compute bounding box from an array of features
  function _bbox(features) {
    var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (var fi = 0; fi < features.length; fi++) {
      var parts = _extractParts(features[fi].geometry);
      for (var pi = 0; pi < parts.length; pi++) {
        for (var ci = 0; ci < parts[pi].length; ci++) {
          var x = parts[pi][ci][0], y = parts[pi][ci][1];
          if (x < xmin) xmin = x; if (x > xmax) xmax = x;
          if (y < ymin) ymin = y; if (y > ymax) ymax = y;
        }
      }
    }
    if (xmin === Infinity) { xmin = ymin = xmax = ymax = 0; }
    return { xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax };
  }

  // Ensure polygon ring is clockwise (exterior) per SHP spec.
  // Shapefile spec: exterior rings are clockwise, holes are counter-clockwise.
  function _ensureClockwise(ring) {
    var area = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      area += (ring[i + 1][0] - ring[i][0]) * (ring[i + 1][1] + ring[i][1]);
    }
    // area > 0 → clockwise in screen coords, but since Y is latitude (up = positive),
    // positive signed area means counter-clockwise geographically → need to reverse
    if (area > 0) ring.reverse();
    return ring;
  }

  // Write SHP + SHX binary for a set of features of the same shape type.
  // shapeType: SHP_POINT, SHP_POLYLINE, or SHP_POLYGON
  function _writeSHPSHX(features, shapeType) {
    // First pass: compute record content sizes
    var recordContentSizes = [];
    for (var fi = 0; fi < features.length; fi++) {
      var parts = _extractParts(features[fi].geometry);
      if (shapeType === SHP_POINT) {
        // Shape type (4) + X (8) + Y (8) = 20 bytes
        recordContentSizes.push(20);
      } else {
        // Shape type (4) + bbox (32) + numParts (4) + numPoints (4) + parts array + points
        var totalPts = 0;
        for (var pi = 0; pi < parts.length; pi++) {
          if (shapeType === SHP_POLYGON) _ensureClockwise(parts[pi]);
          totalPts += parts[pi].length;
        }
        recordContentSizes.push(4 + 32 + 4 + 4 + parts.length * 4 + totalPts * 16);
      }
    }

    // Calculate file sizes
    var shpFileBodySize = 0;
    for (var ri = 0; ri < recordContentSizes.length; ri++) {
      shpFileBodySize += 8 + recordContentSizes[ri]; // 8 = record header
    }
    var shpFileLength = 100 + shpFileBodySize; // in bytes
    var shxFileLength = 100 + features.length * 8;

    var shpBuf = new ArrayBuffer(shpFileLength);
    var shxBuf = new ArrayBuffer(shxFileLength);
    var shpView = new DataView(shpBuf);
    var shxView = new DataView(shxBuf);

    var box = _bbox(features);

    // Write file headers (100 bytes each) for both SHP and SHX
    function writeHeader(view, fileLengthBytes) {
      view.setInt32(0, 9994, false);                   // file code (big-endian)
      // bytes 4-23: unused (zeros)
      view.setInt32(24, fileLengthBytes / 2, false);   // file length in 16-bit words (big-endian)
      view.setInt32(28, 1000, true);                   // version (little-endian)
      view.setInt32(32, shapeType, true);               // shape type
      view.setFloat64(36, box.xmin, true);
      view.setFloat64(44, box.ymin, true);
      view.setFloat64(52, box.xmax, true);
      view.setFloat64(60, box.ymax, true);
      // bytes 68-99: zmin/zmax/mmin/mmax = 0 (2D only)
    }
    writeHeader(shpView, shpFileLength);
    writeHeader(shxView, shxFileLength);

    // Write records
    var shpOffset = 100; // current byte offset in SHP file
    for (var fi2 = 0; fi2 < features.length; fi2++) {
      var contentSize = recordContentSizes[fi2];
      var parts2 = _extractParts(features[fi2].geometry);

      // SHX index entry: offset and content length in 16-bit words (big-endian)
      shxView.setInt32(100 + fi2 * 8, shpOffset / 2, false);
      shxView.setInt32(100 + fi2 * 8 + 4, contentSize / 2, false);

      // SHP record header: record number (1-based) and content length in 16-bit words (big-endian)
      shpView.setInt32(shpOffset, fi2 + 1, false);
      shpView.setInt32(shpOffset + 4, contentSize / 2, false);
      shpOffset += 8;

      // SHP record content
      shpView.setInt32(shpOffset, shapeType, true);
      shpOffset += 4;

      if (shapeType === SHP_POINT) {
        var pt = features[fi2].geometry.coordinates;
        shpView.setFloat64(shpOffset, pt[0], true); shpOffset += 8;
        shpView.setFloat64(shpOffset, pt[1], true); shpOffset += 8;
      } else {
        // Bounding box for this record
        var recBox = _bbox([features[fi2]]);
        shpView.setFloat64(shpOffset, recBox.xmin, true); shpOffset += 8;
        shpView.setFloat64(shpOffset, recBox.ymin, true); shpOffset += 8;
        shpView.setFloat64(shpOffset, recBox.xmax, true); shpOffset += 8;
        shpView.setFloat64(shpOffset, recBox.ymax, true); shpOffset += 8;

        var numParts = parts2.length;
        var totalPoints = 0;
        for (var pp = 0; pp < numParts; pp++) totalPoints += parts2[pp].length;

        shpView.setInt32(shpOffset, numParts, true); shpOffset += 4;
        shpView.setInt32(shpOffset, totalPoints, true); shpOffset += 4;

        // Parts index array (offset into points array for each part)
        var ptIdx = 0;
        for (var pp2 = 0; pp2 < numParts; pp2++) {
          shpView.setInt32(shpOffset, ptIdx, true); shpOffset += 4;
          ptIdx += parts2[pp2].length;
        }

        // Points (x, y pairs)
        for (var pp3 = 0; pp3 < numParts; pp3++) {
          for (var ci2 = 0; ci2 < parts2[pp3].length; ci2++) {
            shpView.setFloat64(shpOffset, parts2[pp3][ci2][0], true); shpOffset += 8;
            shpView.setFloat64(shpOffset, parts2[pp3][ci2][1], true); shpOffset += 8;
          }
        }
      }
    }

    return { shp: shpBuf, shx: shxBuf };
  }

  // Write a DBF file for a set of features with given property objects.
  function _writeDBF(propsList) {
    if (!propsList.length) return new ArrayBuffer(0);

    // Determine fields from first record's keys
    var keys = Object.keys(propsList[0]);
    var fields = [];
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      // Determine max value length for field width
      var maxLen = 10;
      for (var ri = 0; ri < propsList.length; ri++) {
        var v = propsList[ri][k];
        var vLen = (v != null) ? String(v).length : 0;
        if (vLen > maxLen) maxLen = vLen;
      }
      if (maxLen > 254) maxLen = 254;
      fields.push({ name: k.substring(0, 10), width: maxLen });
    }

    var numRecords = propsList.length;
    var numFields = fields.length;
    var headerSize = 32 + numFields * 32 + 1; // 1 for header terminator (0x0D)
    var recordWidth = 1; // 1 byte for deletion flag
    for (var fi = 0; fi < numFields; fi++) recordWidth += fields[fi].width;
    var fileSize = headerSize + numRecords * recordWidth + 1; // +1 for EOF marker (0x1A)

    var buf = new ArrayBuffer(fileSize);
    var view = new DataView(buf);
    var bytes = new Uint8Array(buf);

    // DBF header
    view.setUint8(0, 3);                          // version: dBASE III
    var now = new Date();
    view.setUint8(1, now.getFullYear() - 1900);   // year
    view.setUint8(2, now.getMonth() + 1);          // month
    view.setUint8(3, now.getDate());               // day
    view.setInt32(4, numRecords, true);             // number of records
    view.setInt16(8, headerSize, true);             // header size
    view.setInt16(10, recordWidth, true);           // record size

    // Field descriptors (32 bytes each)
    for (var fi2 = 0; fi2 < numFields; fi2++) {
      var fdOffset = 32 + fi2 * 32;
      var nameBytes = [];
      for (var ni = 0; ni < 11; ni++) {
        nameBytes.push(ni < fields[fi2].name.length ? fields[fi2].name.charCodeAt(ni) : 0);
      }
      for (var ni2 = 0; ni2 < 11; ni2++) bytes[fdOffset + ni2] = nameBytes[ni2];
      bytes[fdOffset + 11] = 67;  // field type 'C' (character)
      view.setUint8(fdOffset + 16, fields[fi2].width);  // field length
    }

    // Header terminator
    bytes[headerSize - 1] = 0x0D;

    // Records
    for (var ri2 = 0; ri2 < numRecords; ri2++) {
      var recOffset = headerSize + ri2 * recordWidth;
      bytes[recOffset] = 0x20; // deletion flag: space = not deleted
      var fieldOffset = recOffset + 1;
      for (var fi3 = 0; fi3 < numFields; fi3++) {
        var val = propsList[ri2][keys[fi3]];
        var str = (val != null) ? String(val) : "";
        // Right-pad with spaces to field width
        while (str.length < fields[fi3].width) str += " ";
        str = str.substring(0, fields[fi3].width);
        for (var si = 0; si < str.length; si++) {
          bytes[fieldOffset + si] = str.charCodeAt(si) & 0xFF;
        }
        fieldOffset += fields[fi3].width;
      }
    }

    // EOF marker
    bytes[fileSize - 1] = 0x1A;

    return buf;
  }

  function exportSHP() {
    if (typeof JSZip === "undefined") {
      alert("JSZip library not loaded. Please check your internet connection and reload.");
      return;
    }
    try {
      var points = [], polylines = [], polys = [];
      var pointProps = [], polylineProps = [], polyProps = [];

      for (var si = 0; si < App.stations.length; si++) {
        var s = App.stations[si];
        if (!s.geometry) continue;
        points.push({ geometry: s.geometry, properties: s.properties });
        pointProps.push(_featureProps(s, "station"));
      }
      for (var li = 0; li < App.lines.length; li++) {
        var l = App.lines[li];
        if (!l.geometry) continue;
        polylines.push({ geometry: l.geometry, properties: l.properties });
        polylineProps.push(_featureProps(l, "line"));
      }
      for (var ri = 0; ri < App.routes.length; ri++) {
        var r = App.routes[ri];
        if (!r.geometry) continue;
        polylines.push({ geometry: r.geometry, properties: r.properties });
        polylineProps.push(_featureProps(r, "route"));
      }
      for (var pi = 0; pi < App.polygons.length; pi++) {
        var p = App.polygons[pi];
        if (!p.geometry) continue;
        polys.push({ geometry: p.geometry, properties: p.properties });
        polyProps.push(_featureProps(p, "polygon"));
      }

      if (points.length + polylines.length + polys.length === 0) {
        App.setStatus("Nothing to export — no features drawn.");
        return;
      }

      var zip = new JSZip();

      // Write each geometry-type layer as a set of .shp/.shx/.dbf/.prj files
      if (points.length) {
        var ptFiles = _writeSHPSHX(points, SHP_POINT);
        zip.file("stations.shp", ptFiles.shp);
        zip.file("stations.shx", ptFiles.shx);
        zip.file("stations.dbf", _writeDBF(pointProps));
        zip.file("stations.prj", SHP_PRJ_WGS84);
      }
      if (polylines.length) {
        var lnFiles = _writeSHPSHX(polylines, SHP_POLYLINE);
        zip.file("lines_routes.shp", lnFiles.shp);
        zip.file("lines_routes.shx", lnFiles.shx);
        zip.file("lines_routes.dbf", _writeDBF(polylineProps));
        zip.file("lines_routes.prj", SHP_PRJ_WGS84);
      }
      if (polys.length) {
        var pgFiles = _writeSHPSHX(polys, SHP_POLYGON);
        zip.file("polygons.shp", pgFiles.shp);
        zip.file("polygons.shx", pgFiles.shx);
        zip.file("polygons.dbf", _writeDBF(polyProps));
        zip.file("polygons.prj", SHP_PRJ_WGS84);
      }

      var filename = "features-" + _dateStamp() + ".zip";
      App.setStatus("Generating shapefile...");

      zip.generateAsync({ type: "blob" }).then(function (blob) {
        _triggerDownload(blob, filename);
        App.setStatus("Exported " + filename);
      }).catch(function (err) {
        console.error("SHP export failed:", err);
        App.setStatus("SHP export failed: " + (err.message || err));
      });
    } catch (e) {
      console.error("SHP export failed:", e);
      App.setStatus("SHP export failed: " + (e.message || e));
    }
  }

  // ---- Import helpers ----

  // ---- Shared import helpers ----

  // Flatten any GeoJSON geometry (including Multi* and GeometryCollection) into
  // an array of simple {type, coordinates} objects (Point, LineString, Polygon).
  function _flattenGeometry(geom) {
    if (!geom || !geom.type) return [];
    switch (geom.type) {
      case "Point":
      case "LineString":
      case "Polygon":
        return [{ type: geom.type, coordinates: geom.coordinates }];
      case "MultiPoint":
        return (geom.coordinates || []).map(function (c) {
          return { type: "Point", coordinates: c };
        });
      case "MultiLineString":
        return (geom.coordinates || []).map(function (c) {
          return { type: "LineString", coordinates: c };
        });
      case "MultiPolygon":
        return (geom.coordinates || []).map(function (c) {
          return { type: "Polygon", coordinates: c };
        });
      case "GeometryCollection":
        var out = [];
        var geos = geom.geometries || [];
        for (var i = 0; i < geos.length; i++) {
          out = out.concat(_flattenGeometry(geos[i]));
        }
        return out;
      default:
        return [];
    }
  }

  // Recursively reproject a coordinate array from sourceCRS to WGS84 using proj4.
  // Handles nested arrays (LineString = [[x,y],...], Polygon = [[[x,y],...],...]).
  function _reprojectCoords(coords, sourceCRS) {
    if (!Array.isArray(coords) || coords.length === 0) return coords;
    // Leaf: [x, y] or [x, y, z]
    if (typeof coords[0] === "number") {
      var pt = proj4(sourceCRS, "EPSG:4326", [coords[0], coords[1]]);
      return coords.length > 2 ? [pt[0], pt[1], coords[2]] : pt;
    }
    // Recurse into nested arrays
    return coords.map(function (c) { return _reprojectCoords(c, sourceCRS); });
  }

  // Try to define a CRS in proj4 from a WKT .prj string or EPSG code string.
  // Returns the proj4 CRS key on success, or null if proj4 is not loaded or parsing fails.
  function _tryDefineProj(prjTextOrCode) {
    if (typeof proj4 === "undefined" || !prjTextOrCode) return null;
    try {
      // If it looks like an EPSG code, use it directly
      var epsgMatch = prjTextOrCode.match(/EPSG[:\s]*(\d+)/i);
      if (epsgMatch) {
        var code = "EPSG:" + epsgMatch[1];
        // proj4 may already know common codes (4326, 3857)
        try { proj4(code); return code; } catch (_) { /* unknown */ }
      }
      // Try parsing as WKT
      var key = "__import_crs__";
      proj4.defs(key, prjTextOrCode);
      // Verify the definition was accepted by doing a test transform
      proj4(key, "EPSG:4326", [0, 0]);
      return key;
    } catch (e) {
      return null;
    }
  }

  // Check if a CRS key is already WGS84 (no reprojection needed).
  function _isWGS84(crsKey) {
    if (!crsKey || typeof proj4 === "undefined") return true;
    try {
      var test = proj4(crsKey, "EPSG:4326", [500000, 4000000]);
      // If input = output (within tolerance), it's already WGS84
      return Math.abs(test[0] - 500000) < 0.0001 && Math.abs(test[1] - 4000000) < 0.0001;
    } catch (_) {
      return true; // can't transform → assume WGS84
    }
  }

  var MAX_FILE_SIZE = 50 * 1024 * 1024;   // 50 MB hard limit
  var WARN_FILE_SIZE = 10 * 1024 * 1024;   // 10 MB soft warning

  function _checkFileSize(file) {
    if (file.size > MAX_FILE_SIZE) {
      alert("File too large (" + Math.round(file.size / 1024 / 1024) + " MB). Maximum is 50 MB.");
      return false;
    }
    if (file.size > WARN_FILE_SIZE) {
      if (!confirm("This file is " + Math.round(file.size / 1024 / 1024) + " MB. Large files may be slow. Continue?")) {
        return false;
      }
    }
    return true;
  }

  // Returns "replace", "append", or "cancel".
  // If no existing features, returns "replace" (no dialog needed).
  function _confirmReplaceOrAppend() {
    var hasExisting = (App.stations.length > 0 || App.lines.length > 0 ||
                       App.routes.length > 0 || App.polygons.length > 0);
    if (!hasExisting) return "replace";

    // Three-way prompt: append (OK) / replace (second confirm) / cancel
    var choice = confirm(
      "Features already exist on the map.\n\n" +
      "OK = Add imported features to existing\n" +
      "Cancel = Replace all existing features"
    );
    if (choice) return "append";
    // User chose Cancel → confirm replacement
    if (confirm("Replace ALL existing features with the imported file?")) return "replace";
    return "cancel";
  }

  function _applyImportedFeatures(stations, lines, polygons, labels, mode) {
    if (typeof App.exitEditMode === "function") App.exitEditMode();

    stations = stations || [];
    lines = lines || [];
    polygons = polygons || [];
    labels = labels || [];

    if (mode === "append") {
      // Push new features onto existing arrays
      for (var si = 0; si < stations.length; si++) App.stations.push(stations[si]);
      for (var li = 0; li < lines.length; li++) App.lines.push(lines[li]);
      for (var pi = 0; pi < polygons.length; pi++) App.polygons.push(polygons[pi]);
      if (App.labels) {
        for (var la = 0; la < labels.length; la++) App.labels.push(labels[la]);
      }

      // Rebuild buffers and re-render
      var stationRadius = parseFloat(document.getElementById("bufferRadius").value) || 0.5;
      var lineRadius = parseFloat(document.getElementById("lineBufferRadius").value) || 0.5;
      var routeRadius = parseFloat(document.getElementById("routeBufferRadius").value) || 0.5;
      App.rebuildBuffers(stationRadius);
      App.rebuildLineBuffers(lineRadius);
      App.rebuildRouteBuffers(routeRadius);
      App.renderPolygonLayers();
      if (typeof App.renderLabelMarkers === "function") App.renderLabelMarkers();
      if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
    } else {
      // Replace: build minimal state for applyState
      var state = {
        version: SCHEMA_VERSION,
        stations: stations,
        lines: lines,
        routes: [],
        polygons: polygons,
        labels: labels,
        bufferRadius: parseFloat(document.getElementById("bufferRadius").value) || 0.5,
        lineBufferRadius: parseFloat(document.getElementById("lineBufferRadius").value) || 0.5,
        routeBufferRadius: parseFloat(document.getElementById("routeBufferRadius").value) || 0.5
      };
      applyState(state);
    }

    save();
    if (typeof App.notifyProject === "function") App.notifyProject();

    // Richer import summary with type breakdown
    var n = stations.length + lines.length + polygons.length + labels.length;
    var parts = [];
    if (stations.length > 0) parts.push(stations.length + " station" + (stations.length !== 1 ? "s" : ""));
    if (lines.length > 0) parts.push(lines.length + " line" + (lines.length !== 1 ? "s" : ""));
    if (polygons.length > 0) parts.push(polygons.length + " polygon" + (polygons.length !== 1 ? "s" : ""));
    if (labels.length > 0) parts.push(labels.length + " label" + (labels.length !== 1 ? "s" : ""));
    var modeLabel = mode === "append" ? "Added " : "Imported ";
    var detail = parts.length > 0 ? " (" + parts.join(", ") + ")" : "";
    App.setStatus(modeLabel + n + " feature" + (n !== 1 ? "s" : "") + detail);
  }

  function _makeFeature(geomType, coordinates, name, color, attrs) {
    var feat = {
      type: "Feature",
      geometry: { type: geomType, coordinates: coordinates },
      properties: { name: name || "", color: color || "" }
    };
    if (attrs && Object.keys(attrs).length > 0) {
      feat.properties.attributes = attrs;
    }
    return feat;
  }

  // ---- Import: CSV ----

  function importCSV(file) {
    if (!_checkFileSize(file)) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var result = Papa.parse(e.target.result, { header: true, skipEmptyLines: true });
        var rows = result.data || [];
        var headers = result.meta && result.meta.fields ? result.meta.fields : [];

        if (rows.length === 0) {
          alert("CSV file is empty or has no data rows.");
          return;
        }

        // Detect columns
        var hasGeomType = headers.indexOf("geometry_type") >= 0;
        var hasCoords = headers.indexOf("coordinates") >= 0;
        var hasLatLon = headers.indexOf("latitude") >= 0 && headers.indexOf("longitude") >= 0;

        if (!hasCoords && !hasLatLon) {
          alert("CSV must have either a 'coordinates' column or 'latitude' + 'longitude' columns.");
          return;
        }

        var _csvMode = _confirmReplaceOrAppend();
        if (_csvMode === "cancel") return;

        var stations = [], lineFeats = [], polygonFeats = [], labelFeats = [];
        var errors = 0;

        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var geomType = hasGeomType ? (row.geometry_type || "").trim() : "";
          var typeName = (row.type || "").toLowerCase().trim();
          var name = row.name || "";
          var color = row.color || "";

          var coords = null;
          if (hasCoords && row.coordinates) {
            try {
              coords = JSON.parse(row.coordinates);
            } catch (pe) {
              errors++;
              continue;
            }
          } else if (hasLatLon) {
            var lat = parseFloat(row.latitude);
            var lon = parseFloat(row.longitude);
            if (isFinite(lat) && isFinite(lon)) {
              coords = [lon, lat];
              if (!geomType) geomType = "Point";
            } else {
              errors++;
              continue;
            }
          }

          if (!coords) { errors++; continue; }

          // Collect known attribute columns + preserve all extra columns
          var attrs = {};
          var _csvStandardCols = ["type", "name", "color", "geometry_type", "coordinates", "latitude", "longitude"];
          for (var ai = 0; ai < CSV_ATTR_COLS.length; ai++) {
            var key = CSV_ATTR_COLS[ai];
            if (row[key] != null && row[key] !== "") attrs[key] = row[key];
          }
          // Copy any remaining non-standard columns as extra attributes
          for (var hi = 0; hi < headers.length; hi++) {
            var col = headers[hi];
            if (_csvStandardCols.indexOf(col) < 0 && CSV_ATTR_COLS.indexOf(col) < 0 &&
                row[col] != null && row[col] !== "") {
              attrs[col] = String(row[col]);
            }
          }

          // Determine feature type from geometry_type or type column
          var gType = geomType || "Point";
          var feat = _makeFeature(gType, coords, name, color, attrs);

          if (gType === "Point" || typeName === "station") {
            feat.geometry.type = "Point";
            stations.push(feat);
          } else if (gType === "LineString" || typeName === "line" || typeName === "route") {
            feat.geometry.type = "LineString";
            lineFeats.push(feat);
          } else if (gType === "Polygon" || typeName === "polygon") {
            feat.geometry.type = "Polygon";
            polygonFeats.push(feat);
          } else if (typeName === "label") {
            labelFeats.push(feat);
          } else {
            // Fallback: point if coords is simple pair, else line
            if (typeof coords[0] === "number" && !Array.isArray(coords[0])) {
              feat.geometry.type = "Point";
              stations.push(feat);
            } else {
              feat.geometry.type = "LineString";
              lineFeats.push(feat);
            }
          }
        }

        var total = stations.length + lineFeats.length + polygonFeats.length + labelFeats.length;
        if (total === 0) {
          alert("No valid features found in CSV." + (errors > 0 ? " (" + errors + " rows had errors)" : ""));
          return;
        }

        _applyImportedFeatures(stations, lineFeats, polygonFeats, labelFeats, _csvMode);
        if (errors > 0) App.setStatus((_csvMode === "append" ? "Added " : "Imported ") + total + " features (" + errors + " rows skipped)");
      } catch (err) {
        App.setStatus("CSV import failed");
        alert("CSV import failed: " + (err.message || err));
      }
    };
    reader.onerror = function () {
      alert("Could not read file.");
    };
    reader.readAsText(file);
  }

  // ---- Import: KML ----

  function _kmlColorToHex(kmlColor) {
    // KML color is aaBBGGRR — convert to #RRGGBB
    if (!kmlColor || kmlColor.length < 8) return "";
    var rr = kmlColor.substring(6, 8);
    var gg = kmlColor.substring(4, 6);
    var bb = kmlColor.substring(2, 4);
    return "#" + rr + gg + bb;
  }

  function _parseKmlCoords(text) {
    // KML coordinates: "lon,lat,alt lon,lat,alt ..."
    var pairs = text.trim().split(/\s+/);
    var coords = [];
    for (var i = 0; i < pairs.length; i++) {
      var parts = pairs[i].split(",");
      if (parts.length >= 2) {
        var lon = parseFloat(parts[0]);
        var lat = parseFloat(parts[1]);
        if (isFinite(lon) && isFinite(lat)) coords.push([lon, lat]);
      }
    }
    return coords;
  }

  // Parse a KML <Polygon> element into GeoJSON-style coordinate rings,
  // including inner boundaries (holes).
  function _parseKmlPolygon(pgEl) {
    var rings = [];
    // Outer boundary
    var outerBound = pgEl.getElementsByTagName("outerBoundaryIs")[0];
    var outerCoordEl = outerBound ? outerBound.getElementsByTagName("coordinates")[0] :
                       pgEl.getElementsByTagName("coordinates")[0];
    if (!outerCoordEl) return null;

    var outerCoords = _parseKmlCoords(outerCoordEl.textContent);
    if (outerCoords.length < 3) return null;

    // Ensure ring is closed
    var first = outerCoords[0], last = outerCoords[outerCoords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      outerCoords.push([first[0], first[1]]);
    }
    rings.push(outerCoords);

    // Inner boundaries (holes)
    var innerBounds = pgEl.getElementsByTagName("innerBoundaryIs");
    for (var ib = 0; ib < innerBounds.length; ib++) {
      var innerCoordEl = innerBounds[ib].getElementsByTagName("coordinates")[0];
      if (!innerCoordEl) continue;
      var innerCoords = _parseKmlCoords(innerCoordEl.textContent);
      if (innerCoords.length < 3) continue;
      // Ensure inner ring is closed
      var iFirst = innerCoords[0], iLast = innerCoords[innerCoords.length - 1];
      if (iFirst[0] !== iLast[0] || iFirst[1] !== iLast[1]) {
        innerCoords.push([iFirst[0], iFirst[1]]);
      }
      rings.push(innerCoords);
    }

    return rings;
  }

  // Extract geometries from a KML element (Placemark or MultiGeometry child).
  // Handles Point, LineString, Polygon, and MultiGeometry (recursive).
  function _extractKmlGeometries(el, name, color, attrs, stations, lineFeats, polygonFeats) {
    // Check for MultiGeometry first
    var multiGeoEls = el.getElementsByTagName("MultiGeometry");
    if (multiGeoEls.length > 0) {
      // Process each direct child geometry of the MultiGeometry
      var mg = multiGeoEls[0];
      var childIdx = 0;
      for (var c = 0; c < mg.childNodes.length; c++) {
        var child = mg.childNodes[c];
        if (child.nodeType !== 1) continue; // skip text nodes
        var tag = child.tagName;
        if (tag === "Point" || tag === "LineString" || tag === "Polygon") {
          childIdx++;
          var suffix = " " + childIdx;
          _extractSingleKmlGeometry(child, tag, name + suffix, color, attrs, stations, lineFeats, polygonFeats);
        }
      }
      return;
    }

    // Single geometry
    var ptEl = el.getElementsByTagName("Point")[0];
    var lsEl = el.getElementsByTagName("LineString")[0];
    var pgEl = el.getElementsByTagName("Polygon")[0];

    if (ptEl) {
      _extractSingleKmlGeometry(ptEl, "Point", name, color, attrs, stations, lineFeats, polygonFeats);
    } else if (lsEl) {
      _extractSingleKmlGeometry(lsEl, "LineString", name, color, attrs, stations, lineFeats, polygonFeats);
    } else if (pgEl) {
      _extractSingleKmlGeometry(pgEl, "Polygon", name, color, attrs, stations, lineFeats, polygonFeats);
    }
  }

  function _extractSingleKmlGeometry(geomEl, tag, name, color, attrs, stations, lineFeats, polygonFeats) {
    if (tag === "Point") {
      var ptCoordEl = geomEl.getElementsByTagName("coordinates")[0];
      if (ptCoordEl) {
        var pts = _parseKmlCoords(ptCoordEl.textContent);
        if (pts.length > 0) {
          stations.push(_makeFeature("Point", pts[0], name, color, attrs));
        }
      }
    } else if (tag === "LineString") {
      var lsCoordEl = geomEl.getElementsByTagName("coordinates")[0];
      if (lsCoordEl) {
        var lineCoords = _parseKmlCoords(lsCoordEl.textContent);
        if (lineCoords.length >= 2) {
          lineFeats.push(_makeFeature("LineString", lineCoords, name, color, attrs));
        }
      }
    } else if (tag === "Polygon") {
      var rings = _parseKmlPolygon(geomEl);
      if (rings) {
        polygonFeats.push(_makeFeature("Polygon", rings, name, color, attrs));
      }
    }
  }

  function _processKmlDoc(doc) {
    var placemarks = doc.getElementsByTagName("Placemark");
    var stations = [], lineFeats = [], polygonFeats = [];

    for (var i = 0; i < placemarks.length; i++) {
      var pm = placemarks[i];
      var nameEl = pm.getElementsByTagName("name")[0];
      var name = nameEl ? nameEl.textContent.trim() : "Feature " + (i + 1);

      // Extract color from inline Style
      var color = "";
      var styleEl = pm.getElementsByTagName("Style")[0];
      if (styleEl) {
        var colorEls = styleEl.getElementsByTagName("color");
        if (colorEls.length > 0) color = _kmlColorToHex(colorEls[0].textContent.trim());
      }

      // Extract attributes from ExtendedData
      var attrs = {};
      var extData = pm.getElementsByTagName("ExtendedData")[0];
      if (extData) {
        var dataEls = extData.getElementsByTagName("Data");
        for (var d = 0; d < dataEls.length; d++) {
          var dName = dataEls[d].getAttribute("name");
          var valEl = dataEls[d].getElementsByTagName("value")[0];
          if (dName && valEl && dName !== "type") {
            attrs[dName] = valEl.textContent.trim();
          }
        }
      }

      // Extract geometry elements from Placemark (or from MultiGeometry children)
      _extractKmlGeometries(pm, name, color, attrs, stations, lineFeats, polygonFeats);
    }

    return { stations: stations, lines: lineFeats, polygons: polygonFeats };
  }

  function importKML(file) {
    if (!_checkFileSize(file)) return;
    var ext = (file.name.split(".").pop() || "").toLowerCase();

    if (ext === "kmz") {
      // KMZ is a zip file containing doc.kml
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          if (typeof JSZip === "undefined") {
            alert("JSZip library not loaded. Cannot read KMZ files. Try a .kml file instead.");
            return;
          }
          JSZip.loadAsync(e.target.result).then(function (zip) {
            var kmlFile = null;
            zip.forEach(function (path, entry) {
              if (!kmlFile && /\.kml$/i.test(path)) kmlFile = entry;
            });
            if (!kmlFile) {
              alert("No .kml file found inside the KMZ archive.");
              return;
            }
            kmlFile.async("text").then(function (kmlText) {
              _finishKMLImport(kmlText);
            });
          }).catch(function (err) {
            alert("Could not read KMZ file: " + (err.message || err));
          });
        } catch (err) {
          alert("KMZ import failed: " + (err.message || err));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      var textReader = new FileReader();
      textReader.onload = function (e) {
        _finishKMLImport(e.target.result);
      };
      textReader.onerror = function () { alert("Could not read file."); };
      textReader.readAsText(file);
    }
  }

  function _finishKMLImport(kmlText) {
    try {
      var parser = new DOMParser();
      var doc = parser.parseFromString(kmlText, "text/xml");

      var parseError = doc.getElementsByTagName("parsererror");
      if (parseError.length > 0) {
        alert("Invalid KML file: XML parse error.");
        return;
      }

      var result = _processKmlDoc(doc);
      var total = result.stations.length + result.lines.length + result.polygons.length;

      if (total === 0) {
        alert("No valid features found in KML file.");
        return;
      }

      var _kmlMode = _confirmReplaceOrAppend();
      if (_kmlMode === "cancel") return;
      _applyImportedFeatures(result.stations, result.lines, result.polygons, [], _kmlMode);
    } catch (err) {
      App.setStatus("KML import failed");
      alert("KML import failed: " + (err.message || err));
    }
  }

  // ---- Import: Shapefile (SHP / ZIP) ----

  function importSHP(file) {
    if (!_checkFileSize(file)) return;

    var ext = (file.name.split(".").pop() || "").toLowerCase();
    var reader = new FileReader();

    reader.onload = function (e) {
      var buffer = e.target.result;
      if (ext === "zip") {
        _importSHPFromZip(buffer);
      } else if (ext === "shp") {
        _parseSHPBuffers(buffer, null, null);
      } else {
        alert("Expected a .shp or .zip file.");
      }
    };
    reader.onerror = function () { alert("Could not read file."); };
    reader.readAsArrayBuffer(file);
  }

  function _importSHPFromZip(zipBuffer) {
    if (typeof JSZip === "undefined") {
      alert("JSZip library not loaded. Cannot read ZIP files. Please check your internet connection and reload.");
      return;
    }

    JSZip.loadAsync(zipBuffer).then(function (zip) {
      var shpEntry = null, dbfEntry = null, prjEntry = null;

      zip.forEach(function (path, entry) {
        var lower = path.toLowerCase();
        if (/\.shp$/.test(lower) && !shpEntry) shpEntry = entry;
        if (/\.dbf$/.test(lower) && !dbfEntry) dbfEntry = entry;
        if (/\.prj$/.test(lower) && !prjEntry) prjEntry = entry;
      });

      if (!shpEntry) {
        alert("No .shp file found in the ZIP archive.");
        return;
      }

      var promises = [shpEntry.async("arraybuffer")];
      promises.push(dbfEntry ? dbfEntry.async("arraybuffer") : Promise.resolve(null));
      promises.push(prjEntry ? prjEntry.async("text") : Promise.resolve(null));

      Promise.all(promises).then(function (results) {
        var shpBuf = results[0];
        var dbfBuf = results[1];
        var prjText = results[2];

        // Attempt auto-reprojection for non-WGS84 shapefiles
        var shpCrsKey = null;
        if (prjText && prjText.indexOf("GCS_WGS_1984") < 0 && prjText.indexOf("4326") < 0 &&
            prjText.indexOf("WGS 84") < 0 && prjText.indexOf("WGS_84") < 0 && prjText.indexOf("WGS84") < 0) {
          shpCrsKey = _tryDefineProj(prjText);
          if (shpCrsKey && _isWGS84(shpCrsKey)) {
            shpCrsKey = null; // actually WGS84 after all
          } else if (shpCrsKey) {
            App.setStatus("Reprojecting from non-WGS84 coordinate system\u2026");
          } else {
            // proj4 couldn't parse the .prj — warn and continue as-is
            if (!confirm("This shapefile uses an unrecognized coordinate system.\n" +
                         "Features may appear in the wrong location. Continue anyway?")) {
              return;
            }
          }
        }

        _parseSHPBuffers(shpBuf, dbfBuf, shpCrsKey);
      }).catch(function (err) {
        alert("Error reading ZIP contents: " + (err.message || err));
      });
    }).catch(function (err) {
      alert("Could not read ZIP file: " + (err.message || err));
    });
  }

  function _parseSHPBuffers(shpBuf, dbfBuf, crsKey) {
    if (typeof shapefile === "undefined") {
      alert("Shapefile library not loaded. Please check your internet connection and reload.");
      return;
    }

    shapefile.read(shpBuf, dbfBuf).then(function (geojson) {
      if (!geojson || !geojson.features || geojson.features.length === 0) {
        alert("Shapefile contains no features.");
        return;
      }

      var _shpMode = _confirmReplaceOrAppend();
      if (_shpMode === "cancel") return;

      var stations = [], lineFeats = [], polygonFeats = [];

      for (var i = 0; i < geojson.features.length; i++) {
        var feat = geojson.features[i];
        var geom = feat.geometry;
        var props = feat.properties || {};

        var name = props.name || props.NAME || props.Name || props.label || props.LABEL ||
                   props.id || props.ID || ("Feature " + (i + 1));

        // Copy all properties as attributes
        var attrs = {};
        var propKeys = Object.keys(props);
        for (var k = 0; k < propKeys.length; k++) {
          var pk = propKeys[k];
          var pv = props[pk];
          if (pv != null && pv !== "" && pk.toLowerCase() !== "name") {
            attrs[pk] = String(pv);
          }
        }

        if (!geom) continue;

        // Use shared geometry flattener (handles Multi* and GeometryCollection)
        var simples = _flattenGeometry(geom);
        for (var s = 0; s < simples.length; s++) {
          var sg = simples[s];
          var coords = sg.coordinates;

          // Reproject if non-WGS84 CRS was detected
          if (crsKey) {
            coords = _reprojectCoords(coords, crsKey);
          }

          var suffix = simples.length > 1 ? " " + (s + 1) : "";
          if (sg.type === "Point") {
            stations.push(_makeFeature("Point", coords, String(name) + suffix, "", attrs));
          } else if (sg.type === "LineString") {
            lineFeats.push(_makeFeature("LineString", coords, String(name) + suffix, "", attrs));
          } else if (sg.type === "Polygon") {
            polygonFeats.push(_makeFeature("Polygon", coords, String(name) + suffix, "", attrs));
          }
        }
      }

      var total = stations.length + lineFeats.length + polygonFeats.length;
      if (total === 0) {
        alert("No supported geometry types found in shapefile.");
        return;
      }

      _applyImportedFeatures(stations, lineFeats, polygonFeats, [], _shpMode);
      if (crsKey) App.setStatus("Imported and reprojected " + total + " features to WGS84");
    }).catch(function (err) {
      alert("Shapefile import failed: " + (err.message || err));
    });
  }

  // ---- Import: GeoJSON (FeatureCollection, Feature, or bare Geometry) ----

  function importGeoJSON(file) {
    if (!_checkFileSize(file)) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);

        // Normalize to a features array
        var features = [];
        if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
          features = data.features;
        } else if (data.type === "Feature" && data.geometry) {
          features = [data];
        } else if (data.type && data.coordinates) {
          // Bare geometry
          features = [{ type: "Feature", geometry: data, properties: {} }];
        } else {
          alert("Unrecognized GeoJSON structure. Expected FeatureCollection, Feature, or Geometry.");
          return;
        }

        if (features.length === 0) {
          alert("GeoJSON contains no features.");
          return;
        }

        // Check for CRS property (legacy GeoJSON spec) and reproject if needed
        var crsKey = null;
        if (data.crs && data.crs.properties) {
          var crsName = data.crs.properties.name || data.crs.properties.href || "";
          // Skip if already WGS84
          if (crsName.indexOf("4326") < 0 && crsName.indexOf("CRS84") < 0) {
            crsKey = _tryDefineProj(crsName);
            if (crsKey && _isWGS84(crsKey)) crsKey = null;
            if (!crsKey && crsName) {
              if (!confirm("This GeoJSON specifies CRS \"" + crsName + "\" which could not be auto-reprojected.\n" +
                           "Features may appear in the wrong location. Continue anyway?")) {
                return;
              }
            }
          }
        }

        var _gjMode = _confirmReplaceOrAppend();
        if (_gjMode === "cancel") return;

        var stations = [], lineFeats = [], polygonFeats = [];

        for (var i = 0; i < features.length; i++) {
          var feat = features[i];
          var props = feat.properties || {};
          var geom = feat.geometry;
          if (!geom) continue;

          var name = props.name || props.NAME || props.Name || props.label || props.LABEL ||
                     props.id || props.ID || ("Feature " + (i + 1));

          // Collect all properties as attributes (excluding name)
          var attrs = {};
          var propKeys = Object.keys(props);
          for (var k = 0; k < propKeys.length; k++) {
            var pk = propKeys[k];
            var pv = props[pk];
            if (pv != null && pv !== "" && pk.toLowerCase() !== "name") {
              attrs[pk] = typeof pv === "object" ? JSON.stringify(pv) : String(pv);
            }
          }

          // Detect color from properties
          var color = props.color || props.stroke || props.fill || "";

          // Flatten geometry (handles Multi* and GeometryCollection)
          var simples = _flattenGeometry(geom);
          for (var s = 0; s < simples.length; s++) {
            var sg = simples[s];
            var coords = sg.coordinates;

            // Reproject if needed
            if (crsKey) {
              coords = _reprojectCoords(coords, crsKey);
            }

            var suffix = simples.length > 1 ? " " + (s + 1) : "";
            if (sg.type === "Point") {
              stations.push(_makeFeature("Point", coords, String(name) + suffix, color, attrs));
            } else if (sg.type === "LineString") {
              lineFeats.push(_makeFeature("LineString", coords, String(name) + suffix, color, attrs));
            } else if (sg.type === "Polygon") {
              polygonFeats.push(_makeFeature("Polygon", coords, String(name) + suffix, color, attrs));
            }
          }
        }

        var total = stations.length + lineFeats.length + polygonFeats.length;
        if (total === 0) {
          alert("No supported geometry types found in GeoJSON.");
          return;
        }

        _applyImportedFeatures(stations, lineFeats, polygonFeats, [], _gjMode);
      } catch (parseErr) {
        App.setStatus("GeoJSON import failed");
        alert("GeoJSON import failed: " + (parseErr.message || parseErr));
      }
    };
    reader.onerror = function () { alert("Could not read file."); };
    reader.readAsText(file);
  }

  // ---- Share link: compress full state into URL hash ----

  function exportShareLink() {
    try {
      var state = collectState("full");
      var json = JSON.stringify(state);
      var compressed = pako.deflate(json, { level: 9 });
      var binary = "";
      for (var i = 0; i < compressed.length; i++) {
        binary += String.fromCharCode(compressed[i]);
      }
      var b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      var url = window.location.origin + window.location.pathname + "#share=" + b64;
      navigator.clipboard.writeText(url).then(function () {
        App.setStatus("Share link copied to clipboard");
      }).catch(function () {
        prompt("Copy this share link:", url);
      });
    } catch (e) {
      App.setStatus("Share link failed: " + (e.message || e));
    }
  }

  // ---- Load shared session from URL hash (called on startup) ----

  function loadShareLink() {
    var match = window.location.hash.match(/^#share=([A-Za-z0-9\-_]+)/);
    if (!match) return false;
    try {
      var b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var json = pako.inflate(bytes, { to: "string" });
      var state = JSON.parse(json);
      var err = validateState(state);
      if (err) { console.warn("Share link invalid:", err); return false; }
      applyState(state);
      _viewOnly = true;
      document.body.classList.add("view-only-mode");
      var banner = document.getElementById("view-only-banner");
      if (banner) banner.style.display = "block";
      App.setStatus("Viewing shared session");
      return true;
    } catch (e) {
      console.warn("Failed to load share link:", e);
      return false;
    }
  }

  // ---- Expose on App namespace ----

  App.cache = {
    save: save,
    restore: restore,
    reset: reset,
    exportToFile: exportToFile,
    exportFeaturesOnly: exportFeaturesOnly,
    exportShareLink: exportShareLink,
    loadShareLink: loadShareLink,
    exportCSV: exportCSV,
    exportKML: exportKML,
    exportSHP: exportSHP,
    importFromFile: importFromFile,
    importCSV: importCSV,
    importKML: importKML,
    importSHP: importSHP,
    importGeoJSON: importGeoJSON,
    collectState: collectState,
    applyState: applyState,
    STORAGE_KEY: STORAGE_KEY,
    registerModule: function (id, handlers) {
      _moduleHandlers.push({ id: id, handlers: handlers });
    }
  };
})();
