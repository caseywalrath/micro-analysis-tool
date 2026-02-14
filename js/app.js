// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, stations, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // ---- Draw mode ----

  App.drawMode = null; // null | "station" | "line" | "route" | "polygon"

  // ---- Station-area Data panel ----

  var STATION_DATA_PANEL_HTML =
    '<p class="sb2-muted">' +
      'Summaries are computed within the <b>dissolved union</b> of all station buffers (avoids double counting). ' +
      'Set the buffer radius in the Features panel. For ACS, counts are area-apportioned; medians are shown as an area-weighted average estimate.' +
    '</p>' +

    '<label>Geography level (ACS only)' +
      '<select id="geoLevel">' +
        '<option value="tract">Census Tracts (faster)</option>' +
        '<option value="bg">Block Groups (more detailed)</option>' +
      '</select>' +
    '</label>' +

    '<label>Variable (ACS or LODES)' +
      '<select id="varSelect">' +
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
      '<select id="yearSelect">' +
        '<option value="2023">2023</option>' +
        '<option value="2022">2022</option>' +
        '<option value="2021">2021</option>' +
      '</select>' +
    '</label>' +

    '<button id="run">Update summary</button>' +

    '<div id="aggWarning" class="sb2-warn" style="display:none;"></div>' +

    '<div class="sb2-card">' +
      '<div class="sb2-kv"><b>Intersecting geographies:</b> <span id="nGeos">0</span></div>' +
      '<div class="sb2-kv"><b>Aggregation method:</b> <span id="aggMethod">\u2014</span></div>' +
      '<div class="sb2-kv"><b>Result in buffer union:</b></div>' +
      '<div id="total" style="font-size:22px;font-weight:700;margin-top:6px;">\u2014</div>' +
      '<div id="notes" class="sb2-tiny" style="margin-top:6px;"></div>' +
    '</div>';

  // ---- LODES panel ----

  var LODES_PANEL_HTML =
    '<p class="sb2-muted">' +
      'Download the official <code>.csv.gz</code> file and load it from your computer (avoids cross-site fetch issues).' +
    '</p>' +

    '<div class="sb2-card">' +
      '<div class="sb2-kv"><b>Detected state:</b> <span id="lodesState">\u2014</span></div>' +
      '<div class="sb2-kv"><b>LODES file loaded:</b> <span id="lodesLoaded">No</span></div>' +
    '</div>' +

    '<button id="downloadLodes">Download LODES WAC (JT00, S000) for current state</button>' +

    '<label>Load downloaded LODES file (.csv.gz)' +
      '<input id="lodesFile" type="file" accept=".gz,.csv.gz" />' +
    '</label>' +

    '<div id="lodesInfo" class="sb2-tiny" style="margin-top:6px;"></div>' +

    '<div class="sb2-warn">' +
      '<b>Prototype note:</b> Parsing statewide LODES files can be slow and memory-heavy. For production, use a backend ' +
      'or preprocessed extracts/tiles.' +
    '</div>';

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
    var notesEl = document.getElementById("notes");
    var totalEl = document.getElementById("total");
    var nGeosEl = document.getElementById("nGeos");

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
    var notesEl = document.getElementById("notes");
    var totalEl = document.getElementById("total");
    var nGeosEl = document.getElementById("nGeos");

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
    var varCode = document.getElementById("varSelect").value;
    var year = document.getElementById("yearSelect").value;
    var geoLevel = document.getElementById("geoLevel").value;

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
    if (!_project) return;
    try {
      if (_project.panelHTML) {
        var panel = document.getElementById("project-panel");
        if (panel) {
          var resp = await fetch(_project.panelHTML);
          if (resp.ok) panel.innerHTML = await resp.text();
        }
      }
      if (Array.isArray(_project.panels)) {
        await Promise.all(_project.panels.map(async function (p) {
          if (!p.htmlFile) return;
          var el = document.getElementById(p.id + "-panel");
          if (!el) return;
          var resp = await fetch(p.htmlFile);
          if (resp.ok) el.innerHTML = await resp.text();
        }));
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

    // ---- Register sidebar panels, render, then wire events ----
    App.sidebar.addPanel({
      id: "station-data",
      title: "Station-area Data",
      html: STATION_DATA_PANEL_HTML,
      collapsed: false,
      order: 10
    });
    if (_project) {
      App.sidebar.addPanel({
        id: "project",
        title: _project.name || "Project",
        html: '<div id="project-panel"></div>',
        collapsed: false,
        order: 30
      });
      if (Array.isArray(_project.panels)) {
        _project.panels.forEach(function (p) {
          App.sidebar.addPanel({
            id: p.id,
            title: p.title,
            html: '<div id="' + p.id + '-panel"></div>',
            collapsed: p.collapsed !== false,
            order: p.order || 100
          });
        });
      }
    }
    App.sidebar.addPanel({
      id: "lodes",
      title: "LODES (File-based workflow)",
      html: LODES_PANEL_HTML,
      collapsed: true,
      order: 20
    });
    App.sidebar.render();

    // Load project panel HTML into #project-panel (now inside sidebar),
    // then init its event handlers.
    await loadProjectPanel();
    if (_project && typeof _project.init === "function") {
      _project.init(buildCore());
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

    // Variable selector
    App.setAggUI(App.getMeta(document.getElementById("varSelect").value));
    document.getElementById("varSelect").addEventListener("change", function (e) {
      App.setAggUI(App.getMeta(e.target.value));
    });

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
      document.getElementById("nGeos").textContent = "0";
      document.getElementById("total").textContent = "\u2014";
      document.getElementById("notes").textContent = "";
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

    // Run summary
    document.getElementById("run").addEventListener("click", async function () {
      try {
        await runSummary();
      } catch (e) {
        App.setStatus("Error");
        document.getElementById("notes").textContent = String(e && e.message ? e.message : e);
      }
    });

    // LODES download
    document.getElementById("downloadLodes").addEventListener("click", async function () {
      try {
        App.setStatus("Determining state\u2026");
        var info = await App.getStateFromMapCenter();
        document.getElementById("lodesState").textContent = info.abbr.toUpperCase() + " (FIPS " + info.stateFips + ")";

        var year = document.getElementById("yearSelect").value;
        var url = "https://lehd.ces.census.gov/data/lodes/LODES8/" + info.abbr + "/wac/" + info.abbr + "_wac_S000_JT00_" + year + ".csv.gz";
        var filename = info.abbr + "_wac_S000_JT00_" + year + ".csv.gz";

        document.getElementById("lodesInfo").textContent =
          "Downloading " + filename + ". After download completes, load it using the file picker below.";
        App.setStatus("Starting download\u2026");
        App.startDownload(url, filename);
        App.setStatus("Ready");
      } catch (e) {
        App.setStatus("Error");
        document.getElementById("lodesInfo").textContent = String(e && e.message ? e.message : e);
      }
    });

    // LODES file upload
    document.getElementById("lodesFile").addEventListener("change", async function (e) {
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
        document.getElementById("lodesInfo").textContent = String(err && err.message ? err.message : err);
        notifyProject();
      }
    });
  });
})();
