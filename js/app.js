// js/app.js
// Startup: wires core modules together, loads active project panel,
// contains summary runners and core event bindings.
// Depends on: all core modules (utils, map, stations, census, lodes).
// Exports: registerProject

(function () {
  var App = window.App;

  // ---- Draw mode ----

  App.drawMode = null; // null | "station" | "line" | "route" | "polygon"

  // ---- Buffer-Area Data panel ----

  var STATION_DATA_PANEL_HTML =
    '<p class="sb2-muted">' +
      'Summaries are computed within the <b>dissolved union</b> of all buffers. ' +
      'Set the buffer radius in the Features panel. For ACS, counts are area-apportioned and medians are shown as an area-weighted average estimate.' +
    '</p>' +

    '<label>Geography level (ACS only)' +
      '<select id="geoLevel">' +
        '<option value="tract">Census Tracts (faster)</option>' +
        '<option value="bg">Block Groups (more detailed)</option>' +
      '</select>' +
    '</label>' +

    '<div class="var-actions">' +
      '<button type="button" id="varSelectAll" class="var-action-btn">Select all</button>' +
      '<button type="button" id="varClearAll" class="var-action-btn">Clear all</button>' +
    '</div>' +

    '<fieldset id="varSelect" class="var-checklist">' +
      '<legend>Variables (select one or more)</legend>' +

      '<div class="var-group-label">Land Use (ACS: additive sums)</div>' +
      '<label class="var-check"><input type="checkbox" value="B01003_001E"> Total population</label>' +
      '<label class="var-check"><input type="checkbox" value="B11001_001E"> Total households</label>' +
      '<label class="var-check"><input type="checkbox" value="B25001_001E"> Total housing units</label>' +
      '<label class="var-check"><input type="checkbox" value="B25002_001E"> Occupied housing units</label>' +
      '<label class="var-check"><input type="checkbox" value="B25002_003E"> Vacant housing units</label>' +

      '<div class="var-group-label">Employment (LODES: additive sum)</div>' +
      '<label class="var-check"><input type="checkbox" value="LODES_WAC_C000"> Total existing employment \u2014 requires file upload</label>' +

      '<div class="var-group-label">Mobility / Transit-dependent (ACS: additive sums)</div>' +
      '<label class="var-check"><input type="checkbox" value="B08201_002E"> Zero-car households</label>' +
      '<label class="var-check"><input type="checkbox" value="B17001_002E"> Persons below poverty level</label>' +

      '<div class="var-group-label">Non-additive (ACS medians: area-weighted avg estimate)</div>' +
      '<label class="var-check"><input type="checkbox" value="B19013_001E"> Median household income \u26A0</label>' +
      '<label class="var-check"><input type="checkbox" value="B25064_001E"> Median gross rent \u26A0</label>' +
      '<label class="var-check"><input type="checkbox" value="B25077_001E"> Median home value \u26A0</label>' +
    '</fieldset>' +

    '<label>Year' +
      '<select id="yearSelect">' +
        '<option value="2023">2023</option>' +
        '<option value="2022">2022</option>' +
        '<option value="2021">2021</option>' +
      '</select>' +
    '</label>' +

    '<button id="run">Update summary</button>' +

    '<div id="summaryStatus" class="sb2-card" style="display:none;">' +
      '<div class="sb2-kv"><b>Intersecting geographies:</b> <span id="nGeos">0</span></div>' +
      '<div style="margin-top:6px;">' +
        '<button id="viewResults" type="button">View Results Table</button>' +
      '</div>' +
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

  // Override bufferUnionPolygon to include line buffers alongside station buffers.
  // Must happen before any user interaction; census.js and lodes.js call this at runtime.
  var _stationUnion = App.bufferUnionPolygon;
  App.bufferUnionPolygon = function () {
    var su = _stationUnion();
    var lu = App.lineBufferUnionPolygon ? App.lineBufferUnionPolygon() : null;
    if (su && lu) return turf.union(su, lu);
    return su || lu || null;
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
  App.notifyProject = notifyProject;

  // ---- Results modal helpers ----

  function openResultsModal() {
    document.getElementById("results-modal").style.display = "flex";
  }

  function closeResultsModal() {
    document.getElementById("results-modal").style.display = "none";
  }

  function aggDescription(meta) {
    if (meta.source === "LODES") return "Sum (block internal points)";
    if (meta.agg === "sum") return "Sum (area-apportioned)";
    return "Area-weighted average";
  }

  // ---- Summary runners ----

  async function runSummary() {
    var selectedVars = App.getSelectedVars();
    if (selectedVars.length === 0) {
      App.setStatus("No variables selected");
      return;
    }

    var year = document.getElementById("yearSelect").value;
    var geoLevel = document.getElementById("geoLevel").value;

    // Separate ACS vs LODES selections
    var acsVars = [];
    var lodesVars = [];
    for (var i = 0; i < selectedVars.length; i++) {
      var meta = App.getMeta(selectedVars[i]);
      if (meta.source === "LODES") {
        lodesVars.push(selectedVars[i]);
      } else {
        acsVars.push(selectedVars[i]);
      }
    }

    // Initialize modal table with "pending" rows
    var tbody = document.getElementById("results-tbody");
    tbody.innerHTML = "";
    var progressEl = document.getElementById("results-progress");
    var notesEl = document.getElementById("results-notes");
    notesEl.textContent = "";

    var rowEls = {};
    for (var j = 0; j < selectedVars.length; j++) {
      var code = selectedVars[j];
      var m = App.getMeta(code);
      var tr = document.createElement("tr");
      tr.className = "result-pending";
      tr.innerHTML =
        "<td>" + (m.category || "\u2014") + "</td>" +
        "<td>" + (m.label || code) + "</td>" +
        "<td>Computing\u2026</td>" +
        "<td>" + aggDescription(m) + "</td>";
      tbody.appendChild(tr);
      rowEls[code] = tr;
    }

    openResultsModal();

    // Check for buffer union
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) {
      var errMsg = App.stations.length === 0 ? "No stations placed" : "No buffers set";
      for (var k = 0; k < selectedVars.length; k++) {
        var errRow = rowEls[selectedVars[k]];
        errRow.className = "result-error";
        errRow.children[2].textContent = errMsg;
      }
      progressEl.textContent = "";
      App.setStatus("No buffers");
      return;
    }

    var completed = 0;
    var total = selectedVars.length;
    var nGeosEl = document.getElementById("nGeos");
    var statusCard = document.getElementById("summaryStatus");

    function updateProgress() {
      completed++;
      if (completed < total) {
        progressEl.textContent = "Computing: " + completed + " / " + total + " variables done\u2026";
      } else {
        progressEl.textContent = "All " + total + " variables computed.";
      }
    }

    // Shared TIGERweb geometry fetch for all ACS variables
    var geos = null;
    if (acsVars.length > 0) {
      App.setStatus("Querying TIGERweb\u2026");
      progressEl.textContent = "Fetching census geometries\u2026";
      geos = await App.fetchTigerwebGeos(geoLevel, unionFeat);
      App.renderCensusOverlay(geos);

      if (geos.length === 0) {
        for (var gi = 0; gi < acsVars.length; gi++) {
          var gRow = rowEls[acsVars[gi]];
          gRow.className = "result-error";
          gRow.children[2].textContent = "No intersecting geographies";
          updateProgress();
        }
      } else {
        var geoids = geos.map(function (f) { return f.properties.GEOID; }).filter(Boolean);

        // Fetch + aggregate each ACS variable
        for (var ai = 0; ai < acsVars.length; ai++) {
          var varCode = acsVars[ai];
          var varMeta = App.getMeta(varCode);
          var row = rowEls[varCode];

          try {
            App.setStatus("Fetching ACS: " + (varMeta.label || varCode) + "\u2026");
            progressEl.textContent = "Computing " + (varMeta.label || varCode) +
              " (" + (completed + 1) + "/" + total + ")\u2026";

            var valueMap = await App.fetchACSValues(geoLevel, year, varCode, geoids);
            var result = App.aggregateWithinUnion(unionFeat, geos, valueMap, varMeta.agg);

            row.className = "";
            row.children[2].textContent = App.formatValue(result.value, varMeta);
          } catch (e) {
            row.className = "result-error";
            row.children[2].textContent = "Error: " + (e.message || e);
          }
          updateProgress();
        }
      }
    }

    // LODES variables
    for (var li = 0; li < lodesVars.length; li++) {
      var lCode = lodesVars[li];
      var lRow = rowEls[lCode];

      if (!App.lodesData) {
        lRow.className = "result-error";
        lRow.children[2].textContent = "LODES file not loaded";
        updateProgress();
        continue;
      }

      try {
        App.setStatus("Computing LODES employment\u2026");
        progressEl.textContent = "Computing LODES employment (" + (completed + 1) + "/" + total + ")\u2026";

        var blocksInside = await App.fetchBlocksInternalPointsInUnion(unionFeat);
        var sum = 0;
        var matched = 0;
        for (var geoid of blocksInside) {
          var v = App.lodesData.get(geoid);
          if (v != null) { sum += v; matched++; }
        }

        lRow.className = "";
        lRow.children[2].textContent = sum.toLocaleString(undefined, { maximumFractionDigits: 0 });
      } catch (e) {
        lRow.className = "result-error";
        lRow.children[2].textContent = "Error: " + (e.message || e);
      }
      updateProgress();
    }

    // Build notes footer
    var geoLabel = (geoLevel === "tract") ? "tracts" : "block groups";
    var notesParts = [];
    if (geos && geos.length > 0) {
      notesParts.push("ACS " + year + " 5-year; " + geos.length + " intersecting " + geoLabel + ".");
    }
    if (lodesVars.length > 0 && App.lodesData) {
      notesParts.push("LODES file: " + App.lodesFileName + ".");
    }
    notesEl.textContent = notesParts.join(" ");

    // Update sidebar status card
    if (geos && geos.length > 0) {
      nGeosEl.textContent = String(geos.length);
    }
    statusCard.style.display = "";

    App.setStatus("Done");
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

  App.onFeatureDelete = function () {
    if (typeof App.exitEditMode === "function") App.exitEditMode();
    notifyProject();
    if (typeof App.cache !== "undefined") App.cache.save();
  };

  // ---- Map load: wire everything ----

  App.map.on("load", async function () {
    App.setStatus("Ready");
    App.renderStationLayers();
    App.renderLineLayers();
    App.renderPolygonLayers();

    // Initialize feature editing (station drag, vertex editing)
    if (typeof App._initEditing === "function") App._initEditing();

    // ---- Register sidebar panels, render, then wire events ----
    App.sidebar.addPanel({
      id: "station-data",
      title: "Buffer-Area Data",
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

        // Clear any lingering preview coordinates
        if (typeof App.setLinePreview === "function") App.setLinePreview(null);
        if (typeof App.setPolygonPreview === "function") App.setPolygonPreview(null);

        // Update cursor for draw mode
        if (App.drawMode) {
          App.map.getCanvas().style.cursor = "crosshair";
        } else {
          App.map.getCanvas().style.cursor = "grab";
        }

        App.setStatus(App.drawMode
          ? App.drawMode.charAt(0).toUpperCase() + App.drawMode.slice(1) + " mode"
          : "Ready");
      });
    });

    // Variable checkbox list: select all / clear all
    document.getElementById("varSelectAll").addEventListener("click", function () {
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
      if (typeof App.cache !== "undefined") App.cache.save();
    });
    document.getElementById("varClearAll").addEventListener("click", function () {
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // View Results button (re-opens modal)
    document.getElementById("viewResults").addEventListener("click", openResultsModal);

    // Results modal: close on X, backdrop click, or Escape
    document.querySelector(".results-modal-close").addEventListener("click", closeResultsModal);
    document.querySelector(".results-modal-backdrop").addEventListener("click", closeResultsModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeResultsModal();
    });

    // Buffer radius input (stations)
    document.getElementById("bufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildBuffers(val);
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Buffer radius input (lines)
    document.getElementById("lineBufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildLineBuffers(val);
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Map click: dispatch based on draw mode
    App.map.on("click", function (e) {
      if (App.drawMode === "station") {
        App.addStationPoint(e.lngLat.lng, e.lngLat.lat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "line") {
        App.handleLineClick(e.lngLat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "polygon") {
        App.handlePolygonClick(e.lngLat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // Map mousemove: rubber-band preview for line/polygon drawing
    App.map.on("mousemove", function (e) {
      if (App.drawMode === "line") {
        App.setLinePreview(e.lngLat);
      } else if (App.drawMode === "polygon") {
        App.setPolygonPreview(e.lngLat);
      }
    });

    // Clear stations
    document.getElementById("clear").addEventListener("click", function () {
      if (!confirm("Clear all features? This cannot be undone.")) return;
      App.clearStations();
      App.clearLines();
      App.clearPolygons();
      document.getElementById("nGeos").textContent = "0";
      document.getElementById("summaryStatus").style.display = "none";
      App.setStatus("Cleared");
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Undo last station
    document.getElementById("undo").addEventListener("click", function () {
      if (App.drawMode === "line") {
        App.undoLastLine();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "polygon") {
        App.undoLastPolygon();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.stations.length > 0) {
        App.undoLastStation();
        App.setStatus("Updated");
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // Run summary
    document.getElementById("run").addEventListener("click", async function () {
      try {
        await runSummary();
      } catch (e) {
        App.setStatus("Error: " + (e && e.message ? e.message : e));
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
        if (typeof App.cache !== "undefined") App.cache.save();
      } catch (err) {
        App.lodesData = null;
        App.lodesFileName = "";
        App.setLodesLoadedUI(false, "", 0);
        App.setStatus("Error");
        document.getElementById("lodesInfo").textContent = String(err && err.message ? err.message : err);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // Reset session button: clear everything AND localStorage
    var resetBtn = document.getElementById("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!confirm("Reset session? This clears all features, settings, and saved data. This cannot be undone.")) return;
        if (typeof App.cache !== "undefined") App.cache.reset();
        notifyProject();
      });
    }

    // ---- Import / Export ----
    document.getElementById("fp-export").addEventListener("click", function () {
      if (typeof App.cache !== "undefined") App.cache.exportToFile();
    });

    var importFileInput = document.getElementById("fp-import-file");
    document.getElementById("fp-import").addEventListener("click", function () {
      importFileInput.value = "";   // allow re-importing same file
      importFileInput.click();
    });
    importFileInput.addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (typeof App.cache !== "undefined") App.cache.importFromFile(file);
    });

    // Save on checkbox / dropdown changes
    document.querySelectorAll('#varSelect input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", function () {
        if (typeof App.cache !== "undefined") App.cache.save();
      });
    });
    document.getElementById("geoLevel").addEventListener("change", function () {
      if (typeof App.cache !== "undefined") App.cache.save();
    });
    document.getElementById("yearSelect").addEventListener("change", function () {
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Restore cached session (runs after sidebar, events, and project init are all ready)
    if (typeof App.cache !== "undefined" && App.cache.restore()) {
      App.setStatus("Session restored");
      notifyProject();
    }
  });
})();
