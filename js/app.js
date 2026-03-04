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

  // Reusable ⚠ tooltip markup for median (non-additive) variables.
  var WARN_ICON = '<span class="var-warn-icon" title="Median estimate \u2014 displayed as an area-weighted average of overlapping geographies\u2019 values. This is not a true median for the buffer area. Use with caution.">\u26A0</span>';

  // ---- Group checkbox → member variable mapping ----

  var CHECKBOX_GROUPS = {
    GROUP_SEX:         ["B01001_002E", "B01001_026E"],
    GROUP_RACE:        ["B02001_002E","B02001_003E","B02001_004E","B02001_005E","B02001_006E","B02001_007E","B02001_008E"],
    GROUP_ETHNICITY:   ["B03003_003E", "B03003_002E"],
    GROUP_EDUCATION:   ["DERIVED_EDU_LT_HS","DERIVED_EDU_HS","DERIVED_EDU_SOME_COLLEGE","DERIVED_EDU_BA_PLUS"],
    GROUP_CITIZENSHIP: ["B05001_002E","B05001_005E","B05001_006E"],
    GROUP_EMPLOYMENT:  ["B23025_004E","B23025_005E","B23025_007E"],
    GROUP_COMMUTE:     ["B08301_002E","B08301_003E","B08301_010E","B08301_019E","B08301_018E","B08301_021E"],
    GROUP_COMMTIME:    ["DERIVED_COMMTIME_LT15","DERIVED_COMMTIME_15_29","DERIVED_COMMTIME_30_44","B08303_011E","DERIVED_COMMTIME_60PLUS"],
    GROUP_OCCUPANCY:   ["B25003_002E","B25003_003E"],
    GROUP_RENT_BURDEN: ["DERIVED_RENT_NOT_BURDENED","DERIVED_RENT_BURDENED","B25070_010E"]
  };

  // Always fetched and always shown in results, regardless of checkbox state.
  var MANDATORY_VARS = ["B01003_001E", "B11001_001E", "B25001_001E", "B25003_003E"];

  // Maps each variable code to how its percent denominator is computed.
  var EDU_GROUP   = ["DERIVED_EDU_LT_HS","DERIVED_EDU_HS","DERIVED_EDU_SOME_COLLEGE","DERIVED_EDU_BA_PLUS"];
  var EMP_GROUP   = ["B23025_004E","B23025_005E","B23025_007E"];
  var COMM_GROUP  = ["B08301_002E","B08301_003E","B08301_010E","B08301_019E","B08301_018E","B08301_021E"];
  var CTIME_GROUP = ["DERIVED_COMMTIME_LT15","DERIVED_COMMTIME_15_29","DERIVED_COMMTIME_30_44","B08303_011E","DERIVED_COMMTIME_60PLUS"];

  var DENOM_MAP = {
    // Sex → % of total population
    "B01001_002E": { type: "var", code: "B01003_001E" },
    "B01001_026E": { type: "var", code: "B01003_001E" },
    // Race → % of total population
    "B02001_002E": { type: "var", code: "B01003_001E" },
    "B02001_003E": { type: "var", code: "B01003_001E" },
    "B02001_004E": { type: "var", code: "B01003_001E" },
    "B02001_005E": { type: "var", code: "B01003_001E" },
    "B02001_006E": { type: "var", code: "B01003_001E" },
    "B02001_007E": { type: "var", code: "B01003_001E" },
    "B02001_008E": { type: "var", code: "B01003_001E" },
    // Ethnicity → % of total population
    "B03003_003E": { type: "var", code: "B01003_001E" },
    "B03003_002E": { type: "var", code: "B01003_001E" },
    // Disability → % of total population
    "DERIVED_DISABILITY": { type: "var", code: "B01003_001E" },
    // Poverty → % of total population
    "B17001_002E": { type: "var", code: "B01003_001E" },
    // Education → % of sum of all 4 education categories
    "DERIVED_EDU_LT_HS":        { type: "group", codes: EDU_GROUP },
    "DERIVED_EDU_HS":           { type: "group", codes: EDU_GROUP },
    "DERIVED_EDU_SOME_COLLEGE": { type: "group", codes: EDU_GROUP },
    "DERIVED_EDU_BA_PLUS":      { type: "group", codes: EDU_GROUP },
    // Zero-car → % of total households
    "B08201_002E": { type: "var", code: "B11001_001E" },
    // Employment → % of sum of all 3 employment categories
    "B23025_004E": { type: "group", codes: EMP_GROUP },
    "B23025_005E": { type: "group", codes: EMP_GROUP },
    "B23025_007E": { type: "group", codes: EMP_GROUP },
    // Commute mode → % of sum of all 6 commute modes
    "B08301_002E": { type: "group", codes: COMM_GROUP },
    "B08301_003E": { type: "group", codes: COMM_GROUP },
    "B08301_010E": { type: "group", codes: COMM_GROUP },
    "B08301_019E": { type: "group", codes: COMM_GROUP },
    "B08301_018E": { type: "group", codes: COMM_GROUP },
    "B08301_021E": { type: "group", codes: COMM_GROUP },
    // Commute time → % of sum of all 5 commute time categories
    "DERIVED_COMMTIME_LT15":   { type: "group", codes: CTIME_GROUP },
    "DERIVED_COMMTIME_15_29":  { type: "group", codes: CTIME_GROUP },
    "DERIVED_COMMTIME_30_44":  { type: "group", codes: CTIME_GROUP },
    "B08303_011E":             { type: "group", codes: CTIME_GROUP },
    "DERIVED_COMMTIME_60PLUS": { type: "group", codes: CTIME_GROUP },
    // Occupancy → % of total housing units
    "B25003_002E": { type: "var", code: "B25001_001E" },
    "B25003_003E": { type: "var", code: "B25001_001E" },
    // Rent burden → % of renter-occupied units
    "DERIVED_RENT_NOT_BURDENED": { type: "var", code: "B25003_003E" },
    "DERIVED_RENT_BURDENED":     { type: "var", code: "B25003_003E" },
    "B25070_010E":               { type: "var", code: "B25003_003E" }
  };

  // Expands group checkbox codes into their member variable codes.
  function expandGroups(codes) {
    var result = [], seen = {};
    for (var i = 0; i < codes.length; i++) {
      var members = CHECKBOX_GROUPS[codes[i]];
      var list = members || [codes[i]];
      for (var j = 0; j < list.length; j++) {
        if (!seen[list[j]]) { seen[list[j]] = true; result.push(list[j]); }
      }
    }
    return result;
  }

  var STATION_DATA_PANEL_HTML =
    '<label>Geography level' +
      '<select id="geoLevel">' +
        '<option value="tract">Census Tracts</option>' +
        '<option value="bg" selected>Block Groups</option>' +
      '</select>' +
    '</label>' +

    '<div class="var-actions">' +
      '<button type="button" id="varSelectAll" class="var-action-btn">Select all</button>' +
      '<button type="button" id="varClearAll" class="var-action-btn">Clear all</button>' +
    '</div>' +

    '<fieldset id="varSelect" class="var-checklist">' +
      '<legend>Variables (select one or more)</legend>' +

      // ---- Demographics ----
      '<div class="var-group-label">Demographics</div>' +
      '<label class="var-check"><input type="checkbox" value="B01003_001E"> Total population</label>' +
      '<label class="var-check"><input type="checkbox" value="B11001_001E"> Total households</label>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_PPH"> Average persons per household</label>' +
      '<label class="var-check"><input type="checkbox" value="B19013_001E"> Median household income ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="B01002_001E"> Median age ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_SEX"> Sex</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_RACE"> Race</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_ETHNICITY"> Ethnicity</label>' +

      // ---- Equity ----
      '<div class="var-group-label">Equity</div>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_DISABILITY"> With a disability</label>' +
      '<label class="var-check"><input type="checkbox" value="B17001_002E"> Persons below poverty level</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_EDUCATION"> Education</label>' +
      '<label class="var-check"><input type="checkbox" value="DERIVED_LEP"> Limited English proficient</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_CITIZENSHIP"> Citizenship</label>' +
      '<label class="var-check"><input type="checkbox" value="B08201_002E"> Zero-car households</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_EMPLOYMENT"> Employment status</label>' +

      // ---- Travel ----
      '<div class="var-group-label">Travel</div>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_COMMUTE"> Commute mode</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_COMMTIME"> Commute time</label>' +

      // ---- Housing ----
      '<div class="var-group-label">Housing</div>' +
      '<label class="var-check"><input type="checkbox" value="B25001_001E"> Total housing units</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_OCCUPANCY"> Occupancy</label>' +
      '<label class="var-check"><input type="checkbox" value="GROUP_RENT_BURDEN"> Rent burden</label>' +
      '<label class="var-check"><input type="checkbox" value="B25064_001E"> Median gross rent ' + WARN_ICON + '</label>' +
      '<label class="var-check"><input type="checkbox" value="B25077_001E"> Median home value ' + WARN_ICON + '</label>' +

      // ---- Employment ----
      '<div class="var-group-label">Employment</div>' +
      '<label class="var-check"><input type="checkbox" value="LODES_WAC_C000"> Total existing employment \u2014 file required</label>' +
      '<div class="lodes-actions">' +
        '<button type="button" id="downloadLodes">Download</button>' +
        '<button type="button" id="lodesOpenFile">Add State</button>' +
        '<button type="button" id="lodesClearAll" style="display:none;">Clear All</button>' +
      '</div>' +
      '<input id="lodesFile" type="file" accept=".gz,.csv.gz" style="display:none" />' +
      '<div id="lodesInfo" class="sb2-tiny" style="margin-top:4px;"></div>' +
      '<span id="lodesState" style="display:none"></span>' +
      '<span id="lodesLoaded" style="display:none"></span>' +
    '</fieldset>' +

    '<label>Year' +
      '<select id="yearSelect">' +
        '<option value="2024">2024 ACS 5-year</option>' +
        '<option value="2023">2023 ACS 5-year</option>' +
        '<option value="2022">2022 ACS 5-year</option>' +
        '<option value="2021">2021 ACS 5-year</option>' +
      '</select>' +
    '</label>' +

    '<label class="var-check" style="margin:6px 0 4px;">' +
      '<input type="checkbox" id="apportionByArea" checked> Apportion by area' +
    '</label>' +

    '<button id="run">Calculate summary</button>' +

    '<div id="summaryStatus" class="sb2-card" style="display:none;">' +
      '<div class="sb2-kv"><b>Intersecting geographies:</b> <span id="nGeos">0</span></div>' +
      '<div style="margin-top:6px;">' +
        '<button id="viewResults" type="button">View Results Table</button>' +
      '</div>' +
    '</div>';

  // ---- Module registry (replaces single-project system) ----

  var _modules = new Map(); // Map<id, moduleConfig>

  App.registerModule = function (config) {
    _modules.set(config.id, config);
  };

  // Backward-compat alias so existing project files still work during migration
  App.registerProject = App.registerModule;

  // Override bufferUnionPolygon to include line and route buffers alongside station buffers.
  // Must happen before any user interaction; census.js and lodes.js call this at runtime.
  var _stationUnion = App.bufferUnionPolygon;
  App.bufferUnionPolygon = function () {
    var su = _stationUnion();
    var lu = App.lineBufferUnionPolygon ? App.lineBufferUnionPolygon() : null;
    var ru = App.routeBufferUnionPolygon ? App.routeBufferUnionPolygon() : null;
    var pu = App.polygonUnionPolygon ? App.polygonUnionPolygon() : null;
    var combined = su || null;
    if (lu) combined = combined ? turf.union(combined, lu) : lu;
    if (ru) combined = combined ? turf.union(combined, ru) : ru;
    if (pu) combined = combined ? turf.union(combined, pu) : pu;
    return combined;
  };

  // Build a core API object for passing to project hooks.
  // Rebuilt each call so values like lodesData are always current.
  function buildCore() {
    return {
      stations: App.stations,
      buffers: App.buffers,
      routes: App.routes,
      routeBuffers: App.routeBuffers,
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

  // Notify all registered modules that data has changed.
  // Called sequentially to avoid overwhelming Census API.
  async function notifyProject() {
    var core = buildCore();
    for (var entry of _modules.values()) {
      if (typeof entry.update === "function") {
        await entry.update(core);
      }
    }
  }
  App.notifyProject = notifyProject;

  // Clear all module state (choropleths, legends, results).
  // Called by Clear and Reset Session buttons.
  function clearModules() {
    for (var entry of _modules.values()) {
      if (typeof entry.clear === "function") {
        entry.clear();
      }
    }
  }

  // ---- Results modal helpers ----

  function openResultsModal() {
    document.getElementById("results-modal").style.display = "flex";
  }

  function closeResultsModal() {
    document.getElementById("results-modal").style.display = "none";
  }

  function aggDescription(meta, apportionByArea) {
    if (meta.source === "LODES") return "Sum (block internal points)";
    if (meta.agg === "ratio") return meta.ratioLabel || "Calculated ratio";
    if (meta.agg === "sum") return apportionByArea ? "Sum (area-apportioned)" : "Sum (all overlapping geos)";
    return apportionByArea ? "Area-weighted average" : "Simple average (all overlapping geos)";
  }

  // ---- Summary runners ----

  async function runSummary() {
    var selectedVars = expandGroups(App.getSelectedVars());
    if (selectedVars.length === 0) {
      App.setStatus("No variables selected");
      return;
    }
    // Always include mandatory denominator variables
    var _seen = {};
    for (var mi = 0; mi < selectedVars.length; mi++) _seen[selectedVars[mi]] = true;
    for (var mdi = 0; mdi < MANDATORY_VARS.length; mdi++) {
      if (!_seen[MANDATORY_VARS[mdi]]) { _seen[MANDATORY_VARS[mdi]] = true; selectedVars.push(MANDATORY_VARS[mdi]); }
    }

    var year = document.getElementById("yearSelect").value;
    var geoLevel = document.getElementById("geoLevel").value;
    var apportionByAreaEl = document.getElementById("apportionByArea");
    var apportionByArea = apportionByAreaEl ? apportionByAreaEl.checked : true;

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

    // Initialize modal table with "pending" rows.
    // codeToRows maps each code → array of <tr> elements (handles duplicate codes across categories).
    var tbody = document.getElementById("results-tbody");
    tbody.innerHTML = "";
    var progressEl = document.getElementById("results-progress");
    var notesEl = document.getElementById("results-notes");
    notesEl.textContent = "";

    var codeToRows = {};
    var resultsMap = {};
    for (var j = 0; j < selectedVars.length; j++) {
      var code = selectedVars[j];
      var m = App.getMeta(code);
      var tr = document.createElement("tr");
      tr.className = "result-pending";
      tr.innerHTML =
        "<td>" + (m.category || "\u2014") + "</td>" +
        "<td>" + (m.label || code) + "</td>" +
        "<td>Computing\u2026</td>" +
        "<td>\u2014</td>" +
        "<td>" + aggDescription(m, apportionByArea) + "</td>";
      tbody.appendChild(tr);
      if (!codeToRows[code]) codeToRows[code] = [];
      codeToRows[code].push(tr);
    }

    openResultsModal();

    // Check for buffer union
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) {
      var errMsg = (App.stations.length === 0 && App.lines.length === 0 &&
                    App.routes.length === 0 && App.polygons.length === 0)
        ? "No features placed" : "No buffers set";
      for (var k = 0; k < selectedVars.length; k++) {
        var errRows = codeToRows[selectedVars[k]] || [];
        for (var ei = 0; ei < errRows.length; ei++) {
          errRows[ei].className = "result-error";
          errRows[ei].children[2].textContent = errMsg;
        }
      }
      progressEl.textContent = "";
      App.setStatus("No buffers");
      return;
    }

    // Deduplicate ACS vars so each unique code is only fetched once,
    // but all matching rows will be updated when the result arrives.
    var acsVarsUniq = [];
    var seenAcs = {};
    for (var si = 0; si < acsVars.length; si++) {
      if (!seenAcs[acsVars[si]]) { seenAcs[acsVars[si]] = true; acsVarsUniq.push(acsVars[si]); }
    }
    var lodesVarsUniq = [];
    var seenLodes = {};
    for (var sl = 0; sl < lodesVars.length; sl++) {
      if (!seenLodes[lodesVars[sl]]) { seenLodes[lodesVars[sl]] = true; lodesVarsUniq.push(lodesVars[sl]); }
    }

    var completed = 0;
    var total = acsVarsUniq.length + lodesVarsUniq.length;
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

    function updateRows(code, result, varMeta, useTractFallback) {
      resultsMap[code] = result.value;
      var rows = codeToRows[code] || [];
      for (var ri = 0; ri < rows.length; ri++) {
        rows[ri].className = "";
        rows[ri].children[2].textContent = App.formatValue(result.value, varMeta);
        // children[3] = Percent (filled in final pass)
        if (useTractFallback) {
          rows[ri].children[4].textContent += " \u2014 Tract-level data (not available at block group)";
        }
      }
    }

    function markRowsError(code, msg) {
      var rows = codeToRows[code] || [];
      for (var ri = 0; ri < rows.length; ri++) {
        rows[ri].className = "result-error";
        rows[ri].children[2].textContent = msg;
      }
    }

    // Shared TIGERweb geometry fetch for all ACS variables
    var geos = null;
    var tractGeosForFallback = null; // fetched lazily when any tract-only var is encountered at BG level
    if (acsVarsUniq.length > 0) {
      App.setStatus("Querying TIGERweb\u2026");
      progressEl.textContent = "Fetching census geometries\u2026";
      geos = await App.fetchTigerwebGeos(geoLevel, unionFeat);
      App.renderCensusOverlay(geos);

      if (geos.length === 0) {
        for (var gi = 0; gi < acsVarsUniq.length; gi++) {
          markRowsError(acsVarsUniq[gi], "No intersecting geographies");
          updateProgress();
        }
      } else {
        var geoids = geos.map(function (f) { return f.properties.GEOID; }).filter(Boolean);

        // Fetch + aggregate each unique ACS variable
        for (var ai = 0; ai < acsVarsUniq.length; ai++) {
          var varCode = acsVarsUniq[ai];
          var varMeta = App.getMeta(varCode);
          var useTractFallback = (geoLevel === "bg" && varMeta.tractOnly);

          try {
            App.setStatus("Fetching ACS: " + (varMeta.label || varCode) + "\u2026");
            progressEl.textContent = "Computing " + (varMeta.label || varCode) +
              " (" + (completed + 1) + "/" + total + ")\u2026";

            var fetchGeoLevel, fetchGeos, fetchGeoids;
            if (useTractFallback) {
              // Lazy-fetch tract geometries once for all tract-only variables
              if (!tractGeosForFallback) {
                progressEl.textContent = "Fetching tract geometries for tract-level variables\u2026";
                tractGeosForFallback = await App.fetchTigerwebGeos("tract", unionFeat);
              }
              fetchGeoLevel = "tract";
              fetchGeos = tractGeosForFallback;
              fetchGeoids = tractGeosForFallback.map(function (f) { return f.properties.GEOID; }).filter(Boolean);
            } else {
              fetchGeoLevel = geoLevel;
              fetchGeos = geos;
              fetchGeoids = geoids;
            }

            var result;
            if (varMeta.agg === "ratio") {
              var numMap = await App.fetchACSValues(fetchGeoLevel, year, varMeta.numerator, fetchGeoids);
              var denMap = await App.fetchACSValues(fetchGeoLevel, year, varMeta.denominator, fetchGeoids);
              var numAgg = App.aggregateWithinUnion(unionFeat, fetchGeos, numMap, "sum", { apportionByArea: apportionByArea });
              var denAgg = App.aggregateWithinUnion(unionFeat, fetchGeos, denMap, "sum", { apportionByArea: apportionByArea });
              var ratioVal = (denAgg.value > 0) ? (numAgg.value / denAgg.value) : NaN;
              result = { value: ratioVal, used: numAgg.used };
            } else {
              var valueMap;
              if (varMeta.codes && varMeta.codes.length > 0) {
                valueMap = await App.fetchACSMultiValues(fetchGeoLevel, year, varMeta.codes, fetchGeoids);
              } else {
                valueMap = await App.fetchACSValues(fetchGeoLevel, year, varCode, fetchGeoids);
              }
              result = App.aggregateWithinUnion(unionFeat, fetchGeos, valueMap, varMeta.agg, { apportionByArea: apportionByArea });
            }
            updateRows(varCode, result, varMeta, useTractFallback);
          } catch (e) {
            markRowsError(varCode, "Error: " + (e.message || e));
          }
          updateProgress();
        }
      }
    }

    // LODES variables
    for (var li = 0; li < lodesVarsUniq.length; li++) {
      var lCode = lodesVarsUniq[li];

      if (!App.lodesData) {
        markRowsError(lCode, "LODES file not loaded");
        updateProgress();
        continue;
      }

      try {
        App.setStatus("Computing LODES employment\u2026");
        progressEl.textContent = "Computing LODES employment (" + (completed + 1) + "/" + total + ")\u2026";

        var blocksInside = await App.fetchBlocksInternalPointsInUnion(unionFeat);
        var lodesSum = 0;
        for (var geoid of blocksInside) {
          var v = App.lodesData.get(geoid);
          if (v != null) { lodesSum += v; }
        }

        var lRows = codeToRows[lCode] || [];
        for (var lri = 0; lri < lRows.length; lri++) {
          lRows[lri].className = "";
          lRows[lri].children[2].textContent = lodesSum.toLocaleString(undefined, { maximumFractionDigits: 0 });
        }
      } catch (e) {
        markRowsError(lCode, "Error: " + (e.message || e));
      }
      updateProgress();
    }

    // ---- Percent column pass ----
    var allPctCodes = Object.keys(codeToRows);
    for (var pi = 0; pi < allPctCodes.length; pi++) {
      var pCode = allPctCodes[pi];
      var pDenom = DENOM_MAP[pCode];
      var pRows = codeToRows[pCode] || [];
      var pct = null;
      if (pDenom && Number.isFinite(resultsMap[pCode])) {
        var den;
        if (pDenom.type === "var") {
          den = resultsMap[pDenom.code];
        } else {
          den = 0;
          for (var gi = 0; gi < pDenom.codes.length; gi++) {
            var gv = resultsMap[pDenom.codes[gi]];
            if (!Number.isFinite(gv)) { den = null; break; }
            den += gv;
          }
        }
        if (Number.isFinite(den) && den > 0) pct = (resultsMap[pCode] / den) * 100;
      }
      for (var pri = 0; pri < pRows.length; pri++) {
        pRows[pri].children[3].textContent = pct !== null ? pct.toFixed(1) + "%" : "\u2014";
      }
    }

    // Build notes footer
    var geoLabel = (geoLevel === "tract") ? "tracts" : "block groups";
    var notesParts = [];
    if (geos && geos.length > 0) {
      notesParts.push("ACS " + year + " 5-year; " + geos.length + " intersecting " + geoLabel + ".");
    }
    if (tractGeosForFallback && tractGeosForFallback.length > 0) {
      notesParts.push(tractGeosForFallback.length + " tract(s) used for variables not available at block group level.");
    }
    if (lodesVarsUniq.length > 0 && App.lodesData) {
      notesParts.push("LODES file: " + App.lodesFileName + ".");
    }
    var apportionNote = apportionByArea
      ? "counts are area-apportioned (fractional overlap)"
      : "counts include all intersecting geographies in full (no area apportionment)";
    var methodNote = 'Summaries are computed within the <b>dissolved union</b> of all buffers. Set the buffer radius in the Features panel. For ACS, ' + apportionNote + '. Medians are shown as an area-weighted average estimate.';
    notesEl.innerHTML = (notesParts.length ? notesParts.join(" ") + "<br>" : "") + methodNote;

    // Update sidebar status card
    if (geos && geos.length > 0) {
      nGeosEl.textContent = String(geos.length);
    }
    statusCard.style.display = "";

    App.setStatus("Done");
    await notifyProject();
  }

  // ---- Build Analysis sidebar panel HTML ----

  function buildAnalysisButtonsHTML() {
    var html = '<div class="analysis-module-list">';
    for (var entry of _modules.values()) {
      var isEnabled = entry.enabled !== false;
      var disabledAttr = isEnabled ? '' : ' disabled';
      html += '<button class="analysis-module-btn"' +
              ' data-module-id="' + entry.id + '"' + disabledAttr + '>' +
              (entry.name || entry.id) +
              (isEnabled ? '' : ' <span class="coming-soon">(coming soon)</span>') +
              '</button>';
    }
    html += '</div>';
    return html;
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
    App.renderRouteLayers();
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
    if (_modules.size > 0) {
      App.sidebar.addPanel({
        id: "analysis",
        title: "Analysis",
        html: buildAnalysisButtonsHTML(),
        collapsed: false,
        order: 30
      });
    }
    App.sidebar.render();

    // Wire popup system and analysis module buttons
    App.popup.wire(_modules, buildCore);

    var moduleButtons = document.querySelectorAll(".analysis-module-btn");
    moduleButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var moduleId = btn.getAttribute("data-module-id");
        if (moduleId) App.popup.open(moduleId, _modules, buildCore);
      });
    });

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
        if (prevMode === "route" && App.drawMode !== "route") {
          App.cancelRouteDrawing();
        }
        if (prevMode === "polygon" && App.drawMode !== "polygon") {
          App.cancelPolygonDrawing();
        }

        // Clear any lingering preview coordinates
        if (typeof App.setLinePreview === "function") App.setLinePreview(null);
        if (typeof App.setRoutePreview === "function") App.setRoutePreview(null);
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

    // Results modal: close on X or backdrop click
    document.querySelector(".results-modal-close").addEventListener("click", closeResultsModal);
    document.querySelector(".results-modal-backdrop").addEventListener("click", closeResultsModal);

    // Escape key: close in priority order (results modal first, then analysis popup)
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (document.getElementById("results-modal").style.display !== "none") {
          closeResultsModal();
        } else if (App.popup.isOpen()) {
          App.popup.close();
        }
      }
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

    // Buffer radius input (routes)
    document.getElementById("routeBufferRadius").addEventListener("input", function () {
      var val = parseFloat(this.value);
      if (isNaN(val) || val < 0) val = 0;
      App.rebuildRouteBuffers(val);
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
      } else if (App.drawMode === "route") {
        App.handleRouteClick(e.lngLat).then(function () {
          notifyProject();
          if (typeof App.cache !== "undefined") App.cache.save();
        });
      } else if (App.drawMode === "polygon") {
        App.handlePolygonClick(e.lngLat);
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      }
    });

    // Map mousemove: rubber-band preview for line/route/polygon drawing
    App.map.on("mousemove", function (e) {
      if (App.drawMode === "line") {
        App.setLinePreview(e.lngLat);
      } else if (App.drawMode === "route") {
        App.setRoutePreview(e.lngLat);
      } else if (App.drawMode === "polygon") {
        App.setPolygonPreview(e.lngLat);
      }
    });

    // Clear stations
    document.getElementById("clear").addEventListener("click", function () {
      if (!confirm("Clear all features? This cannot be undone.")) return;
      App.clearStations();
      App.clearLines();
      App.clearRoutes();
      App.clearPolygons();
      if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
      document.getElementById("nGeos").textContent = "0";
      document.getElementById("summaryStatus").style.display = "none";
      App.setStatus("Cleared");
      clearModules();
      notifyProject();
      if (typeof App.cache !== "undefined") App.cache.save();
    });

    // Undo last station/waypoint/feature
    document.getElementById("undo").addEventListener("click", function () {
      if (App.drawMode === "line") {
        App.undoLastLine();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } else if (App.drawMode === "route") {
        App.undoLastRoute();
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
          "Downloading " + filename + ". Click Add to load into map data.";
        App.setStatus("Starting download\u2026");
        App.startDownload(url, filename);
        App.setStatus("Ready");
      } catch (e) {
        App.setStatus("Error");
        document.getElementById("lodesInfo").textContent = String(e && e.message ? e.message : e);
      }
    });

    // LODES "Open" button — triggers the hidden file input
    document.getElementById("lodesOpenFile").addEventListener("click", function () {
      document.getElementById("lodesFile").click();
    });

    // LODES file upload — merges into any already-loaded state data
    document.getElementById("lodesFile").addEventListener("change", async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      this.value = ""; // allow re-selecting the same file
      try {
        var jobsMap = await App.parseLodesFromUploadedFile(file);
        App.mergeLodesFile(jobsMap, file.name);
        App.setStatus("Ready");
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      } catch (err) {
        App.setStatus("Error");
        var infoEl = document.getElementById("lodesInfo");
        if (infoEl) infoEl.textContent = "Error loading " + file.name + ": " + String(err && err.message ? err.message : err);
      }
    });

    // LODES clear-all button
    var lodesClearBtn = document.getElementById("lodesClearAll");
    if (lodesClearBtn) {
      lodesClearBtn.addEventListener("click", function () {
        if (!confirm("Remove all loaded LODES data?")) return;
        App.clearLodesData();
        notifyProject();
        if (typeof App.cache !== "undefined") App.cache.save();
      });
    }

    // Reset session button: clear everything AND localStorage
    var resetBtn = document.getElementById("reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!confirm("Reset session? This clears all features, settings, and saved data. This cannot be undone.")) return;
        if (typeof App.cache !== "undefined") App.cache.reset();
        if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
        clearModules();
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
