// js/projects/gtfs.js
// GTFS Feed Viewer: loads a GTFS ZIP, renders shapes + stops as reference
// map layers, and provides a popup CSV table viewer for all feed files.
// Depends on: JSZip (CDN), PapaParse (CDN), App namespace, App.popup.

(function () {
  "use strict";
  var App = window.App = window.App || {};

  // ---- Module-local state ----
  var _gtfsData   = null;   // Map<filename, { headers: [], rows: [] }>
  var _selectedFile = null; // currently active file in the directory list
  var _initialized  = false;
  var _showRoutes   = true;
  var _showStops    = true;

  // GTFS files in preferred display order
  var FILE_ORDER = [
    "agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt",
    "calendar.txt", "calendar_dates.txt", "shapes.txt", "frequencies.txt",
    "transfers.txt", "fare_attributes.txt", "fare_rules.txt",
    "feed_info.txt", "attributions.txt"
  ];

  // Files classified as Required in the spec
  var REQUIRED = {
    "agency.txt": true, "stops.txt": true, "routes.txt": true,
    "trips.txt": true, "stop_times.txt": true,
    "calendar.txt": true, "calendar_dates.txt": true
  };

  // ---- Popup guard ----
  function isPopupVisible() {
    return App.popup && App.popup.isOpen() &&
           App.popup.currentModuleId() === "gtfs";
  }

  // ---- ZIP / CSV parsing ----

  async function loadGTFSFile(file) {
    App.setStatus("Reading GTFS feed\u2026");
    try {
      var zip = await JSZip.loadAsync(file);
    } catch (e) {
      App.setStatus("GTFS error: not a valid ZIP file.");
      return;
    }

    var data = new Map();
    var entries = [];

    // Collect all .txt files (handles top-level or inside a folder)
    zip.forEach(function (path, entry) {
      if (entry.dir) return;
      var name = path.split("/").pop(); // strip any subfolder prefix
      if (name.endsWith(".txt")) entries.push({ name: name, entry: entry });
    });

    if (!entries.length) {
      App.setStatus("GTFS error: no .txt files found in ZIP.");
      return;
    }

    App.setStatus("Parsing GTFS files\u2026");
    for (var i = 0; i < entries.length; i++) {
      var name  = entries[i].name;
      var entry = entries[i].entry;
      try {
        var text   = await entry.async("string");
        var parsed = Papa.parse(text.trim(), {
          header:         true,
          skipEmptyLines: true,
          dynamicTyping:  false
        });
        data.set(name, {
          headers: parsed.meta.fields || [],
          rows:    parsed.data
        });
      } catch (e) {
        console.warn("GTFS: could not parse", name, e);
      }
    }

    _gtfsData = data;
    _selectedFile = null;

    addMapLayers();
    updateDropdownUI();

    if (isPopupVisible()) {
      renderFileList();
      showSelectPrompt();
    }

    App.setStatus("GTFS loaded: " + data.size + " file(s).");
  }

  function clearGTFS() {
    _gtfsData = null;
    _selectedFile = null;
    removeMapLayers();
    updateDropdownUI();
    if (isPopupVisible()) {
      renderFileList();
      showSelectPrompt();
      var mc = document.getElementById("gtfsMapControls");
      if (mc) mc.style.display = "none";
    }
    App.setStatus("GTFS feed cleared.");
  }

  // ---- Map layers ----

  function firstUserLayer() {
    var map = App.map;
    var candidates = ["stations-layer", "lines-layer", "routes-layer", "polygons-fill"];
    for (var i = 0; i < candidates.length; i++) {
      if (map.getLayer(candidates[i])) return candidates[i];
    }
    return undefined;
  }

  function addMapLayers() {
    var map = App.map;
    if (!map) return;

    removeMapLayers();

    var before = firstUserLayer();

    // --- shapes.txt → route geometry ---
    if (_gtfsData && _gtfsData.has("shapes.txt")) {
      var shapesFC = buildShapesGeoJSON(_gtfsData.get("shapes.txt").rows);
      map.addSource("gtfs-shapes", { type: "geojson", data: shapesFC });
      map.addLayer({
        id:     "gtfs-shapes-layer",
        type:   "line",
        source: "gtfs-shapes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color":   "#718096",
          "line-width":   2,
          "line-opacity": 0.65,
          "line-dasharray": [4, 2]
        }
      }, before);
      map.setLayoutProperty("gtfs-shapes-layer", "visibility",
        _showRoutes ? "visible" : "none");
    }

    // --- stops.txt → stop circles ---
    if (_gtfsData && _gtfsData.has("stops.txt")) {
      var stopsFC = buildStopsGeoJSON(_gtfsData.get("stops.txt").rows);
      map.addSource("gtfs-stops", { type: "geojson", data: stopsFC });
      // Insert above shapes but still below user layers
      var beforeStops = map.getLayer("gtfs-shapes-layer") ? "gtfs-shapes-layer" : before;
      // Stops should be above shapes
      map.addLayer({
        id:     "gtfs-stops-layer",
        type:   "circle",
        source: "gtfs-stops",
        paint: {
          "circle-radius":       4,
          "circle-color":        "#ffffff",
          "circle-stroke-color": "#718096",
          "circle-stroke-width": 1.5,
          "circle-opacity":      0.85
        }
      }, before);
      map.setLayoutProperty("gtfs-stops-layer", "visibility",
        _showStops ? "visible" : "none");
    }
  }

  function removeMapLayers() {
    var map = App.map;
    if (!map) return;
    ["gtfs-shapes-layer", "gtfs-stops-layer"].forEach(function (id) {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    ["gtfs-shapes", "gtfs-stops"].forEach(function (id) {
      if (map.getSource(id)) map.removeSource(id);
    });
  }

  function setRouteLayerVisibility(visible) {
    _showRoutes = visible;
    var map = App.map;
    if (map && map.getLayer("gtfs-shapes-layer")) {
      map.setLayoutProperty("gtfs-shapes-layer", "visibility",
        visible ? "visible" : "none");
    }
  }

  function setStopLayerVisibility(visible) {
    _showStops = visible;
    var map = App.map;
    if (map && map.getLayer("gtfs-stops-layer")) {
      map.setLayoutProperty("gtfs-stops-layer", "visibility",
        visible ? "visible" : "none");
    }
  }

  // ---- GeoJSON builders ----

  function buildShapesGeoJSON(rows) {
    // Group points by shape_id, sort by sequence, build LineStrings
    var groups = {};
    for (var i = 0; i < rows.length; i++) {
      var r   = rows[i];
      var id  = r.shape_id;
      var lat = parseFloat(r.shape_pt_lat);
      var lon = parseFloat(r.shape_pt_lon);
      var seq = parseInt(r.shape_pt_sequence, 10);
      if (!id || isNaN(lat) || isNaN(lon) || isNaN(seq)) continue;
      if (!groups[id]) groups[id] = [];
      groups[id].push([seq, lon, lat]);
    }

    var features = [];
    var ids = Object.keys(groups);
    for (var j = 0; j < ids.length; j++) {
      var sid = ids[j];
      var pts = groups[sid];
      pts.sort(function (a, b) { return a[0] - b[0]; });
      var coords = pts.map(function (p) { return [p[1], p[2]]; });
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { shape_id: sid },
        geometry: { type: "LineString", coordinates: coords }
      });
    }
    return { type: "FeatureCollection", features: features };
  }

  function buildStopsGeoJSON(rows) {
    var features = [];
    for (var i = 0; i < rows.length; i++) {
      var r   = rows[i];
      var lat = parseFloat(r.stop_lat);
      var lon = parseFloat(r.stop_lon);
      if (isNaN(lat) || isNaN(lon)) continue;
      // Only include actual stops (location_type 0 or absent)
      var lt = r.location_type;
      if (lt && lt !== "0" && lt !== "") continue;
      features.push({
        type: "Feature",
        properties: r,
        geometry: { type: "Point", coordinates: [lon, lat] }
      });
    }
    return { type: "FeatureCollection", features: features };
  }

  // ---- Dropdown UI ----

  function updateDropdownUI() {
    var loadBtn  = document.getElementById("gtfs-load-btn");
    var clearBtn = document.getElementById("gtfs-clear-btn");
    if (!loadBtn || !clearBtn) return;
    var hasData = _gtfsData && _gtfsData.size > 0;
    clearBtn.style.display = hasData ? "" : "none";
  }

  // ---- Popup rendering ----

  function renderFileList() {
    var list = document.getElementById("gtfsFileList");
    if (!list) return;

    if (!_gtfsData || _gtfsData.size === 0) {
      list.innerHTML =
        '<div class="gtfs-empty-state">No GTFS feed loaded.<br>' +
        'Use Add\u00a0Data\u00a0(+) \u2192 GTFS to load a feed.</div>';
      var mc = document.getElementById("gtfsMapControls");
      if (mc) mc.style.display = "none";
      return;
    }

    // Build ordered file list
    var known   = FILE_ORDER.filter(function (f) { return _gtfsData.has(f); });
    var unknown = [];
    _gtfsData.forEach(function (_, f) {
      if (FILE_ORDER.indexOf(f) === -1) unknown.push(f);
    });
    var allFiles = known.concat(unknown.sort());

    list.innerHTML = "";
    for (var i = 0; i < allFiles.length; i++) {
      var fname   = allFiles[i];
      var fileData = _gtfsData.get(fname);
      var isReq   = !!REQUIRED[fname];
      var active  = fname === _selectedFile ? " gtfs-file-active" : "";

      var btn = document.createElement("button");
      btn.className = "gtfs-file-item" + active;
      btn.innerHTML =
        '<span class="gtfs-file-name">' + fname + '</span>' +
        '<span class="gtfs-file-badge' + (isReq ? ' req' : '') + '">' +
          (isReq ? "REQ" : "OPT") +
        '</span>';
      btn.title = fileData.rows.length + " rows";

      (function (f) {
        btn.addEventListener("click", function () {
          _selectedFile = f;
          renderFileList(); // re-render to update active state
          renderTable(f);
        });
      })(fname);

      list.appendChild(btn);
    }

    // Show map controls
    var mc = document.getElementById("gtfsMapControls");
    if (mc) mc.style.display = "";
  }

  function showSelectPrompt() {
    var prompt  = document.getElementById("gtfsSelectPrompt");
    var wrapper = document.getElementById("gtfsTableWrapper");
    var title   = document.getElementById("gtfsTableTitle");
    var meta    = document.getElementById("gtfsTableMeta");
    if (prompt)  prompt.style.display  = "";
    if (wrapper) wrapper.style.display = "none";
    if (title)   title.style.display   = "none";
    if (meta)    meta.style.display    = "none";
  }

  var TABLE_ROW_LIMIT = 500;

  function renderTable(fname) {
    var fileData = _gtfsData && _gtfsData.get(fname);
    if (!fileData) return;

    var prompt  = document.getElementById("gtfsSelectPrompt");
    var wrapper = document.getElementById("gtfsTableWrapper");
    var title   = document.getElementById("gtfsTableTitle");
    var thead   = document.getElementById("gtfsTableHead");
    var tbody   = document.getElementById("gtfsTableBody");
    var meta    = document.getElementById("gtfsTableMeta");
    if (!wrapper || !thead || !tbody) return;

    if (prompt)  prompt.style.display  = "none";
    if (title) { title.textContent = fname; title.style.display = ""; }

    var headers = fileData.headers;
    var rows    = fileData.rows;
    var shown   = Math.min(rows.length, TABLE_ROW_LIMIT);

    // Build thead
    var thHtml = "<tr>";
    for (var h = 0; h < headers.length; h++) {
      thHtml += "<th>" + escHtml(headers[h]) + "</th>";
    }
    thHtml += "</tr>";
    thead.innerHTML = thHtml;

    // Build tbody (capped)
    var tbHtml = "";
    for (var r = 0; r < shown; r++) {
      tbHtml += "<tr>";
      for (var c = 0; c < headers.length; c++) {
        var val = rows[r][headers[c]];
        tbHtml += "<td>" + escHtml(val == null ? "" : String(val)) + "</td>";
      }
      tbHtml += "</tr>";
    }
    if (rows.length > TABLE_ROW_LIMIT) {
      tbHtml +=
        '<tr class="gtfs-table-truncated"><td colspan="' + headers.length + '">' +
        "Showing " + TABLE_ROW_LIMIT + " of " + rows.length.toLocaleString() + " rows" +
        "</td></tr>";
    }
    tbody.innerHTML = tbHtml;

    wrapper.style.display = "";

    // Meta line
    if (meta) {
      meta.textContent =
        rows.length.toLocaleString() + " row" + (rows.length !== 1 ? "s" : "") +
        ", " + headers.length + " column" + (headers.length !== 1 ? "s" : "");
      meta.style.display = "";
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- Module lifecycle ----

  function init(core) {
    _initialized = true;

    // Show routes checkbox
    var showRoutes = document.getElementById("gtfsShowRoutes");
    if (showRoutes) {
      showRoutes.checked = _showRoutes;
      showRoutes.addEventListener("change", function () {
        setRouteLayerVisibility(this.checked);
      });
    }

    // Show stops checkbox
    var showStops = document.getElementById("gtfsShowStops");
    if (showStops) {
      showStops.checked = _showStops;
      showStops.addEventListener("change", function () {
        setStopLayerVisibility(this.checked);
      });
    }

    // In-popup clear button
    var clearBtn = document.getElementById("gtfsClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        clearGTFS();
      });
    }
  }

  function onOpen(core) {
    // Sync checkbox state in case it was changed outside the popup
    var showRoutes = document.getElementById("gtfsShowRoutes");
    if (showRoutes) showRoutes.checked = _showRoutes;
    var showStops = document.getElementById("gtfsShowStops");
    if (showStops) showStops.checked = _showStops;

    renderFileList();

    if (_selectedFile && _gtfsData && _gtfsData.has(_selectedFile)) {
      renderTable(_selectedFile);
    } else {
      showSelectPrompt();
    }
  }

  // ---- Wire Add Data dropdown buttons ----
  // (done here rather than app.js so all GTFS logic stays in one file)

  var _fileInput = document.getElementById("gtfs-file-input");
  var _dropdown  = document.getElementById("add-data-dropdown");

  var _loadBtn  = document.getElementById("gtfs-load-btn");
  var _clearBtn = document.getElementById("gtfs-clear-btn");

  if (_loadBtn && _fileInput) {
    _loadBtn.addEventListener("click", function () {
      if (_dropdown) _dropdown.style.display = "none";
      _fileInput.value = "";
      _fileInput.click();
    });
  }

  if (_clearBtn) {
    _clearBtn.addEventListener("click", function () {
      if (_dropdown) _dropdown.style.display = "none";
      clearGTFS();
    });
  }

  if (_fileInput) {
    _fileInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      this.value = "";
      loadGTFSFile(file);
    });
  }

  // ---- Expose on App namespace ----
  App.gtfsData        = _gtfsData;   // live reference (null until loaded)
  App.loadGTFSFile    = loadGTFSFile;
  App.clearGTFS       = clearGTFS;

  // ---- Register analysis module ----
  App.registerModule({
    id:         "gtfs",
    name:       "GTFS Feed",
    enabled:    true,
    popupWidth: 960,
    popupHTML:  "projects/gtfs-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function () {},
    update:  async function (core) {}
  });

})();
