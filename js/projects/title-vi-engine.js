// js/projects/title-vi-engine.js
// Title VI Service Equity Analysis — pure calculation engine.
// No DOM access. Major-change evaluation, demographic computation,
// finding evaluation, scenario comparison.
// Depends on: App namespace (census), turf (CDN).
// Exports: window.TitleVI namespace

(function () {
  "use strict";

  var TitleVI = window.TitleVI = {};

  // =========================================================================
  // Default policy profile
  // =========================================================================

  TitleVI.defaultPolicy = function () {
    return {
      name: "Agency Default Policy",
      majorChange: {
        routeMilesPct:   { enabled: true,  threshold: 25 },
        revenueHoursPct: { enabled: true,  threshold: 25 },
        spanHoursPct:    { enabled: false, threshold: 25 },
        routeElimination:{ enabled: true },
        fareChangePct:   { enabled: false, threshold: 10 }
      },
      disparateImpactThresholdPpt: 15,
      disproportionateBurdenThresholdPpt: 15,
      geoLevel: "bg",
      acsYear: "2024",
      bufferDistanceMiles: 0.5
    };
  };

  // =========================================================================
  // Default scenario
  // =========================================================================

  var _nextScenarioId = 1;

  TitleVI.createScenario = function (name) {
    return {
      id: "scenario-" + (_nextScenarioId++),
      name: name || "Scenario " + (_nextScenarioId - 1),
      type: "service_change",
      affectedRoutes: [],
      impactMethod: "full_route_buffer",
      selectedFeatures: { routeIndices: [], lineIndices: [], polygonIndices: [] },
      notes: ""
    };
  };

  // =========================================================================
  // Route metrics computation (pure)
  // =========================================================================

  TitleVI.computeRouteMetrics = function (route) {
    var b = route.before || {};
    var a = route.after  || {};

    function pctChange(before, after) {
      if (!Number.isFinite(before) || before === 0) return null;
      if (!Number.isFinite(after)) return null;
      return ((after - before) / before) * 100;
    }

    return {
      routeId: route.routeId,
      routeName: route.routeName,
      changeType: route.changeType,
      routeMilesPct:   pctChange(b.routeMiles, a.routeMiles),
      revenueHoursPct: pctChange(b.revenueHours, a.revenueHours),
      spanHoursPct:    pctChange(b.spanHours, a.spanHours),
      farePct:         pctChange(b.fare, a.fare),
      isElimination:   route.changeType === "elimination",
      isNewRoute:      route.changeType === "new_route"
    };
  };

  // =========================================================================
  // Major Service Change evaluation (pure)
  // =========================================================================

  var RULE_DEFS = {
    routeMilesPct:   { label: "Route miles changed",    metric: "routeMilesPct",   absCompare: true },
    revenueHoursPct: { label: "Revenue hours changed",  metric: "revenueHoursPct", absCompare: true },
    spanHoursPct:    { label: "Span of service changed", metric: "spanHoursPct",   absCompare: true },
    routeElimination:{ label: "Route eliminated",        metric: "isElimination",  isBoolean: true },
    fareChangePct:   { label: "Fare changed",            metric: "farePct",        absCompare: true }
  };

  TitleVI.evaluateMajorChange = function (policy, scenario) {
    var rules = policy.majorChange || {};
    var routes = scenario.affectedRoutes || [];
    var ruleResults = [];
    var triggered = false;

    // Compute per-route metrics
    var routeMetrics = routes.map(TitleVI.computeRouteMetrics);

    Object.keys(RULE_DEFS).forEach(function (ruleId) {
      var ruleCfg = rules[ruleId];
      if (!ruleCfg || !ruleCfg.enabled) return;

      var def = RULE_DEFS[ruleId];

      for (var i = 0; i < routeMetrics.length; i++) {
        var rm = routeMetrics[i];
        var value = rm[def.metric];

        var ruleTriggered = false;
        if (def.isBoolean) {
          ruleTriggered = !!value;
        } else if (Number.isFinite(value)) {
          var compareVal = def.absCompare ? Math.abs(value) : value;
          ruleTriggered = compareVal >= ruleCfg.threshold;
        }

        if (ruleTriggered) triggered = true;

        ruleResults.push({
          ruleId: ruleId,
          label: def.label,
          routeId: rm.routeId,
          routeName: rm.routeName,
          metricValue: def.isBoolean ? (value ? "Yes" : "No") : value,
          threshold: ruleCfg.threshold || null,
          triggered: ruleTriggered
        });
      }
    });

    return {
      triggered: triggered,
      ruleResults: ruleResults,
      routeMetrics: routeMetrics
    };
  };

  // =========================================================================
  // Impacted area construction (async)
  // =========================================================================

  TitleVI.buildImpactedArea = function (scenario) {
    var method = scenario.impactMethod || "full_route_buffer";
    var sel = scenario.selectedFeatures || {};
    var geometry = null;

    if (method === "full_route_buffer") {
      // Union all route and line buffers
      var allBuffers = [];
      var routeBuffers = App.routeBuffers || [];
      var lineBuffers = App.lineBuffers || [];
      for (var i = 0; i < routeBuffers.length; i++) allBuffers.push(routeBuffers[i]);
      for (var j = 0; j < lineBuffers.length; j++) allBuffers.push(lineBuffers[j]);
      if (allBuffers.length > 0) {
        geometry = allBuffers[0];
        for (var k = 1; k < allBuffers.length; k++) {
          try { geometry = turf.union(geometry, allBuffers[k]); } catch (e) { /* skip */ }
        }
      }
    } else if (method === "user_polygon") {
      // Union drawn polygons
      var polygons = App.polygons || [];
      var indices = (sel.polygonIndices && sel.polygonIndices.length > 0)
        ? sel.polygonIndices : polygons.map(function (_, i) { return i; });
      var selected = indices.map(function (i) { return polygons[i]; }).filter(Boolean);
      if (selected.length > 0) {
        geometry = selected[0];
        for (var p = 1; p < selected.length; p++) {
          try { geometry = turf.union(geometry, selected[p]); } catch (e) { /* skip */ }
        }
      }
    } else if (method === "selected_routes") {
      // Union buffers of specific routes/lines
      var allBufs = [];
      var rIndices = sel.routeIndices || [];
      var lIndices = sel.lineIndices || [];
      var rBufs = App.routeBuffers || [];
      var lBufs = App.lineBuffers || [];
      for (var ri = 0; ri < rIndices.length; ri++) {
        if (rBufs[rIndices[ri]]) allBufs.push(rBufs[rIndices[ri]]);
      }
      for (var li = 0; li < lIndices.length; li++) {
        if (lBufs[lIndices[li]]) allBufs.push(lBufs[lIndices[li]]);
      }
      if (allBufs.length > 0) {
        geometry = allBufs[0];
        for (var u = 1; u < allBufs.length; u++) {
          try { geometry = turf.union(geometry, allBufs[u]); } catch (e) { /* skip */ }
        }
      }
    }

    return { geometry: geometry, method: method };
  };

  // =========================================================================
  // Demographic computation (async — Census API calls)
  // =========================================================================

  TitleVI.fetchDemographics = async function (core, unionGeom, geoLevel, year) {
    if (!unionGeom) throw new Error("No impacted area geometry provided.");

    // 1. Fetch intersecting census geographies
    var geos = await core.fetchTigerwebGeos(geoLevel, unionGeom);
    if (!geos || geos.length === 0) {
      return { totalPop: 0, minorityPop: 0, minorityShare: 0, lowIncomePop: 0, lowIncomeShare: 0, geoCount: 0, geos: [] };
    }

    var geoids = geos.map(function (g) {
      return g.properties.GEOID || g.properties.GEOID20 || g.properties.GEOID10 || "";
    }).filter(Boolean);

    // 2. Fetch ACS variables
    var b03002_001 = await App.fetchACSValues(geoLevel, year, "B03002_001E", geoids);
    var b03002_003 = await App.fetchACSValues(geoLevel, year, "B03002_003E", geoids);

    // Poverty: try at requested geoLevel first
    var b17001_002 = await App.fetchACSValues(geoLevel, year, "B17001_002E", geoids);
    var b01003_001 = await App.fetchACSValues(geoLevel, year, "B01003_001E", geoids);

    // Tract-level fallback for poverty at block group level
    if (geoLevel === "bg") {
      var povertyFinite = 0;
      b17001_002.forEach(function (v) { if (Number.isFinite(v)) povertyFinite++; });
      if (povertyFinite === 0 && geos.length > 0) {
        // Re-fetch at tract level and remap to block groups
        var tractGeoids = [];
        var tractMap = {};
        geoids.forEach(function (bgId) {
          var tractId = bgId.substring(0, 11);
          if (!tractMap[tractId]) {
            tractMap[tractId] = true;
            tractGeoids.push(tractId);
          }
        });
        var tractPoverty = await App.fetchACSValues("tract", year, "B17001_002E", tractGeoids);
        // Map tract values back to block groups
        b17001_002 = new Map();
        geoids.forEach(function (bgId) {
          var tractId = bgId.substring(0, 11);
          var tv = tractPoverty.get(tractId);
          if (Number.isFinite(tv)) b17001_002.set(bgId, tv);
        });
      }
    }

    // 3. Aggregate within union
    var aggTotal    = core.aggregateWithinUnion(unionGeom, geos, b03002_001, "sum");
    var aggNhWhite  = core.aggregateWithinUnion(unionGeom, geos, b03002_003, "sum");
    var aggPoverty  = core.aggregateWithinUnion(unionGeom, geos, b17001_002, "sum");
    var aggTotalPop = core.aggregateWithinUnion(unionGeom, geos, b01003_001, "sum");

    // 4. Compute shares
    var totalPopB03 = aggTotal.value || 0;
    var nhWhite     = aggNhWhite.value || 0;
    var minorityPop = Math.max(0, totalPopB03 - nhWhite);
    var minorityShare = totalPopB03 > 0 ? minorityPop / totalPopB03 : 0;

    var totalPop     = aggTotalPop.value || 0;
    var lowIncomePop = aggPoverty.value || 0;
    var lowIncomeShare = totalPop > 0 ? lowIncomePop / totalPop : 0;

    return {
      totalPop: Math.round(totalPop),
      minorityPop: Math.round(minorityPop),
      minorityShare: minorityShare,
      lowIncomePop: Math.round(lowIncomePop),
      lowIncomeShare: lowIncomeShare,
      geoCount: geos.length,
      geos: geos
    };
  };

  // =========================================================================
  // Finding evaluation (pure)
  // =========================================================================

  TitleVI.evaluateFindings = function (impactedDemographics, baseline, policy) {
    var impMinority  = impactedDemographics.minorityShare || 0;
    var baseMinority = baseline.minorityShare || 0;
    var diThreshold  = policy.disparateImpactThresholdPpt || 15;

    var impLowIncome  = impactedDemographics.lowIncomeShare || 0;
    var baseLowIncome = baseline.lowIncomeShare || 0;
    var dbThreshold   = policy.disproportionateBurdenThresholdPpt || 15;

    var minDiffPpt = (impMinority - baseMinority) * 100;
    var liDiffPpt  = (impLowIncome - baseLowIncome) * 100;

    return {
      minority: {
        impactedShare: impMinority,
        baselineShare: baseMinority,
        diffPpt: Math.round(minDiffPpt * 10) / 10,
        thresholdPpt: diThreshold,
        exceedsThreshold: minDiffPpt >= diThreshold,
        finding: minDiffPpt >= diThreshold
          ? "Potential Disparate Impact"
          : "No Disparate Impact"
      },
      lowIncome: {
        impactedShare: impLowIncome,
        baselineShare: baseLowIncome,
        diffPpt: Math.round(liDiffPpt * 10) / 10,
        thresholdPpt: dbThreshold,
        exceedsThreshold: liDiffPpt >= dbThreshold,
        finding: liDiffPpt >= dbThreshold
          ? "Potential Disproportionate Burden"
          : "No Disproportionate Burden"
      }
    };
  };

  // =========================================================================
  // Scenario comparison (pure)
  // =========================================================================

  TitleVI.compareScenarios = function (scenarioResults) {
    return scenarioResults.map(function (sr) {
      var mc = sr.majorChangeResult || {};
      var dem = sr.demographics || {};
      var f = sr.findings || {};
      return {
        scenarioId: sr.scenarioId,
        scenarioName: sr.scenarioName,
        majorChangeTriggered: mc.triggered || false,
        triggeredRuleCount: (mc.ruleResults || []).filter(function (r) { return r.triggered; }).length,
        routesAffected: (sr.scenario && sr.scenario.affectedRoutes) ? sr.scenario.affectedRoutes.length : 0,
        totalPop: dem.totalPop || 0,
        minorityShare: dem.minorityShare || 0,
        lowIncomeShare: dem.lowIncomeShare || 0,
        minorityFinding: f.minority ? f.minority.finding : "N/A",
        minorityDiffPpt: f.minority ? f.minority.diffPpt : 0,
        minorityExceeds: f.minority ? f.minority.exceedsThreshold : false,
        lowIncomeFinding: f.lowIncome ? f.lowIncome.finding : "N/A",
        lowIncomeDiffPpt: f.lowIncome ? f.lowIncome.diffPpt : 0,
        lowIncomeExceeds: f.lowIncome ? f.lowIncome.exceedsThreshold : false
      };
    });
  };

})();
