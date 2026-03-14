// js/projects/title-vi.js
// Title VI Service Equity Analysis — module registration, popup lifecycle,
// tab switching, CSV import, feature checklists, map overlay, session
// persistence, exports.
// Depends on: App namespace, window.TitleVI (engine), turf (CDN).
// Exports: none (self-registers via App.registerModule)

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var TV  = window.TitleVI;

  // ---- Module-local state ----

  var _policy            = TV.defaultPolicy();
  var _scenarios         = [TV.createScenario("Scenario A")];
  var _activeScenarioIdx = 0;
  var _baseline          = null;
  var _results           = {};  // scenarioId -> analysis result
  var _csvHeaders        = [];
  var _csvRows           = [];
  var _stale             = false;
  var _running           = false;
  var _initialized       = false;
  var _activeTab         = "policies";
  var _baselineFeatureFilter = null;
  var _impactFeatureFilter   = null;

  // Cached demographics per scenario (for instant threshold re-evaluation)
  var _cachedDemographics = {};  // scenarioId -> demographics object
  var _cachedImpactedGeom = {};  // scenarioId -> GeoJSON geometry

  // ---- DOM guard ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "title-vi";
  }

  // ---- Tab switching ----

  function switchTab(id) {
    _activeTab = id;
    var tabs = document.querySelectorAll(".tvi-tab");
    var panes = document.querySelectorAll(".tvi-tab-content");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-tab") === id) {
        tabs[i].classList.add("tvi-tab-active");
      } else {
        tabs[i].classList.remove("tvi-tab-active");
      }
    }
    for (var j = 0; j < panes.length; j++) {
      if (panes[j].getAttribute("data-tab") === id) {
        panes[j].classList.add("tvi-tab-visible");
      } else {
        panes[j].classList.remove("tvi-tab-visible");
      }
    }
  }

  // ---- Policy read/write from DOM ----

  function readPolicyFromDOM() {
    var nameEl = document.getElementById("tviPolicyName");
    if (nameEl) _policy.name = nameEl.value;

    _policy.majorChange.routeMilesPct.enabled   = !!document.getElementById("tviRuleRouteMiles").checked;
    _policy.majorChange.routeMilesPct.threshold  = parseFloat(document.getElementById("tviThreshRouteMiles").value) || 25;
    _policy.majorChange.revenueHoursPct.enabled  = !!document.getElementById("tviRuleRevHours").checked;
    _policy.majorChange.revenueHoursPct.threshold = parseFloat(document.getElementById("tviThreshRevHours").value) || 25;
    _policy.majorChange.spanHoursPct.enabled     = !!document.getElementById("tviRuleSpan").checked;
    _policy.majorChange.spanHoursPct.threshold   = parseFloat(document.getElementById("tviThreshSpan").value) || 25;
    _policy.majorChange.routeElimination.enabled = !!document.getElementById("tviRuleElimination").checked;
    _policy.majorChange.fareChangePct.enabled    = !!document.getElementById("tviRuleFare").checked;
    _policy.majorChange.fareChangePct.threshold  = parseFloat(document.getElementById("tviThreshFare").value) || 10;

    _policy.disparateImpactThresholdPpt       = parseFloat(document.getElementById("tviDiThreshold").value) || 15;
    _policy.disproportionateBurdenThresholdPpt = parseFloat(document.getElementById("tviDbThreshold").value) || 15;

    var geoEl = document.getElementById("tviGeoLevel");
    if (geoEl) _policy.geoLevel = geoEl.value;
    var yearEl = document.getElementById("tviYearSelect");
    if (yearEl) _policy.acsYear = yearEl.value;
  }

  function writePolicyToDOM() {
    var nameEl = document.getElementById("tviPolicyName");
    if (nameEl) nameEl.value = _policy.name;

    document.getElementById("tviRuleRouteMiles").checked   = _policy.majorChange.routeMilesPct.enabled;
    document.getElementById("tviThreshRouteMiles").value    = _policy.majorChange.routeMilesPct.threshold;
    document.getElementById("tviRuleRevHours").checked      = _policy.majorChange.revenueHoursPct.enabled;
    document.getElementById("tviThreshRevHours").value      = _policy.majorChange.revenueHoursPct.threshold;
    document.getElementById("tviRuleSpan").checked          = _policy.majorChange.spanHoursPct.enabled;
    document.getElementById("tviThreshSpan").value          = _policy.majorChange.spanHoursPct.threshold;
    document.getElementById("tviRuleElimination").checked   = _policy.majorChange.routeElimination.enabled;
    document.getElementById("tviRuleFare").checked          = _policy.majorChange.fareChangePct.enabled;
    document.getElementById("tviThreshFare").value          = _policy.majorChange.fareChangePct.threshold;

    document.getElementById("tviDiThreshold").value = _policy.disparateImpactThresholdPpt;
    document.getElementById("tviDbThreshold").value = _policy.disproportionateBurdenThresholdPpt;

    var geoEl = document.getElementById("tviGeoLevel");
    if (geoEl) geoEl.value = _policy.geoLevel;
    var yearEl = document.getElementById("tviYearSelect");
    if (yearEl) yearEl.value = _policy.acsYear;
  }

  // ---- Feature checklist helpers ----

  function makeFeatureCheckRow(type, index, name, checked) {
    var row = document.createElement("div");
    row.className = "rf-feature-check-row";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.setAttribute("data-feature-type", type);
    cb.setAttribute("data-feature-index", String(index));
    var badge = document.createElement("span");
    badge.className = "rf-feature-type-badge";
    badge.textContent = type === "route" ? "R" : type === "line" ? "L" : "P";
    var lbl = document.createElement("label");
    lbl.textContent = name;
    row.appendChild(cb);
    row.appendChild(badge);
    row.appendChild(lbl);
    return row;
  }

  function populateFeatureList(containerId, previousFilter, includePolygons) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    var routes = App.routes || [];
    var lines = App.lines || [];
    var polygons = (includePolygons && App.polygons) ? App.polygons : [];
    if (routes.length === 0 && lines.length === 0 && polygons.length === 0) {
      container.innerHTML = '<div class="tiny" style="color:var(--muted);">Draw features on the map first.</div>';
      return;
    }
    for (var ri = 0; ri < routes.length; ri++) {
      var name = (routes[ri].properties && routes[ri].properties.name) || ("Route " + (ri + 1));
      var checked = !previousFilter || !previousFilter.routeIndices || previousFilter.routeIndices.indexOf(ri) !== -1;
      container.appendChild(makeFeatureCheckRow("route", ri, name, checked));
    }
    for (var li = 0; li < lines.length; li++) {
      var lname = (lines[li].properties && lines[li].properties.name) || ("Line " + (li + 1));
      var lchecked = !previousFilter || !previousFilter.lineIndices || previousFilter.lineIndices.indexOf(li) !== -1;
      container.appendChild(makeFeatureCheckRow("line", li, lname, lchecked));
    }
    for (var pi = 0; pi < polygons.length; pi++) {
      var pname = (polygons[pi].properties && polygons[pi].properties.name) || ("Polygon " + (pi + 1));
      var pchecked = !previousFilter || !previousFilter.polygonIndices || previousFilter.polygonIndices.indexOf(pi) !== -1;
      container.appendChild(makeFeatureCheckRow("polygon", pi, pname, pchecked));
    }
  }

  function readFeatureFilter(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    var cbs = container.querySelectorAll('input[type="checkbox"]');
    if (cbs.length === 0) return null;
    var routeIndices = [], lineIndices = [], polygonIndices = [];
    var allChecked = true;
    for (var i = 0; i < cbs.length; i++) {
      var type = cbs[i].getAttribute("data-feature-type");
      var idx = parseInt(cbs[i].getAttribute("data-feature-index"), 10);
      if (cbs[i].checked) {
        if (type === "route") routeIndices.push(idx);
        else if (type === "line") lineIndices.push(idx);
        else if (type === "polygon") polygonIndices.push(idx);
      } else {
        allChecked = false;
      }
    }
    if (allChecked) return null;
    return { routeIndices: routeIndices, lineIndices: lineIndices, polygonIndices: polygonIndices };
  }

  function wireFeatureSelectLinks(selectAllId, selectNoneId, containerId) {
    var allLink = document.getElementById(selectAllId);
    var noneLink = document.getElementById(selectNoneId);
    if (allLink) {
      allLink.addEventListener("click", function (e) {
        e.preventDefault();
        var cbs = document.querySelectorAll("#" + containerId + ' input[type="checkbox"]');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = true;
      });
    }
    if (noneLink) {
      noneLink.addEventListener("click", function (e) {
        e.preventDefault();
        var cbs = document.querySelectorAll("#" + containerId + ' input[type="checkbox"]');
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
      });
    }
  }

  // ---- Impact method radio handling ----

  function getSelectedImpactMethod() {
    var radios = document.querySelectorAll('input[name="tviImpactMethod"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) return radios[i].value;
    }
    return "full_route_buffer";
  }

  function updateImpactMethodUI() {
    var method = getSelectedImpactMethod();
    var featureSection = document.getElementById("tviImpactFeatureSection");
    if (featureSection) {
      featureSection.style.display = method === "selected_routes" ? "block" : "none";
    }
  }

  // ---- CSV import ----

  function populateColumnSelect(selectId, headers, guess) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = '<option value="">(none)</option>';
    for (var i = 0; i < headers.length; i++) {
      var opt = document.createElement("option");
      opt.value = headers[i];
      opt.textContent = headers[i];
      sel.appendChild(opt);
    }
    sel.disabled = false;
    if (guess) sel.value = guess;
  }

  function handleCsvUpload(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = e.target.result;
      var parsed = App.parseCSV(text);
      if (!parsed || parsed.length < 2) {
        document.getElementById("tviCsvInfo").textContent = "Error: CSV must have at least a header row and one data row.";
        return;
      }
      _csvHeaders = parsed[0];
      _csvRows = parsed.slice(1);

      var mappingEl = document.getElementById("tviCsvMapping");
      if (mappingEl) mappingEl.style.display = "block";

      var gh = App.guessHeader.bind(null, _csvHeaders);

      populateColumnSelect("tviColRouteName",    _csvHeaders, gh(["route_name","routename","route","name","route_id","routeid"]));
      populateColumnSelect("tviColChangeType",   _csvHeaders, gh(["change_type","changetype","type","action"]));
      populateColumnSelect("tviColBeforeMiles",  _csvHeaders, gh(["before_route_miles","before_miles","existing_miles","before_mi"]));
      populateColumnSelect("tviColAfterMiles",   _csvHeaders, gh(["after_route_miles","after_miles","proposed_miles","after_mi"]));
      populateColumnSelect("tviColBeforeRevHrs", _csvHeaders, gh(["before_revenue_hours","before_rev_hours","existing_rev_hours","before_revhrs"]));
      populateColumnSelect("tviColAfterRevHrs",  _csvHeaders, gh(["after_revenue_hours","after_rev_hours","proposed_rev_hours","after_revhrs"]));
      populateColumnSelect("tviColBeforeSpan",   _csvHeaders, gh(["before_span_hours","before_span","existing_span"]));
      populateColumnSelect("tviColAfterSpan",    _csvHeaders, gh(["after_span_hours","after_span","proposed_span"]));
      populateColumnSelect("tviColBeforeFare",   _csvHeaders, gh(["before_fare","existing_fare","current_fare"]));
      populateColumnSelect("tviColAfterFare",    _csvHeaders, gh(["after_fare","proposed_fare","new_fare"]));

      document.getElementById("tviCsvInfo").textContent = "Loaded " + _csvRows.length + " rows. Map columns and click Import Routes.";
    };
    reader.readAsText(file);
  }

  function parseRoutesFromCSV() {
    if (_csvRows.length === 0) return;

    function colVal(row, selectId) {
      var sel = document.getElementById(selectId);
      if (!sel || !sel.value) return null;
      var idx = _csvHeaders.indexOf(sel.value);
      return idx >= 0 ? row[idx] : null;
    }

    var scenario = _scenarios[_activeScenarioIdx];
    scenario.affectedRoutes = [];

    for (var i = 0; i < _csvRows.length; i++) {
      var row = _csvRows[i];
      var routeName  = colVal(row, "tviColRouteName") || ("Route " + (i + 1));
      var changeType = (colVal(row, "tviColChangeType") || "reduction").toLowerCase().trim();
      var route = {
        routeId: String(i + 1),
        routeName: routeName,
        changeType: changeType,
        before: {
          routeMiles:   App.toNumberSafe(colVal(row, "tviColBeforeMiles")),
          revenueHours: App.toNumberSafe(colVal(row, "tviColBeforeRevHrs")),
          spanHours:    App.toNumberSafe(colVal(row, "tviColBeforeSpan")),
          fare:         App.toNumberSafe(colVal(row, "tviColBeforeFare"))
        },
        after: {
          routeMiles:   App.toNumberSafe(colVal(row, "tviColAfterMiles")),
          revenueHours: App.toNumberSafe(colVal(row, "tviColAfterRevHrs")),
          spanHours:    App.toNumberSafe(colVal(row, "tviColAfterSpan")),
          fare:         App.toNumberSafe(colVal(row, "tviColAfterFare"))
        }
      };
      scenario.affectedRoutes.push(route);
    }

    renderRouteTable(scenario.affectedRoutes);
    document.getElementById("tviCsvInfo").textContent = "Imported " + scenario.affectedRoutes.length + " routes into " + scenario.name + ".";
    markStale();
    saveState();
  }

  function renderRouteTable(routes) {
    var tbody = document.getElementById("tviRouteTbody");
    var wrap = document.getElementById("tviRouteTableWrap");
    if (!tbody || !wrap) return;
    tbody.innerHTML = "";
    if (routes.length === 0) {
      wrap.style.display = "none";
      return;
    }
    wrap.style.display = "block";
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var b = r.before || {};
      var a = r.after || {};
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (r.routeName || "") + "</td>" +
        "<td>" + (r.changeType || "") + "</td>" +
        "<td>" + fmt(b.routeMiles) + " / " + fmt(a.routeMiles) + "</td>" +
        "<td>" + fmt(b.revenueHours) + " / " + fmt(a.revenueHours) + "</td>" +
        "<td>" + fmt(b.spanHours) + " / " + fmt(a.spanHours) + "</td>" +
        "<td>" + fmt(b.fare) + " / " + fmt(a.fare) + "</td>";
      tbody.appendChild(tr);
    }
  }

  function fmt(v) {
    return Number.isFinite(v) ? v.toFixed(1) : "\u2014";
  }

  // ---- Stale detection ----

  function markStale() {
    _stale = true;
    var banner = document.getElementById("tviStaleWarning");
    if (banner) banner.style.display = "block";
  }

  function clearStale() {
    _stale = false;
    var banner = document.getElementById("tviStaleWarning");
    if (banner) banner.style.display = "none";
  }

  // ---- Baseline computation ----

  async function runBaseline(core) {
    if (_running) return;
    _running = true;
    var statusEl = document.getElementById("tviAnalysisStatus");
    if (statusEl) statusEl.textContent = "Computing system baseline...";

    try {
      readPolicyFromDOM();
      _baselineFeatureFilter = readFeatureFilter("tviBaselineFeatureList");

      // Build system union polygon from selected features
      var unionGeom = null;
      if (_baselineFeatureFilter) {
        unionGeom = buildUnionFromFilter(_baselineFeatureFilter);
      } else {
        unionGeom = App.bufferUnionPolygon ? App.bufferUnionPolygon() : (core.getUnion ? core.getUnion() : null);
      }

      if (!unionGeom) {
        if (statusEl) statusEl.textContent = "Error: No features drawn. Draw routes/lines on the map first.";
        _running = false;
        return;
      }

      var demographics = await TV.fetchDemographics(core, unionGeom, _policy.geoLevel, _policy.acsYear);

      _baseline = {
        type: "system_population",
        geoLevel: _policy.geoLevel,
        year: _policy.acsYear,
        minorityShare: demographics.minorityShare,
        lowIncomeShare: demographics.lowIncomeShare,
        totalPop: demographics.totalPop,
        minorityPop: demographics.minorityPop,
        lowIncomePop: demographics.lowIncomePop,
        geoCount: demographics.geoCount,
        computedAt: new Date().toISOString()
      };

      displayBaseline();
      if (statusEl) statusEl.textContent = "Baseline computed successfully.";
      saveState();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error computing baseline: " + e.message;
    }
    _running = false;
  }

  function displayBaseline() {
    if (!_baseline) return;
    var box = document.getElementById("tviBaselineBox");
    if (box) box.style.display = "block";
    var minEl = document.getElementById("tviBaselineMinority");
    if (minEl) minEl.textContent = (_baseline.minorityShare * 100).toFixed(1) + "%";
    var liEl = document.getElementById("tviBaselineLowIncome");
    if (liEl) liEl.textContent = (_baseline.lowIncomeShare * 100).toFixed(1) + "%";
    var geoEl = document.getElementById("tviBaselineGeos");
    if (geoEl) geoEl.textContent = String(_baseline.geoCount);
    var popEl = document.getElementById("tviBaselinePop");
    if (popEl) popEl.textContent = _baseline.totalPop.toLocaleString();
  }

  // ---- Build union from feature filter ----

  function buildUnionFromFilter(filter) {
    var bufs = [];
    var routeBuffers = App.routeBuffers || [];
    var lineBuffers = App.lineBuffers || [];
    if (filter.routeIndices) {
      for (var i = 0; i < filter.routeIndices.length; i++) {
        var ri = filter.routeIndices[i];
        if (routeBuffers[ri]) bufs.push(routeBuffers[ri]);
      }
    }
    if (filter.lineIndices) {
      for (var j = 0; j < filter.lineIndices.length; j++) {
        var li = filter.lineIndices[j];
        if (lineBuffers[li]) bufs.push(lineBuffers[li]);
      }
    }
    if (filter.polygonIndices) {
      var polygons = App.polygons || [];
      for (var k = 0; k < filter.polygonIndices.length; k++) {
        var pi = filter.polygonIndices[k];
        if (polygons[pi]) bufs.push(polygons[pi]);
      }
    }
    if (bufs.length === 0) return null;
    var result = bufs[0];
    for (var u = 1; u < bufs.length; u++) {
      try { result = turf.union(result, bufs[u]); } catch (e) { /* skip */ }
    }
    return result;
  }

  // ---- Run equity analysis ----

  async function runAnalysis(core) {
    if (_running) return;
    if (!_baseline) {
      var statusEl = document.getElementById("tviAnalysisStatus");
      if (statusEl) statusEl.textContent = "Compute a system baseline first.";
      return;
    }
    _running = true;
    var statusEl = document.getElementById("tviAnalysisStatus");
    if (statusEl) statusEl.textContent = "Running equity analysis...";

    try {
      readPolicyFromDOM();
      var scenario = _scenarios[_activeScenarioIdx];

      // Update scenario's impact method from DOM
      scenario.impactMethod = getSelectedImpactMethod();
      if (scenario.impactMethod === "selected_routes") {
        _impactFeatureFilter = readFeatureFilter("tviImpactFeatureList");
        scenario.selectedFeatures = _impactFeatureFilter || { routeIndices: [], lineIndices: [], polygonIndices: [] };
      }

      // 1. Major Change evaluation
      var mcResult = TV.evaluateMajorChange(_policy, scenario);

      // 2. Build impacted area
      var impactedArea = TV.buildImpactedArea(scenario);
      if (!impactedArea.geometry) {
        if (statusEl) statusEl.textContent = "Error: No impacted area geometry. Draw features or select an impact method with available features.";
        _running = false;
        return;
      }

      // 3. Fetch demographics for impacted area
      var demographics = await TV.fetchDemographics(core, impactedArea.geometry, _policy.geoLevel, _policy.acsYear);

      // 4. Evaluate findings
      var findings = TV.evaluateFindings(demographics, _baseline, _policy);

      // 5. Cache for instant re-evaluation
      _cachedDemographics[scenario.id] = demographics;
      _cachedImpactedGeom[scenario.id] = impactedArea.geometry;

      // 6. Store result
      var result = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenario: scenario,
        majorChangeResult: mcResult,
        demographics: demographics,
        findings: findings,
        impactedAreaGeometry: impactedArea.geometry,
        computedAt: new Date().toISOString()
      };
      _results[scenario.id] = result;

      // 7. Display
      displayResults(result);
      renderImpactedArea(impactedArea.geometry);
      clearStale();

      if (statusEl) statusEl.textContent = "Analysis complete.";
      saveState();
    } catch (e) {
      if (statusEl) statusEl.textContent = "Error: " + e.message;
    }
    _running = false;
  }

  // ---- Instant re-evaluation (threshold changes only) ----

  function runInstantReevaluation() {
    var scenario = _scenarios[_activeScenarioIdx];
    if (!scenario) return;
    var cached = _cachedDemographics[scenario.id];
    if (!cached || !_baseline) return;

    readPolicyFromDOM();

    var mcResult = TV.evaluateMajorChange(_policy, scenario);
    var findings = TV.evaluateFindings(cached, _baseline, _policy);

    var result = _results[scenario.id];
    if (result) {
      result.majorChangeResult = mcResult;
      result.findings = findings;
      displayResults(result);
    }
  }

  // ---- Display results ----

  function displayResults(result) {
    var emptyEl = document.getElementById("tviResultsEmpty");
    var wrapEl = document.getElementById("tviResultsWrap");
    if (emptyEl) emptyEl.style.display = "none";
    if (wrapEl) wrapEl.style.display = "block";

    // Major Change
    var mcVerdict = document.getElementById("tviMcVerdict");
    if (mcVerdict) {
      if (result.majorChangeResult.triggered) {
        setPill(mcVerdict, "Major Change Triggered", "high");
      } else {
        setPill(mcVerdict, "Not a Major Change", "low");
      }
    }

    var mcRulesEl = document.getElementById("tviMcRules");
    if (mcRulesEl) {
      mcRulesEl.innerHTML = "";
      var rr = result.majorChangeResult.ruleResults || [];
      for (var i = 0; i < rr.length; i++) {
        var rule = rr[i];
        var div = document.createElement("div");
        div.className = "tvi-rule-result";
        var pillClass = rule.triggered ? "high" : "mh";
        var valueStr = typeof rule.metricValue === "number"
          ? (rule.metricValue >= 0 ? "+" : "") + rule.metricValue.toFixed(1) + "%"
          : rule.metricValue;
        div.innerHTML =
          '<span class="pill ' + pillClass + '" style="font-size:11px;">' + (rule.triggered ? "TRIGGERED" : "OK") + '</span> ' +
          '<span class="tiny">' + rule.label + ' — ' + rule.routeName +
          ' (' + valueStr + (rule.threshold ? ' vs ' + rule.threshold + '%' : '') + ')</span>';
        mcRulesEl.appendChild(div);
      }
      if (rr.length === 0) {
        mcRulesEl.innerHTML = '<div class="tiny" style="color:var(--muted);">No route data imported. Import routes in Policies & Inputs tab.</div>';
      }
    }

    // Minority / Disparate Impact
    displayFinding("Di", result.findings.minority);

    // Low-Income / Disproportionate Burden
    displayFinding("Db", result.findings.lowIncome);

    // Summary stats
    var geoEl = document.getElementById("tviSummaryGeos");
    if (geoEl) geoEl.textContent = String(result.demographics.geoCount);
    var popEl = document.getElementById("tviSummaryPop");
    if (popEl) popEl.textContent = result.demographics.totalPop.toLocaleString();

    // Enable export buttons
    var csvBtn = document.getElementById("tviExportCSV");
    if (csvBtn) csvBtn.disabled = false;
    var geoBtn = document.getElementById("tviExportGeoJSON");
    if (geoBtn) geoBtn.disabled = false;

    // Update comparison table
    updateComparisonTable();
  }

  function displayFinding(prefix, finding) {
    var verdict = document.getElementById("tvi" + prefix + "Verdict");
    if (verdict) {
      if (finding.exceedsThreshold) {
        setPill(verdict, finding.finding, "high");
      } else {
        setPill(verdict, finding.finding, "mh");
      }
    }
    var impEl = document.getElementById("tvi" + prefix + "Impacted");
    if (impEl) impEl.textContent = (finding.impactedShare * 100).toFixed(1) + "%";
    var baseEl = document.getElementById("tvi" + prefix + "Baseline");
    if (baseEl) baseEl.textContent = (finding.baselineShare * 100).toFixed(1) + "%";
    var diffEl = document.getElementById("tvi" + prefix + "Diff");
    if (diffEl) diffEl.textContent = (finding.diffPpt >= 0 ? "+" : "") + finding.diffPpt.toFixed(1) + " ppt";
    var threshEl = document.getElementById("tvi" + prefix + "Thresh");
    if (threshEl) threshEl.textContent = finding.thresholdPpt + " ppt";
  }

  function setPill(el, text, cls) {
    el.textContent = text;
    el.className = "pill " + cls;
  }

  // ---- Map overlay for impacted area ----

  function renderImpactedArea(geometry) {
    clearOverlay();
    var map = App.map;
    if (!map || !geometry) return;
    var geojson = geometry.type === "FeatureCollection" ? geometry
      : geometry.type === "Feature" ? { type: "FeatureCollection", features: [geometry] }
      : { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: geometry }] };

    map.addSource("tvi-impacted", { type: "geojson", data: geojson });
    map.addLayer({
      id: "tvi-impacted-fill",
      type: "fill",
      source: "tvi-impacted",
      paint: { "fill-color": "#e53e3e", "fill-opacity": 0.15 }
    });
    map.addLayer({
      id: "tvi-impacted-outline",
      type: "line",
      source: "tvi-impacted",
      paint: { "line-color": "#e53e3e", "line-width": 2, "line-opacity": 0.6 }
    });
  }

  function clearOverlay() {
    var map = App.map;
    if (!map) return;
    if (map.getLayer("tvi-impacted-fill")) map.removeLayer("tvi-impacted-fill");
    if (map.getLayer("tvi-impacted-outline")) map.removeLayer("tvi-impacted-outline");
    if (map.getSource("tvi-impacted")) map.removeSource("tvi-impacted");
  }

  // ---- Scenario management ----

  function populateScenarioDropdown() {
    var sel = document.getElementById("tviScenarioSelect");
    if (!sel) return;
    sel.innerHTML = "";
    for (var i = 0; i < _scenarios.length; i++) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = _scenarios[i].name;
      if (i === _activeScenarioIdx) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function switchScenario(idx) {
    _activeScenarioIdx = idx;
    var scenario = _scenarios[idx];
    if (!scenario) return;

    // Render route table for this scenario
    renderRouteTable(scenario.affectedRoutes || []);

    // Set impact method
    var radios = document.querySelectorAll('input[name="tviImpactMethod"]');
    for (var i = 0; i < radios.length; i++) {
      radios[i].checked = radios[i].value === (scenario.impactMethod || "full_route_buffer");
    }
    updateImpactMethodUI();

    // Display results if available
    var result = _results[scenario.id];
    if (result) {
      displayResults(result);
    } else {
      // Clear results display
      var emptyEl = document.getElementById("tviResultsEmpty");
      var wrapEl = document.getElementById("tviResultsWrap");
      if (emptyEl) emptyEl.style.display = "block";
      if (wrapEl) wrapEl.style.display = "none";
    }
  }

  function duplicateScenario() {
    var source = _scenarios[_activeScenarioIdx];
    var newScenario = TV.createScenario(source.name + " (copy)");
    newScenario.type = source.type;
    newScenario.affectedRoutes = JSON.parse(JSON.stringify(source.affectedRoutes || []));
    newScenario.impactMethod = source.impactMethod;
    newScenario.selectedFeatures = JSON.parse(JSON.stringify(source.selectedFeatures || {}));
    newScenario.notes = source.notes;
    _scenarios.push(newScenario);
    _activeScenarioIdx = _scenarios.length - 1;
    populateScenarioDropdown();
    switchScenario(_activeScenarioIdx);
    saveState();
  }

  function renameScenario() {
    var scenario = _scenarios[_activeScenarioIdx];
    var newName = prompt("Enter new scenario name:", scenario.name);
    if (newName && newName.trim()) {
      scenario.name = newName.trim();
      populateScenarioDropdown();
      saveState();
    }
  }

  function deleteScenario() {
    if (_scenarios.length <= 1) return;
    var scenario = _scenarios[_activeScenarioIdx];
    if (!confirm("Delete scenario \"" + scenario.name + "\"?")) return;
    delete _results[scenario.id];
    delete _cachedDemographics[scenario.id];
    delete _cachedImpactedGeom[scenario.id];
    _scenarios.splice(_activeScenarioIdx, 1);
    _activeScenarioIdx = Math.min(_activeScenarioIdx, _scenarios.length - 1);
    populateScenarioDropdown();
    switchScenario(_activeScenarioIdx);
    updateComparisonTable();
    saveState();
  }

  // ---- Comparison table ----

  function updateComparisonTable() {
    var analyzedResults = [];
    for (var i = 0; i < _scenarios.length; i++) {
      var r = _results[_scenarios[i].id];
      if (r) analyzedResults.push(r);
    }

    var emptyEl = document.getElementById("tviCompEmpty");
    var tableEl = document.getElementById("tviComparisonTable");
    if (analyzedResults.length === 0) {
      if (emptyEl) emptyEl.style.display = "block";
      if (tableEl) tableEl.style.display = "none";
      var expBtn = document.getElementById("tviExportCompCSV");
      if (expBtn) expBtn.disabled = true;
      var sesBtn = document.getElementById("tviExportSessionJSON");
      if (sesBtn) sesBtn.disabled = true;
      return;
    }

    if (emptyEl) emptyEl.style.display = "none";
    if (tableEl) tableEl.style.display = "table";

    var comparison = TV.compareScenarios(analyzedResults);

    // Build header
    var thead = document.getElementById("tviCompThead");
    if (thead) {
      var headerRow = "<tr><th></th>";
      for (var h = 0; h < comparison.length; h++) {
        headerRow += "<th>" + comparison[h].scenarioName + "</th>";
      }
      headerRow += "</tr>";
      thead.innerHTML = headerRow;
    }

    // Build body
    var tbody = document.getElementById("tviCompTbody");
    if (tbody) {
      var rows = [
        { label: "Major Change", key: "majorChangeTriggered", format: function (v) { return v ? '<span class="pill high" style="font-size:11px;">Yes</span>' : '<span class="pill mh" style="font-size:11px;">No</span>'; } },
        { label: "Routes Affected", key: "routesAffected", format: String },
        { label: "Impacted Pop.", key: "totalPop", format: function (v) { return v.toLocaleString(); } },
        { label: "Minority Share", key: "minorityShare", format: function (v) { return (v * 100).toFixed(1) + "%"; } },
        { label: "Low-Income Share", key: "lowIncomeShare", format: function (v) { return (v * 100).toFixed(1) + "%"; } },
        { label: "DI Finding", key: "minorityFinding", format: function (v, item) { return '<span class="pill ' + (item.minorityExceeds ? "high" : "mh") + '" style="font-size:11px;">' + v + '</span>'; } },
        { label: "DB Finding", key: "lowIncomeFinding", format: function (v, item) { return '<span class="pill ' + (item.lowIncomeExceeds ? "high" : "mh") + '" style="font-size:11px;">' + v + '</span>'; } },
        { label: "Minority Diff (ppt)", key: "minorityDiffPpt", format: function (v) { return (v >= 0 ? "+" : "") + v.toFixed(1); } },
        { label: "Low-Income Diff (ppt)", key: "lowIncomeDiffPpt", format: function (v) { return (v >= 0 ? "+" : "") + v.toFixed(1); } }
      ];

      tbody.innerHTML = "";
      for (var r = 0; r < rows.length; r++) {
        var tr = document.createElement("tr");
        tr.innerHTML = '<td class="tiny" style="font-weight:600;">' + rows[r].label + '</td>';
        for (var c = 0; c < comparison.length; c++) {
          var td = document.createElement("td");
          td.className = "tiny";
          td.style.textAlign = "center";
          td.innerHTML = rows[r].format(comparison[c][rows[r].key], comparison[c]);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    var expBtn = document.getElementById("tviExportCompCSV");
    if (expBtn) expBtn.disabled = false;
    var sesBtn = document.getElementById("tviExportSessionJSON");
    if (sesBtn) sesBtn.disabled = false;
  }

  // ---- Exports ----

  function downloadFile(content, filename, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function exportFindingsCSV() {
    var lines = [];
    lines.push("scenario_name,route_name,change_type,major_change_triggered," +
      "before_miles,after_miles,pct_change_miles," +
      "before_rev_hours,after_rev_hours,pct_change_rev_hours," +
      "impacted_total_pop,impacted_minority_share,impacted_lowincome_share," +
      "baseline_minority_share,baseline_lowincome_share," +
      "di_diff_ppt,di_threshold,di_finding," +
      "db_diff_ppt,db_threshold,db_finding,policy_name");

    for (var s = 0; s < _scenarios.length; s++) {
      var sc = _scenarios[s];
      var result = _results[sc.id];
      if (!result) continue;

      var routes = sc.affectedRoutes || [{ routeName: "(system)", changeType: "" }];
      for (var r = 0; r < routes.length; r++) {
        var rt = routes[r];
        var b = rt.before || {};
        var a = rt.after || {};
        var metrics = TV.computeRouteMetrics(rt);
        var f = result.findings || {};
        var fm = f.minority || {};
        var fl = f.lowIncome || {};
        var d = result.demographics || {};
        var row = [
          csvEscape(sc.name),
          csvEscape(rt.routeName || ""),
          csvEscape(rt.changeType || ""),
          result.majorChangeResult.triggered ? "Yes" : "No",
          numOrEmpty(b.routeMiles), numOrEmpty(a.routeMiles), numOrEmpty(metrics.routeMilesPct),
          numOrEmpty(b.revenueHours), numOrEmpty(a.revenueHours), numOrEmpty(metrics.revenueHoursPct),
          d.totalPop || "", pctOrEmpty(d.minorityShare), pctOrEmpty(d.lowIncomeShare),
          pctOrEmpty(_baseline ? _baseline.minorityShare : null),
          pctOrEmpty(_baseline ? _baseline.lowIncomeShare : null),
          numOrEmpty(fm.diffPpt), numOrEmpty(fm.thresholdPpt), csvEscape(fm.finding || ""),
          numOrEmpty(fl.diffPpt), numOrEmpty(fl.thresholdPpt), csvEscape(fl.finding || ""),
          csvEscape(_policy.name)
        ];
        lines.push(row.join(","));
      }
    }

    downloadFile(lines.join("\n"), "title-vi-findings-" + dateStamp() + ".csv", "text/csv");
  }

  function csvEscape(s) {
    if (!s) return "";
    s = String(s);
    if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function numOrEmpty(v) {
    return Number.isFinite(v) ? v.toFixed(2) : "";
  }

  function pctOrEmpty(v) {
    return Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "";
  }

  function exportImpactedGeoJSON() {
    var scenario = _scenarios[_activeScenarioIdx];
    var result = _results[scenario.id];
    if (!result || !result.impactedAreaGeometry) return;

    var geom = result.impactedAreaGeometry;
    var feature = geom.type === "Feature" ? geom : { type: "Feature", properties: {}, geometry: geom };
    feature.properties = {
      scenario: scenario.name,
      impactMethod: scenario.impactMethod,
      totalPop: result.demographics.totalPop,
      minorityShare: (result.demographics.minorityShare * 100).toFixed(1) + "%",
      lowIncomeShare: (result.demographics.lowIncomeShare * 100).toFixed(1) + "%",
      diFinding: result.findings.minority.finding,
      dbFinding: result.findings.lowIncome.finding,
      generatedAt: new Date().toISOString()
    };

    var fc = { type: "FeatureCollection", features: [feature] };
    downloadFile(JSON.stringify(fc, null, 2), "title-vi-impacted-area-" + dateStamp() + ".geojson", "application/geo+json");
  }

  function exportSessionJSON() {
    var state = collectState("full");
    downloadFile(JSON.stringify(state, null, 2), "title-vi-session-" + dateStamp() + ".json", "application/json");
  }

  function exportComparisonCSV() {
    var analyzedResults = [];
    for (var i = 0; i < _scenarios.length; i++) {
      var r = _results[_scenarios[i].id];
      if (r) analyzedResults.push(r);
    }
    if (analyzedResults.length === 0) return;

    var comparison = TV.compareScenarios(analyzedResults);
    var lines = [];
    lines.push("metric," + comparison.map(function (c) { return csvEscape(c.scenarioName); }).join(","));

    var metrics = [
      { label: "Major Change", key: "majorChangeTriggered", fmt: function (v) { return v ? "Yes" : "No"; } },
      { label: "Routes Affected", key: "routesAffected", fmt: String },
      { label: "Impacted Population", key: "totalPop", fmt: String },
      { label: "Minority Share", key: "minorityShare", fmt: function (v) { return (v * 100).toFixed(1) + "%"; } },
      { label: "Low-Income Share", key: "lowIncomeShare", fmt: function (v) { return (v * 100).toFixed(1) + "%"; } },
      { label: "DI Finding", key: "minorityFinding", fmt: String },
      { label: "DB Finding", key: "lowIncomeFinding", fmt: String },
      { label: "Minority Diff (ppt)", key: "minorityDiffPpt", fmt: function (v) { return v.toFixed(1); } },
      { label: "Low-Income Diff (ppt)", key: "lowIncomeDiffPpt", fmt: function (v) { return v.toFixed(1); } }
    ];

    for (var m = 0; m < metrics.length; m++) {
      var row = csvEscape(metrics[m].label);
      for (var c = 0; c < comparison.length; c++) {
        row += "," + csvEscape(metrics[m].fmt(comparison[c][metrics[m].key]));
      }
      lines.push(row);
    }

    downloadFile(lines.join("\n"), "title-vi-comparison-" + dateStamp() + ".csv", "text/csv");
  }

  // ---- Session import ----

  function importSessionJSON(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        applyState(data);
        if (isPopupVisible()) {
          writePolicyToDOM();
          populateScenarioDropdown();
          switchScenario(_activeScenarioIdx);
          displayBaseline();
          updateComparisonTable();
        }
      } catch (err) {
        alert("Failed to import session: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---- Session persistence ----

  function collectState(mode) {
    readPolicyFromDOM();
    var state = {
      version: 1,
      policy: JSON.parse(JSON.stringify(_policy)),
      scenarios: JSON.parse(JSON.stringify(_scenarios)),
      activeScenarioIdx: _activeScenarioIdx,
      baseline: _baseline ? JSON.parse(JSON.stringify(_baseline)) : null,
      stale: _stale,
      activeTab: _activeTab
    };

    // Store results (without geos in light mode)
    var results = {};
    Object.keys(_results).forEach(function (key) {
      var r = JSON.parse(JSON.stringify(_results[key]));
      if (mode === "light") {
        delete r.impactedAreaGeometry;
        if (r.demographics) delete r.demographics.geos;
      }
      results[key] = r;
    });
    state.results = results;
    return state;
  }

  function applyState(data) {
    if (!data || data.version !== 1) return;
    if (data.policy) _policy = data.policy;
    if (data.scenarios) _scenarios = data.scenarios;
    if (typeof data.activeScenarioIdx === "number") _activeScenarioIdx = data.activeScenarioIdx;
    if (data.baseline) _baseline = data.baseline;
    if (data.results) _results = data.results;
    if (typeof data.stale === "boolean") _stale = data.stale;
    if (data.activeTab) _activeTab = data.activeTab;
  }

  function saveState() {
    if (App.cache && App.cache.save) App.cache.save();
  }

  // ---- Module lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Tab switching
    var tabs = document.querySelectorAll(".tvi-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        readPolicyFromDOM();
        switchTab(this.getAttribute("data-tab"));
      });
    }

    // CSV upload
    var csvFile = document.getElementById("tviCsvFile");
    if (csvFile) csvFile.addEventListener("change", function () { handleCsvUpload(this.files[0]); });

    var parseBtn = document.getElementById("tviParseCSV");
    if (parseBtn) parseBtn.addEventListener("click", parseRoutesFromCSV);

    // Impact method radios
    var radios = document.querySelectorAll('input[name="tviImpactMethod"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener("change", updateImpactMethodUI);
    }

    // Feature select links
    wireFeatureSelectLinks("tviImpactSelectAll", "tviImpactSelectNone", "tviImpactFeatureList");
    wireFeatureSelectLinks("tviBaselineSelectAll", "tviBaselineSelectNone", "tviBaselineFeatureList");

    // Baseline button
    var baselineBtn = document.getElementById("tviComputeBaseline");
    if (baselineBtn) baselineBtn.addEventListener("click", function () { runBaseline(core); });

    // Analysis button
    var analysisBtn = document.getElementById("tviRunAnalysis");
    if (analysisBtn) analysisBtn.addEventListener("click", function () { runAnalysis(core); });

    // Threshold change -> instant re-evaluation
    var thresholdInputs = ["tviDiThreshold", "tviDbThreshold",
      "tviThreshRouteMiles", "tviThreshRevHours", "tviThreshSpan", "tviThreshFare"];
    var ruleCheckboxes = ["tviRuleRouteMiles", "tviRuleRevHours", "tviRuleSpan", "tviRuleElimination", "tviRuleFare"];
    thresholdInputs.concat(ruleCheckboxes).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", runInstantReevaluation);
    });

    // Scenario management
    var scenarioSelect = document.getElementById("tviScenarioSelect");
    if (scenarioSelect) scenarioSelect.addEventListener("change", function () {
      switchScenario(parseInt(this.value, 10));
    });

    var dupBtn = document.getElementById("tviDuplicateScenario");
    if (dupBtn) dupBtn.addEventListener("click", duplicateScenario);

    var renBtn = document.getElementById("tviRenameScenario");
    if (renBtn) renBtn.addEventListener("click", renameScenario);

    var delBtn = document.getElementById("tviDeleteScenario");
    if (delBtn) delBtn.addEventListener("click", deleteScenario);

    // Export buttons
    var csvExpBtn = document.getElementById("tviExportCSV");
    if (csvExpBtn) csvExpBtn.addEventListener("click", exportFindingsCSV);

    var geoExpBtn = document.getElementById("tviExportGeoJSON");
    if (geoExpBtn) geoExpBtn.addEventListener("click", exportImpactedGeoJSON);

    var compExpBtn = document.getElementById("tviExportCompCSV");
    if (compExpBtn) compExpBtn.addEventListener("click", exportComparisonCSV);

    var sesExpBtn = document.getElementById("tviExportSessionJSON");
    if (sesExpBtn) sesExpBtn.addEventListener("click", exportSessionJSON);

    // Session import
    var importFile = document.getElementById("tviImportSessionFile");
    if (importFile) importFile.addEventListener("change", function () { importSessionJSON(this.files[0]); });
  }

  function onOpen(core) {
    writePolicyToDOM();
    switchTab(_activeTab);
    populateScenarioDropdown();

    // Populate feature checklists
    populateFeatureList("tviBaselineFeatureList", _baselineFeatureFilter);
    populateFeatureList("tviImpactFeatureList", _impactFeatureFilter, true);

    // Restore scenario display
    var scenario = _scenarios[_activeScenarioIdx];
    renderRouteTable(scenario ? (scenario.affectedRoutes || []) : []);

    // Set impact method radio
    if (scenario) {
      var radios = document.querySelectorAll('input[name="tviImpactMethod"]');
      for (var i = 0; i < radios.length; i++) {
        radios[i].checked = radios[i].value === (scenario.impactMethod || "full_route_buffer");
      }
    }
    updateImpactMethodUI();

    // Restore results display
    if (scenario && _results[scenario.id]) {
      displayResults(_results[scenario.id]);
    }

    // Restore baseline display
    displayBaseline();

    // Update comparison table
    updateComparisonTable();

    // Show stale warning if needed
    if (_stale) {
      var banner = document.getElementById("tviStaleWarning");
      if (banner) banner.style.display = "block";
    }
  }

  function onClose() {
    readPolicyFromDOM();
  }

  async function update(core) {
    // Features changed — mark stale
    if (Object.keys(_results).length > 0) {
      markStale();
    }

    if (!isPopupVisible()) return;

    // Refresh feature checklists
    populateFeatureList("tviBaselineFeatureList", _baselineFeatureFilter);
    populateFeatureList("tviImpactFeatureList", _impactFeatureFilter, true);
  }

  // ---- Register with App.cache ----

  if (App.cache && App.cache.registerModule) {
    App.cache.registerModule("title-vi", {
      collect: function (mode) { return collectState(mode); },
      apply: function (data) { applyState(data); }
    });
  }

  // ---- Module registration ----

  App.registerModule({
    id: "title-vi",
    name: "Title VI Service Equity",
    enabled: true,
    popupWidth: 960,
    popupHTML: "projects/title-vi-popup.html",
    init: function (core) { init(core); },
    onOpen: function (core) { onOpen(core); },
    onClose: function () { onClose(); },
    update: async function (core) { await update(core); }
  });

})();
