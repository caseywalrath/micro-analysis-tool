// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, stations, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // Shorthand for the sidebar element resolver
  var el = App.sidebar.el;

  // ---- Draw mode ----

  App.drawMode = null; // null | "station" | "line" | "route" | "polygon"

  // ---- Station-area Data panel (v2 sidebar) ----

  var STATION_DATA_PANEL_HTML =
    '<p class="sb2-muted">' +
      'Summaries are computed within the <b>dissolved union</b> of all station buffers (avoids double counting). ' +
      'Set the buffer radius in the Features panel. For ACS, counts are area-apportioned; medians are shown as an area-weighted average estimate.' +
    '</p>' +

    '<label>Geography level (ACS only)' +
      '<select id="v2-geoLevel">' +
        '<option value="tract">Census Tracts (faster)</option>' +
        '<option value="bg">Block Groups (more detailed)</option>' +
      '</select>' +
    '</label>' +

    '<label>Variable (ACS or LODES)' +
      '<select id="v2-varSelect">' +
        '<optgroup label="Land Use (ACS: additive sums)">' +
          '<option value="B01003_001E">Total population (ACS B01003_001E)</option>' +
          '<option value="B11001_001E">Total households (ACS B11001_001E)</option>' +
          '<option value="B25001_001E">Total housing units (ACS B25001_001E)</option>' +
          '<option value="B25002_001E">Occupied housing units (ACS B25002_001E)</option>' +
          '<option value="B25002_003E">Vacant housing units (ACS B25002_003E)</option>' +
        '</optgroup>' +
        '<optgroup label="Land Use / Employment (LODES: additive sum)">' +
          '<option value="LODES_WAC_C000">Total existing employment (LODES WAC C000) — requires file upload</option>' +
        '</optgroup>' +
        '<optgroup label="Mobility / Transit-dependent (ACS: additive sums)">' +
          '<option value="B08201_002E">Zero-car households (ACS B08201_002E)</option>' +
          '<option value="B17001_002E">Persons below poverty level (ACS B17001_002E)</option>' +
        '</optgroup>' +
        '<optgroup label="Non-additive (ACS medians: area-weighted average estimate)">' +
          '<option value="B19013_001E">Median household income (ACS B19013_001E) ⚠</option>' +
          '<option value="B25064_001E">Median gross rent (ACS B25064_001E) ⚠</option>' +
          '<option value="B25077_001E">Median home value (ACS B25077_001E) ⚠</option>' +
        '</optgroup>' +
      '</select>' +
    '</label>' +

    '<label>Year' +
      '<select id="v2-yearSelect">' +
        '<option value="2023">2023</option>' +
        '<option value="2022">2022</option>' +
        '<option value="2021">2021</option>' +
      '</select>' +
    '</label>' +

    '<button id="v2-run">Update summary</button>' +

    '<div id="v2-aggWarning" class="sb2-warn" style="display:none;"></div>' +

    '<div class="sb2-card">' +
      '<div class="sb2-kv"><b>Intersecting geographies:</b> <span id="v2-nGeos">0</span></div>' +
      '<div class="sb2-kv"><b>Aggregation method:</b> <span id="v2-aggMethod">—</span></div>' +
      '<div class="sb2-kv"><b>Result in buffer union:</b></div>' +
      '<div id="v2-total" style="font-size:22px;font-weight:700;margin-top:6px;">—</div>' +
      '<div id="v2-notes" class="sb2-tiny" style="margin-top:6px;"></div>' +
    '</div>';

  // ---- LODES panel (v2 sidebar) ----

  var LODES_PANEL_HTML =
    '<p class="sb2-muted">' +
      'Download the official <code>.csv.gz</code> file and load it from your computer (avoids cross-site fetch issues).' +
    '</p>' +

    '<div class="sb2-card">' +
      '<div class="sb2-kv"><b>Detected state:</b> <span id="v2-lodesState">\u2014</span></div>' +
      '<div class="sb2-kv"><b>LODES file loaded:</b> <span id="v2-lodesLoaded">No</span></div>' +
    '</div>' +

    '<button id="v2-downloadLodes">Download LODES WAC (JT00, S000) for current state</button>' +

    '<label>Load downloaded LODES file (.csv.gz)' +
      '<input id="v2-lodesFile" type="file" accept=".gz,.csv.gz" />' +
    '</label>' +

    '<div id="v2-lodesInfo" class="sb2-tiny" style="margin-top:6px;"></div>' +

    '<div class="sb2-warn">' +
      '<b>Prototype note:</b> Parsing statewide LODES files can be slow and memory-heavy. For production, use a backend ' +
      'or preprocessed extracts/tiles.' +
    '</div>';

  // ---- Project panel placeholder (v2 sidebar) ----
  // Content is moved from #project-panel when toggling sidebars.
  var PROJECT_PANEL_HTML = '<div id="v2-project-panel"></div>';

  // ---- Project registry ----

  var _project = null;

  App.registerProject = function (config) {
    _project = config;
  };

  // Build a core API object for passing to project hooks.
  // Rebuilt each call so values like lodesData are always current.
  function buildCore() {
    return {
      stations: App.stations,
      buffers: App.buffers,
      map: App.map,
      lodesData: App.lodesData,
      lodesFileName: App.lodesFileName,
      getUnion: function () { return App.bufferUnionPolygon(); },
      fetchTigerwebGeos: App.fetchTigerwebGeos,
      fetchACSValues: App.fetchACSValues,
      fetchACSCountyValues: App.fetchACSCountyValues,
      aggregateWithinUnion: App.aggregateWithinUnion,
      computeAcsValueOnly: App.computeAcsValueOnly,
      computeEmploymentServedOnly: App.computeEmploymentServedOnly,
      fetchBlocksInternalPointsInUnion: App.fetchBlocksInternalPointsInUnion,
      utils: {
        setStatus: App.setStatus,
        parseCSV: App.parseCSV,
        toNumberSafe: App.toNumberSafe,
        normalizeTractGEOID: App.normalizeTractGEOID,
        guessHeader: App.guessHeader,
        fillSelect: App.fillSelect,
        enableSelect: App.enableSelect,
        formatValue: App.formatValue,
        getMeta: App.getMeta,
        setAggUI: App.setAggUI
      }
    };
  }

  // Notify the active project that data has changed.
  async function notifyProject() {
    if (_project && typeof _project.update === "function") {
      await _project.update(buildCore());
    }
  }

  // ---- Summary runners ----

  async function runLodesEmploymentSummary(year) {
    var notesEl = el("notes");
    var totalEl = el("total");
    var nGeosEl = el("nGeos");

    notesEl.textContent = "";
    totalEl.textContent = "\u2014";
    nGeosEl.textContent = "0";

    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) {
      if (App.stations.length === 0) {
        App.setStatus("No stations yet");
        notesEl.textContent = "Add at least one station to compute employment served.";
      } else {
        App.setStatus("No buffers");
        notesEl.textContent = "Set a buffer radius in the Features panel to define the analysis area.";
      }
      return;
    }

    if (!App.lodesData) {
      App.setStatus("LODES file required");
      notesEl.textContent = "Download the LODES file for your state, then load the .csv.gz using the file picker.";
      return;
    }

    App.setStatus("Querying TIGERweb blocks\u2026");
    var blocksInside = await App.fetchBlocksInternalPointsInUnion(unionFeat);
    nGeosEl.textContent = String(blocksInside.size);

    App.setStatus("Summing jobs within union\u2026");
    var sum = 0;
    var matched = 0;

    for (var geoid of blocksInside) {
      var v = App.lodesData.get(geoid);
      if (v != null) { sum += v; matched++; }
    }

    totalEl.textContent = sum.toLocaleString(undefined, { maximumFractionDigits: 0 });
    notesEl.textContent =
      "LODES WAC C000 summed for " + matched.toLocaleString() + " matched blocks (of " +
      blocksInside.size.toLocaleString() + " blocks in union); year " + year +
      ". File: " + App.lodesFileName;

    App.setStatus("Done");
  }

  async function runAcsSummary(varCode, year, geoLevel) {
    var meta = App.getMeta(varCode);
    var notesEl = el("notes");
    var totalEl = el("total");
    var nGeosEl = el("nGeos");

    notesEl.textContent = "";
    totalEl.textContent = "\u2014";
    nGeosEl.textContent = "0";

    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) {
      if (App.stations.length === 0) {
        App.setStatus("No stations yet");
        notesEl.textContent = "Add at least one station to compute a station-area estimate.";
      } else {
        App.setStatus("No buffers");
        notesEl.textContent = "Set a buffer radius in the Features panel to define the analysis area.";
      }
      return;
    }

    App.setStatus("Querying TIGERweb\u2026");
    var geos = await App.fetchTigerwebGeos(geoLevel, unionFeat);
    nGeosEl.textContent = String(geos.length);
    App.renderCensusOverlay(geos);

    if (geos.length === 0) {
      App.setStatus("Done");
      notesEl.textContent = "No tracts/block groups intersect the station-area union (unexpected).";
      return;
    }

    App.setStatus("Fetching ACS values\u2026");
    var geoids = geos.map(function (f) { return f.properties.GEOID; }).filter(Boolean);
    var valueMap = await App.fetchACSValues(geoLevel, year, varCode, geoids);

    App.setStatus("Aggregating\u2026");
    var result = App.aggregateWithinUnion(unionFeat, geos, valueMap, meta.agg);
    totalEl.textContent = App.formatValue(result.value, meta);

    var geoLabel = (geoLevel === "tract") ? "tracts" : "block groups";
    if (meta.agg === "sum") {
      notesEl.textContent = "Sum of area-apportioned counts using " + result.used + " intersecting " + geoLabel + "; ACS " + year + " 5-year.";
    } else {
      notesEl.textContent = "Area-weighted average estimate using " + result.used + " intersecting " + geoLabel + " (weight sum=" + result.weightSum.toFixed(2) + "); ACS " + year + " 5-year.";
    }

    App.setStatus("Done");
  }

  async function runSummary() {
    var varCode = el("varSelect").value;
    var year = el("yearSelect").value;
    var geoLevel = el("geoLevel").value;

    var meta = App.getMeta(varCode);
    App.setAggUI(meta);

    if (meta.source === "LODES") {
      await runLodesEmploymentSummary(year);
    } else {
      await runAcsSummary(varCode, year, geoLevel);
    }

    await notifyProject();
  }

  // ---- Load project panel HTML ----

  async function loadProjectPanel() {
    if (!_project || !_project.panelHTML) return;
    var panel = document.getElementById("project-panel");
    if (!panel) return;
    try {
      var resp = await fetch(_project.panelHTML);
      if (resp.ok) {
        panel.innerHTML = await resp.text();
      }
    } catch (e) {
      console.warn("Could not load project panel:", e);
    }
  }

  // ---- Feature delete hook (called by features.js) ----

  App.onFeatureDelete = function () { notifyProject(); };

  // ---- Map load: wire everything ----

  App.map.on("load", async function () {
    App.setStatus("Ready");
    App.renderStationLayers();
    App.renderLineLayers();
    App.renderPolygonLayers();

    // Load project panel HTML, then init its event handlers
    await loadProjectPanel();
    if (_project && typeof _project.init === "function") {
      _project.init(buildCore());
    }

    // ---- Register v2 sidebar panels ----
    // Register all panels, render once, then wire event listeners.
    // The DOM persists across show/hide toggles so listeners stay attached.
    App.sidebar.addPanel({
      id: "station-data",
      title: "Station-area Data",
      html: STATION_DATA_PANEL_HTML,
      collapsed: false,
      order: 10
    });
    App.sidebar.addPanel({
      id: "lodes",
      title: "LODES (File-based workflow)",
      html: LODES_PANEL_HTML,
      collapsed: true,
      order: 30
    });
    // Only register the project panel if a project is active
    if (_project) {
      App.sidebar.addPanel({
        id: "project",
        title: _project.name || "Project",
        html: PROJECT_PANEL_HTML,
        collapsed: false,
        order: 20
      });
    }
    App.sidebar.render();
    wireV2StationDataEvents();
    wireV2LodesEvents();

    // ---- Sidebar v2 toggle (development aid) ----
    // Moves project panel DOM nodes between legacy and v2 containers
    // so event listeners (wired by project init) are preserved.
    function moveProjectContent(fromId, toId) {
      var from = document.getElementById(fromId);
      var to = document.getElementById(toId);
      if (!from || !to) return;
      while (from.firstChild) {
        to.appendChild(from.firstChild);
      }
    }

    var sidebarToggleBtn = document.getElementById("sidebar-toggle");
    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener("click", function () {
        var legacySidebar = document.getElementById("sidebar");
        var v2Active = App.sidebar.isActive();

        if (v2Active) {
          // Switch back to legacy
          moveProjectContent("v2-project-panel", "project-panel");
          App.sidebar.hide();
          if (legacySidebar) legacySidebar.style.display = "";
          sidebarToggleBtn.textContent = "Sidebar v2";
        } else {
          // Switch to v2
          moveProjectContent("project-panel", "v2-project-panel");
          if (legacySidebar) legacySidebar.style.display = "none";
          App.sidebar.show();
          sidebarToggleBtn.textContent = "Sidebar v1";
        }
      });
    }

    // ---- Toolbar: draw mode buttons ----
    var toolBtns = document.querySelectorAll(".tool-btn");
    toolBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var prevMode = App.drawMode;
        var clickedMode = btn.getAttribute("data-mode");

        // Toggle: clicking the active button deselects it
        if (App.drawMode === clickedMode) {
          App.drawMode = null;
          btn.classList.remove("active");
        } else {
          App.drawMode = clickedMode;
          toolBtns.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
        }

        // Cancel in-progress drawing when leaving a draw mode
        if (prevMode === "line" && App.drawMode !== "line") {
          App.cancelLineDrawing();
        }
        if (prevMode === "polygon" && App.drawMode !== "polygon") {
          App.cancelPolygonDrawing();
        }

        App.setStatus(App.drawMode
          ? App.drawMode.charAt(0).toUpperCase() + App.drawMode.slice(1) + " mode"
          : "Ready");
      });
    });

    // Variable selector (legacy sidebar)
    App.setAggUI(App.getMeta(document.getElementById("varSelect").value));
    document.getElementById("varSelect").addEventListener("change", function (e) {
      App.setAggUI(App.getMeta(e.target.value));
    });

    // Variable selector (v2 sidebar) — wired after panel render
    function wireV2StationDataEvents() {
      var v2Var = document.getElementById("v2-varSelect");
      var v2Run = document.getElementById("v2-run");
      if (v2Var) {
        v2Var.addEventListener("change", function (e) {
          App.setAggUI(App.getMeta(e.target.value));
        });
      }
      if (v2Run) {
        v2Run.addEventListener("click", async function () {
          try {
            await runSummary();
          } catch (e) {
            App.setStatus("Error");
            el("notes").textContent = String(e && e.message ? e.message : e);
          }
        });
      }
    }

    // Buffer radius input
    document.getElementById("bufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildBuffers(val);
      notifyProject();
    });

    // Map click: dispatch based on draw mode
    App.map.on("click", function (e) {
      if (App.drawMode === "station") {
        App.addStationPoint(e.lngLat.lng, e.lngLat.lat);
        notifyProject();
      } else if (App.drawMode === "line") {
        App.handleLineClick(e.lngLat);
        notifyProject();
      } else if (App.drawMode === "polygon") {
        App.handlePolygonClick(e.lngLat);
        notifyProject();
      }
    });

    // Clear stations
    document.getElementById("clear").addEventListener("click", function () {
      if (!confirm("Clear all features? This cannot be undone.")) return;
      App.clearStations();
      App.clearLines();
      App.clearPolygons();
      el("nGeos").textContent = "0";
      el("total").textContent = "\u2014";
      el("notes").textContent = "";
      App.setStatus("Cleared");
      notifyProject();
    });

    // Undo last station
    document.getElementById("undo").addEventListener("click", function () {
      if (App.drawMode === "line") {
        App.undoLastLine();
        notifyProject();
      } else if (App.drawMode === "polygon") {
        App.undoLastPolygon();
        notifyProject();
      } else if (App.stations.length > 0) {
        App.undoLastStation();
        App.setStatus("Updated");
        notifyProject();
      }
    });

    // Run summary (legacy sidebar)
    document.getElementById("run").addEventListener("click", async function () {
      try {
        await runSummary();
      } catch (e) {
        App.setStatus("Error");
        el("notes").textContent = String(e && e.message ? e.message : e);
      }
    });

    // LODES download (shared logic)
    async function handleLodesDownload() {
      try {
        App.setStatus("Determining state\u2026");
        var info = await App.getStateFromMapCenter();
        el("lodesState").textContent = info.abbr.toUpperCase() + " (FIPS " + info.stateFips + ")";

        var year = el("yearSelect").value;
        var url = "https://lehd.ces.census.gov/data/lodes/LODES8/" + info.abbr + "/wac/" + info.abbr + "_wac_S000_JT00_" + year + ".csv.gz";
        var filename = info.abbr + "_wac_S000_JT00_" + year + ".csv.gz";

        el("lodesInfo").textContent =
          "Downloading " + filename + ". After download completes, load it using the file picker below.";
        App.setStatus("Starting download\u2026");
        App.startDownload(url, filename);
        App.setStatus("Ready");
      } catch (e) {
        App.setStatus("Error");
        el("lodesInfo").textContent = String(e && e.message ? e.message : e);
      }
    }

    // LODES file upload (shared logic)
    async function handleLodesUpload(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        var jobsMap = await App.parseLodesFromUploadedFile(file);
        App.lodesData = jobsMap;
        App.lodesFileName = file.name;
        App.setLodesLoadedUI(true, file.name, jobsMap.size);
        App.setStatus("Ready");
        notifyProject();
      } catch (err) {
        App.lodesData = null;
        App.lodesFileName = "";
        App.setLodesLoadedUI(false, "", 0);
        App.setStatus("Error");
        el("lodesInfo").textContent = String(err && err.message ? err.message : err);
        notifyProject();
      }
    }

    // LODES events (legacy sidebar)
    document.getElementById("downloadLodes").addEventListener("click", handleLodesDownload);
    document.getElementById("lodesFile").addEventListener("change", handleLodesUpload);

    // LODES events (v2 sidebar) — wired after panel render
    function wireV2LodesEvents() {
      var v2Download = document.getElementById("v2-downloadLodes");
      var v2File = document.getElementById("v2-lodesFile");
      if (v2Download) v2Download.addEventListener("click", handleLodesDownload);
      if (v2File) v2File.addEventListener("change", handleLodesUpload);
    }
  });
})();
