// js/projects/buffer-summary.js
// Feature Area Analysis module (formerly Buffer-Area Summary).
// Census variable checkboxes live inside this module's popup.
// Registers as a popup-based module via App.registerModule().
// Depends on: App namespace (utils, census, lodes), App.popup, App.cache.

(function () {
  "use strict";
  var App = window.App;

  // ---- State ----

  var _state = {
    geoLevel: "bg",
    year: "2024",
    apportionByArea: true,
    checkedVars: []  // persisted checkbox values (restored before DOM exists)
  };
  var _initialized = false;
  var _hasResults = false; // true once a summary has been computed this session

  // Reusable warning icon for median variables.
  var WARN_ICON = '<span class="var-warn-icon" title="Median estimate \u2014 displayed as an area-weighted average of overlapping geographies\u2019 values. This is not a true median for the buffer area. Use with caution.">\u26A0</span>';

  // Always fetched and always shown in results, regardless of checkbox state.
  var MANDATORY_VARS = ["B01003_001E", "B11001_001E", "B25001_001E", "B25003_003E"];

  // Section order for the checkbox UI. Categories not listed appear after.
  var CATEGORY_ORDER = ["Demographics", "Equity", "Travel", "Housing", "Employment"];

  // Expands group checkbox codes into their member variable codes via the
  // single-source-of-truth helper in utils.js. Non-group codes pass through.
  function expandGroups(codes) {
    var result = [], seen = {};
    for (var i = 0; i < codes.length; i++) {
      var members = App.getCheckboxGroupMembers(codes[i]);
      var list = members.length ? members : [codes[i]];
      for (var j = 0; j < list.length; j++) {
        if (!seen[list[j]]) { seen[list[j]] = true; result.push(list[j]); }
      }
    }
    return result;
  }

  // Builds the variable checkbox markup from VAR_META + GROUP_INFO.
  // Items are grouped by their `category` field; within each section the order
  // follows VAR_META declaration order. Group checkboxes appear once per group
  // at the position of their first member; group-member entries are not rendered
  // individually. Variables with neither `displayInChecklist` nor `group` are
  // hidden (denominator-only / mandatory totals).
  function buildVarChecklistHTML() {
    var meta = App.VAR_META;
    var groupInfo = App.GROUP_INFO;
    var bySection = {};       // category → [{ html, code }]
    var renderedGroup = {};   // groupKey → true once that group's checkbox is emitted

    Object.keys(meta).forEach(function (code) {
      var m = meta[code];
      var category = m.category || "Other";
      if (!bySection[category]) bySection[category] = [];

      if (m.group) {
        if (renderedGroup[m.group]) return;
        renderedGroup[m.group] = true;
        var info = groupInfo[m.group] || { label: m.group };
        bySection[category].push(
          '<label class="var-check"><input type="checkbox" value="' + m.group + '"> ' +
          escapeHtml(info.label) + '</label>'
        );
        return;
      }

      if (!m.displayInChecklist) return;

      var warn = (m.agg === "avg") ? " " + WARN_ICON : "";
      var idAttr = (code === "LODES_WAC_C000") ? ' id="lodesCheckbox"' : '';
      bySection[category].push(
        '<label class="var-check"><input type="checkbox"' + idAttr +
        ' value="' + code + '"> ' + escapeHtml(m.label) + warn + '</label>'
      );
    });

    var out = [];
    var seenCat = {};
    CATEGORY_ORDER.forEach(function (cat) {
      if (!bySection[cat]) return;
      seenCat[cat] = true;
      out.push('<div class="var-group-label">' + escapeHtml(cat) + '</div>');
      out.push(bySection[cat].join(""));
    });
    Object.keys(bySection).forEach(function (cat) {
      if (seenCat[cat]) return;
      out.push('<div class="var-group-label">' + escapeHtml(cat) + '</div>');
      out.push(bySection[cat].join(""));
    });
    return out.join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function aggDescription(meta, apportionByArea) {
    if (meta.source === "LODES") return "Sum (block internal points)";
    if (meta.agg === "ratio") return meta.ratioLabel || "Calculated ratio";
    if (meta.agg === "sum") return apportionByArea ? "Sum (area-apportioned)" : "Sum (all overlapping geos)";
    return apportionByArea ? "Area-weighted average" : "Simple average (all overlapping geos)";
  }

  // Context-aware onboarding/empty hint shown until a summary is calculated.
  function emptyHint() {
    var hasFeatures = (App.points || []).length + (App.lines || []).length +
                      (App.routes || []).length > 0;
    if (!hasFeatures) {
      return { need: "Draw a point, line, or route to begin.",
               action: "Buffers around your features define the area summarized." };
    }
    return { need: "Select variables and click Calculate Summary.",
             action: "Pick Census/LODES variables above to summarize within your buffers." };
  }

  // ---- Summary runner ----

  async function runSummary() {
    var selectedVars = expandGroups(App.getSelectedVars());
    if (selectedVars.length === 0) {
      App.setStatus("No variables selected");
      App.renderModuleState({ emptyEl: "basEmptyState", empty: true, hint: emptyHint() });
      return;
    }

    // displayVars = only what the user checked (these get table rows)
    var displayVars = selectedVars.slice();

    // Always fetch mandatory denominator variables for percent calculations,
    // but do NOT create table rows for them unless the user explicitly selected them.
    var _seen = {};
    for (var mi = 0; mi < selectedVars.length; mi++) _seen[selectedVars[mi]] = true;
    for (var mdi = 0; mdi < MANDATORY_VARS.length; mdi++) {
      if (!_seen[MANDATORY_VARS[mdi]]) { _seen[MANDATORY_VARS[mdi]] = true; selectedVars.push(MANDATORY_VARS[mdi]); }
    }
    // selectedVars now = displayVars + any mandatory denoms not already selected

    var year = document.getElementById("basYearSelect").value;
    var geoLevel = document.getElementById("basGeoLevel").value;
    var apportionByAreaEl = document.getElementById("basApportionByArea");
    var apportionByArea = apportionByAreaEl ? apportionByAreaEl.checked : true;

    // Save state
    _state.year = year;
    _state.geoLevel = geoLevel;
    _state.apportionByArea = apportionByArea;
    if (typeof App.cache !== "undefined") App.cache.save();

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

    // Initialize results table
    var tbody = document.getElementById("basResultsTbody");
    tbody.innerHTML = "";
    var tableEl = document.getElementById("basResultsTable");
    tableEl.style.display = "";
    App.renderModuleState({ emptyEl: "basEmptyState" });   // hide onboarding hint
    var progressEl = document.getElementById("basResultsProgress");
    var notesEl = document.getElementById("basResultsNotes");
    notesEl.textContent = "";

    var codeToRows = {};
    var resultsMap = {};
    for (var j = 0; j < displayVars.length; j++) {
      var code = displayVars[j];
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

    // Check for buffer union
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) {
      var errMsg = (App.points.length === 0 && App.lines.length === 0 &&
                    App.routes.length === 0 && App.polygons.length === 0)
        ? "No features placed" : "No buffers set";
      for (var k = 0; k < displayVars.length; k++) {
        var errRows = codeToRows[displayVars[k]] || [];
        for (var ei = 0; ei < errRows.length; ei++) {
          errRows[ei].className = "result-error";
          errRows[ei].children[2].textContent = errMsg;
        }
      }
      progressEl.textContent = "";
      App.setStatus("No buffers");
      return;
    }

    // Deduplicate ACS vars so each unique code is only fetched once
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
    var tractGeosForFallback = null;
    if (acsVarsUniq.length > 0) {
      App.setStatus("Querying TIGERweb\u2026");
      progressEl.textContent = "Fetching census geometries\u2026";
      geos = await App.fetchTigerwebGeos(geoLevel, unionFeat);

      // When apportioning by area, clip each geo to the union so the map
      // display matches the math (same pattern as TPI's computeAreaFractions).
      if (apportionByArea) {
        var clippedForDisplay = [];
        geos.forEach(function (f) {
          try {
            var inter = turf.intersect(f, unionFeat);
            if (inter) clippedForDisplay.push({
              type: "Feature",
              properties: f.properties,
              geometry: inter.geometry
            });
          } catch (_) {}
        });
        App.renderCensusOverlay(clippedForDisplay.length ? clippedForDisplay : geos);
      } else {
        App.renderCensusOverlay(geos);
      }

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
      var pDenom = App.getDenominator(pCode);
      var pRows = codeToRows[pCode] || [];
      var pct = null;
      if (pDenom && Number.isFinite(resultsMap[pCode])) {
        var den;
        if (pDenom.type === "var") {
          den = resultsMap[pDenom.code];
        } else {
          den = 0;
          for (var dgi = 0; dgi < pDenom.codes.length; dgi++) {
            var gv = resultsMap[pDenom.codes[dgi]];
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

    _hasResults = true;

    App.setStatus("Done");
    if (typeof App.notifyProject === "function") await App.notifyProject();
  }

  // ---- Apply state to popup DOM ----

  function applyStateToDOM() {
    var geoEl = document.getElementById("basGeoLevel");
    if (geoEl) geoEl.value = _state.geoLevel;
    var yearEl = document.getElementById("basYearSelect");
    if (yearEl) yearEl.value = _state.year;
    var apportionEl = document.getElementById("basApportionByArea");
    if (apportionEl) apportionEl.checked = _state.apportionByArea;

    // Restore checkbox selections (LODES checkbox is now inside #varSelect).
    if (_state.checkedVars && _state.checkedVars.length > 0) {
      var checkedSet = {};
      for (var i = 0; i < _state.checkedVars.length; i++) checkedSet[_state.checkedVars[i]] = true;
      var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
      for (var j = 0; j < boxes.length; j++) boxes[j].checked = !!checkedSet[boxes[j].value];
    }
  }

  function collectCheckedVars() {
    var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]:checked');
    var codes = [];
    for (var i = 0; i < boxes.length; i++) codes.push(boxes[i].value);
    return codes;
  }

  // ---- Module registration ----

  App.registerModule({
    id: "buffer-summary",
    name: "Feature Area Analysis",
    enabled: true,
    popupWidth: 1000,
    popupHTML: "projects/buffer-summary-popup.html",

    init: function (core) {
      _initialized = true;

      // Populate the empty #varSelect fieldset from VAR_META.
      // Must run before any querySelectorAll on the checkbox list below.
      var varSelectEl = document.getElementById("varSelect");
      if (varSelectEl) varSelectEl.innerHTML = buildVarChecklistHTML();

      // Wire Calculate Summary button
      document.getElementById("basRun").addEventListener("click", async function () {
        try {
          await runSummary();
        } catch (e) {
          App.setStatus("Error: " + (e && e.message ? e.message : e));
        }
      });

      // Wire Select All / Clear All buttons. LODES is a normal #varSelect
      // checkbox now, so no special-case handling is needed.
      document.getElementById("varSelectAll").addEventListener("click", function () {
        var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
        for (var i = 0; i < boxes.length; i++) boxes[i].checked = true;
        _state.checkedVars = collectCheckedVars();
        if (typeof App.cache !== "undefined") App.cache.save();
      });
      document.getElementById("varClearAll").addEventListener("click", function () {
        var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]');
        for (var i = 0; i < boxes.length; i++) boxes[i].checked = false;
        _state.checkedVars = [];
        if (typeof App.cache !== "undefined") App.cache.save();
      });

      // Auto-save on checkbox change
      document.querySelectorAll('#varSelect input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          _state.checkedVars = collectCheckedVars();
          if (typeof App.cache !== "undefined") App.cache.save();
        });
      });

      // Apply cached state to DOM
      applyStateToDOM();
    },

    onOpen: function (core) {
      // Re-apply state each time popup opens (in case restored from cache)
      applyStateToDOM();
      // Show results table if we have results, else a friendly onboarding hint
      var tableEl = document.getElementById("basResultsTable");
      if (tableEl && _hasResults) {
        tableEl.style.display = "";
        App.renderModuleState({ emptyEl: "basEmptyState" });   // hide hint
      } else {
        App.renderModuleState({ emptyEl: "basEmptyState", empty: true, hint: emptyHint() });
      }
    },

    onClose: function (core) {
      // Capture current checkbox state on close
      if (document.getElementById("varSelect")) {
        _state.checkedVars = collectCheckedVars();
      }
    },

    update: function (core) {
      // no-op — summary is on-demand, not auto-updating
    }
  });

  // ---- Cache integration ----

  if (typeof App.cache !== "undefined" && typeof App.cache.registerModule === "function") {
    App.cache.registerModule("buffer-summary", {
      collect: function (mode) {
        // If popup is open, read checkboxes from DOM; otherwise use stored state
        var vars = document.getElementById("varSelect") ? collectCheckedVars() : (_state.checkedVars || []);
        return {
          geoLevel: _state.geoLevel,
          year: _state.year,
          apportionByArea: _state.apportionByArea,
          checkedVars: vars
        };
      },
      apply: function (data) {
        if (data.geoLevel) _state.geoLevel = data.geoLevel;
        if (data.year) _state.year = data.year;
        if (typeof data.apportionByArea === "boolean") _state.apportionByArea = data.apportionByArea;
        if (Array.isArray(data.checkedVars)) _state.checkedVars = data.checkedVars;
        // DOM may not exist yet; applyStateToDOM() is called in onOpen()
      }
    });
  }

})();
