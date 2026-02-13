// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, stations, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // ---- Draw mode ----

  App.drawMode = null; // null | "station" | "line" | "route" | "polygon"

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
      App.setStatus("No stations yet");
      notesEl.textContent = "Add at least one station to compute employment served.";
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
      App.setStatus("No stations yet");
      notesEl.textContent = "Add at least one station to compute a station-area estimate.";
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
