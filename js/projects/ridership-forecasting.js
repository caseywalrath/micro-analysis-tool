// js/projects/ridership-forecasting.js
// Ridership Forecasting module: registers as an analysis module,
// opens in a popup with 4-tab layout (Demand, Calibrate, Elasticity, Scenarios).
// Depends on: App namespace, RidershipModel (ridership-scoring.js), TPI (tpi-scoring.js),
//             App.popup (popup.js), turf (CDN).
// Exports: none (self-registers via App.registerModule)

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var RM = window.RidershipModel;
  var TPI = window.TPI;

  // ---- Module-local state ----

  var _lastResult = null;       // last computeCorridorDemand result
  var _weights = TPI.getDefaultWeights();
  var _stale = false;
  var _running = false;
  var _initialized = false;
  var _apportionByArea = false;
  var _normalizeByLength = false;
  var _calibration = null;      // { factor, n, rSquared, ... }
  var _calibData = null;        // parsed CSV rows
  var _scenarios = [{}, {}, {}, {}]; // 4 scenario parameter sets
  var _activeScenario = 0;
  var _activeTab = "calibrate";

  // System-wide calibration state
  var _systemResult = null;      // result from RM.computeSystemDemand()
  var _perRouteCDI = null;       // array from RM.computePerRouteCDI()
  var _matchResult = null;       // result from RM.matchRoutesToCSV()
  var _selectedCorridor = "all"; // "all" or "route:N" / "line:N"

  // Default scenario names
  var SCENARIO_NAMES = ["Scenario A", "Scenario B", "Scenario C", "Scenario D"];
  for (var si = 0; si < 4; si++) {
    _scenarios[si] = {
      name: SCENARIO_NAMES[si],
      serviceTypeId: "local_bus",
      headway: 30,
      span: 14,
      avgSpeed: 15,
      costPerRevenueHour: 150,
      serviceDaysPerYear: 260
    };
  }

  // ---- DOM guard ----

  function isPopupVisible() {
    return App.popup.isOpen() && App.popup.currentModuleId() === "ridership-forecasting";
  }

  // ---- Weight modal (Adjust Weights) ----

  var _pendingWeights = null; // temporary weight copy while modal is open

  function buildRFWeightSliders(weights) {
    var container = document.getElementById("rfWeightSliders");
    if (!container) return;
    container.innerHTML = "";

    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = weights[f.id] != null ? weights[f.id] : f.defaultWeight;

      var row = document.createElement("div");
      row.className = "tpi-slider-row";
      row.innerHTML =
        '<label class="tpi-slider-label" title="' + f.description + '">' + f.label + '</label>' +
        '<input type="range" class="tpi-slider rf-w-slider" min="0" max="100" step="5" value="' + w + '" data-factor="' + f.id + '" />' +
        '<input type="number" class="tpi-slider-value" id="rfW_' + f.id + '" value="' + w + '" min="0" max="100" step="1" data-factor="' + f.id + '" />';
      container.appendChild(row);

      var slider = row.querySelector("input[type=range]");
      slider.addEventListener("input", onRFSliderChange);
      var numInput = row.querySelector("input[type=number]");
      numInput.addEventListener("change", onRFNumberChange);
    }

    updateRFWeightSum();
  }

  function onRFSliderChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    _pendingWeights[factorId] = parseInt(e.target.value, 10);
    var numInput = document.getElementById("rfW_" + factorId);
    if (numInput) numInput.value = String(_pendingWeights[factorId]);
    updateRFWeightSum();
  }

  function onRFNumberChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    var raw = parseInt(e.target.value, 10);
    var clamped = isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
    e.target.value = String(clamped);
    _pendingWeights[factorId] = clamped;
    var slider = document.querySelector('.rf-w-slider[data-factor="' + factorId + '"]');
    if (slider) slider.value = String(clamped);
    updateRFWeightSum();
  }

  function updateRFWeightSum() {
    if (!_pendingWeights) return;
    var sum = 0;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      sum += (_pendingWeights[factors[i].id] || 0);
    }
    var sumEl  = document.getElementById("rfWeightSum");
    var warnEl = document.getElementById("rfWeightWarn");
    var confirmBtn = document.getElementById("rfWeightsConfirm");
    if (sumEl) {
      sumEl.textContent = String(sum);
      sumEl.style.color = (sum === 100) ? "" : "#e53e3e";
    }
    var valid = (sum === 100);
    if (warnEl) warnEl.style.visibility = valid ? "hidden" : "visible";
    if (confirmBtn) confirmBtn.disabled = !valid;
    return sum;
  }

  function applyWeightsToModalSliders(weights) {
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = weights[f.id] != null ? weights[f.id] : f.defaultWeight;
      _pendingWeights[f.id] = w;
      var slider = document.querySelector('.rf-w-slider[data-factor="' + f.id + '"]');
      if (slider) slider.value = String(w);
      var numInput = document.getElementById("rfW_" + f.id);
      if (numInput) numInput.value = String(w);
    }
    updateRFWeightSum();
  }

  function openWeightsModal() {
    _pendingWeights = Object.assign({}, _weights);
    var modal = document.getElementById("rfWeightsModal");
    if (!modal) return;
    // Build sliders if not yet built (first open)
    var container = document.getElementById("rfWeightSliders");
    if (!container || container.innerHTML === "") {
      buildRFWeightSliders(_pendingWeights);
    } else {
      // Sync existing sliders to current _weights
      applyWeightsToModalSliders(_pendingWeights);
    }
    modal.style.display = "";
  }

  function closeWeightsModal() {
    var modal = document.getElementById("rfWeightsModal");
    if (modal) modal.style.display = "none";
    _pendingWeights = null;
  }

  // ---- Tab management ----

  function switchTab(tabId) {
    _activeTab = tabId;
    if (!isPopupVisible()) return;

    var tabs = document.querySelectorAll(".rf-tab");
    var contents = document.querySelectorAll(".rf-tab-content");

    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (t.getAttribute("data-tab") === tabId) {
        t.classList.add("rf-tab-active");
      } else {
        t.classList.remove("rf-tab-active");
      }
    }
    for (var j = 0; j < contents.length; j++) {
      var c = contents[j];
      if (c.getAttribute("data-tab") === tabId) {
        c.classList.add("rf-tab-visible");
      } else {
        c.classList.remove("rf-tab-visible");
      }
    }

    // Refresh active tab content
    if (tabId === "elasticity") refreshElasticity();
  }

  // ---- Layer 1: Demand ----

  async function runDemand() {
    if (_running) return;
    _running = true;

    var statusEl = document.getElementById("rfDemandStatus");
    var textEl = document.getElementById("rfDemandStatusText");
    var runBtn = document.getElementById("rfRunDemand");
    if (runBtn) runBtn.disabled = true;
    if (statusEl) { statusEl.style.display = ""; statusEl.className = "rf-status"; }

    // Show/hide uncalibrated warning
    var uncalibWarn = document.getElementById("rfUncalibratedWarning");
    if (uncalibWarn) uncalibWarn.style.display = _systemResult ? "none" : "";

    try {
      var geoLevel = document.getElementById("rfGeoLevel").value;
      var year = document.getElementById("rfYearSelect").value;
      var segLen = parseFloat(document.getElementById("rfSegmentLength").value) || 0;

      var result;

      if (_systemResult && _systemResult.tpiResult) {
        // Calibrated mode: reuse system TPI, compute corridor CDI and segments
        if (textEl) textEl.textContent = "Using system analysis data...";
        App.setStatus("Computing corridor demand from system data...");

        var tpiResult = _systemResult.tpiResult;

        // Determine CDI to display
        var displayCDI;
        if (_selectedCorridor !== "all" && _perRouteCDI) {
          // Use the per-route CDI for the selected corridor
          var parts = _selectedCorridor.split(":");
          var selType = parts[0];
          var selIdx = parseInt(parts[1], 10);
          for (var pi = 0; pi < _perRouteCDI.length; pi++) {
            if (_perRouteCDI[pi].featureType === selType && _perRouteCDI[pi].featureIndex === selIdx) {
              displayCDI = { value: _perRouteCDI[pi].cdi, scored: _perRouteCDI[pi].geoCount, total: tpiResult.geoids.length };
              break;
            }
          }
        }
        if (!displayCDI) {
          displayCDI = _systemResult.systemCDI;
        }

        // Compute segments using cached TPI data — no Census API calls.
        // Scoped to the selected corridor if one is chosen; all features otherwise.
        var segments = [];
        if (segLen > 0 && RM.computeSegments) {
          if (textEl) textEl.textContent = "Computing segments...";
          App.setStatus("Computing segments...");
          segments = RM.computeSegments(tpiResult, segLen, _selectedCorridor);
        }

        result = {
          tpiResult: tpiResult,
          corridorCDI: displayCDI,
          segments: segments,
          classification: RM.classifyCDI(displayCDI),
          geoLevel: geoLevel,
          year: year
        };
      } else {
        // Uncalibrated mode: run fresh TPI (current behavior)
        result = await RM.computeCorridorDemand({
          geoLevel: geoLevel,
          year: year,
          weights: _weights,
          lodesData: App.lodesData,
          apportionByArea: _apportionByArea,
          segmentMiles: segLen,
          onProgress: function (msg) {
            if (textEl) textEl.textContent = msg;
            App.setStatus(msg);
          }
        });
      }

      _lastResult = result;
      _stale = false;

      // Render choropleth
      var tpi = result.tpiResult;
      App.renderCensusOverlay(tpi.apportionByArea && tpi.clippedGeos ? tpi.clippedGeos : tpi.geos);
      renderChoropleth(result);

      // Show legend
      App.popup.showFloatingWidget("rf-legend", "projects/ridership-legend.html", {
        position: "bottom-left",
        width: 170,
        title: "Demand Legend"
      });

      // Render segment overlays
      if (result.segments.length > 0) {
        renderSegments(result.segments);
      }

      displayDemandResults(result);

      if (textEl) textEl.textContent = "Demand analysis complete.";
      if (statusEl) statusEl.className = "rf-status rf-status-done";
      App.setStatus("Demand analysis complete");

      // Enable exports
      var expGJ = document.getElementById("rfExportDemandGeoJSON");
      var expCSV = document.getElementById("rfExportDemandCSV");
      if (expGJ) expGJ.disabled = false;
      if (expCSV) expCSV.disabled = false;

      // Show next step guidance
      var nextStep = document.getElementById("rfNextStep1");
      if (nextStep) nextStep.style.display = "";

    } catch (err) {
      console.error("Ridership demand error:", err);
      if (textEl) textEl.textContent = "Error: " + (err.message || err);
      if (statusEl) statusEl.className = "rf-status rf-status-error";
      App.setStatus("Demand analysis error");
    } finally {
      _running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  function displayDemandResults(result) {
    if (!isPopupVisible()) return;
    var el = document.getElementById("rfDemandResults");
    if (el) el.style.display = "";

    // CDI score
    var cdiVal = document.getElementById("rfCDIValue");
    if (cdiVal) cdiVal.textContent = Number.isFinite(result.corridorCDI.value)
      ? result.corridorCDI.value.toFixed(2) : "\u2014";

    // Classification badge
    var cdiBadge = document.getElementById("rfCDIClass");
    if (cdiBadge) {
      cdiBadge.textContent = result.classification.label;
      cdiBadge.className = "rf-cdi-badge rf-cdi-" + result.classification.label.toLowerCase().replace(/[^a-z]/g, "");
    }

    // Stats
    var geoCount = document.getElementById("rfGeoCount");
    if (geoCount) geoCount.textContent = String(result.tpiResult.geoids.length);

    var scoredCount = document.getElementById("rfScoredCount");
    if (scoredCount) scoredCount.textContent = result.corridorCDI.scored + " / " + result.corridorCDI.total;

    var routeLen = document.getElementById("rfRouteLength");
    if (routeLen) {
      var len = RM.getRouteLength();
      routeLen.textContent = len > 0 ? len.toFixed(2) + " mi" : "\u2014";
    }

    var segCount = document.getElementById("rfSegmentCount");
    if (segCount) segCount.textContent = result.segments.length > 0 ? String(result.segments.length) : "\u2014";

    // Segment breakdown
    var segSection = document.getElementById("rfSegmentBreakdown");
    var segList = document.getElementById("rfSegmentList");
    if (result.segments.length > 0 && segSection && segList) {
      segSection.style.display = "";
      var html = "";
      for (var i = 0; i < result.segments.length; i++) {
        var seg = result.segments[i];
        var cdi = Number.isFinite(seg.cdi) ? seg.cdi.toFixed(2) : "N/A";
        html += '<div class="rf-segment-row">' +
          '<span class="rf-segment-label">Seg ' + (i + 1) + '</span>' +
          '<span class="rf-segment-cdi">' + cdi + '</span>' +
          '<span class="rf-segment-class rf-cdi-' + seg.classification.toLowerCase().replace(/[^a-z]/g, "") + '">' + seg.classification + '</span>' +
          '<span class="rf-segment-geos tiny">' + seg.geoCount + ' geos</span>' +
          '</div>';
      }
      segList.innerHTML = html;
    } else if (segSection) {
      segSection.style.display = "none";
    }

    // Factor summary
    displayFactorSummary(result.tpiResult);
  }

  function displayFactorSummary(tpiResult) {
    var summaryEl = document.getElementById("rfFactorSummary");
    if (!summaryEl) return;

    var factors = TPI.FACTORS;
    var html = "";
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = tpiResult.effectiveWeights[f.id] || 0;
      var scoreMap = tpiResult.factorScores.get(f.id);
      var avgScore = NaN;
      if (scoreMap && scoreMap.size > 0) {
        var sum = 0; var cnt = 0;
        for (var entry of scoreMap.values()) { sum += entry; cnt++; }
        avgScore = cnt > 0 ? sum / cnt : NaN;
      }
      var statusClass = scoreMap && scoreMap.size > 0 ? "tpi-factor-ok" : "tpi-factor-na";
      var statusLabel = scoreMap && scoreMap.size > 0 ? "avg " + avgScore.toFixed(1) + " / 5" : "No Data";

      html += '<div class="tpi-factor-row">' +
        '<span class="tpi-factor-name">' + f.label + '</span>' +
        '<span class="tpi-factor-weight">' + Math.round(w) + '%</span>' +
        '<span class="tpi-factor-score ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>';
    }
    summaryEl.innerHTML = html;
  }

  // ---- Choropleth rendering ----

  var RF_SOURCE = "rf-choropleth";
  var RF_FILL_LAYER = "rf-choropleth-fill";
  var RF_LINE_LAYER = "rf-choropleth-line";
  var RF_SEG_SOURCE = "rf-segments";
  var RF_SEG_FILL_LAYER = "rf-segments-fill";
  var RF_SEG_LINE_LAYER = "rf-segments-line";

  function renderChoropleth(result) {
    var map = App.map;
    if (!map || !result || !result.tpiResult) return;
    var tpi = result.tpiResult;

    var useClipped = tpi.apportionByArea && tpi.clippedGeos;
    var clippedLookup = null;
    if (useClipped) {
      clippedLookup = {};
      for (var ci = 0; ci < tpi.clippedGeos.length; ci++) {
        var cg = tpi.clippedGeos[ci];
        if (cg.properties && cg.properties.GEOID) clippedLookup[cg.properties.GEOID] = cg.geometry;
      }
    }

    var features = [];
    for (var i = 0; i < tpi.geos.length; i++) {
      var geo = tpi.geos[i];
      var geoid = geo.properties && geo.properties.GEOID;
      var scoreData = geoid ? tpi.scores.get(geoid) : null;
      var composite = (scoreData && Number.isFinite(scoreData.composite)) ? scoreData.composite : null;
      var geom = (clippedLookup && geoid && clippedLookup[geoid]) ? clippedLookup[geoid] : geo.geometry;

      features.push({
        type: "Feature",
        properties: { GEOID: geoid, cdiScore: composite },
        geometry: geom
      });
    }

    var fc = { type: "FeatureCollection", features: features };

    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "cdiScore"], 0],
      0, "rgba(200,200,200,0.3)",
      1, "#eff3ff",
      2, "#bdd7e7",
      3, "#6baed6",
      4, "#3182bd",
      5, "#08519c"
    ];

    if (!map.getSource(RF_SOURCE)) {
      map.addSource(RF_SOURCE, { type: "geojson", data: fc });
      var beforeLayer = map.getLayer("buffers-fill") ? "buffers-fill" : undefined;

      map.addLayer({
        id: RF_FILL_LAYER, type: "fill", source: RF_SOURCE,
        paint: { "fill-color": colorExpr, "fill-opacity": 0.55 }
      }, beforeLayer);

      map.addLayer({
        id: RF_LINE_LAYER, type: "line", source: RF_SOURCE,
        paint: { "line-color": "#333", "line-width": 0.5, "line-opacity": 0.4 }
      }, beforeLayer);

      // Hover tooltip
      var popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", RF_FILL_LAYER, function (e) {
        map.getCanvas().style.cursor = "pointer";
        if (e.features && e.features.length > 0) {
          var props = e.features[0].properties;
          var html = '<div style="font-size:12px;line-height:1.4;">' +
            '<b>GEOID:</b> ' + (props.GEOID || "\u2014") + '<br>' +
            '<b>CDI Score:</b> ' + (props.cdiScore != null ? Number(props.cdiScore).toFixed(2) : "N/A") + ' / 5' +
            '</div>';
          popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        }
      });
      map.on("mouseleave", RF_FILL_LAYER, function () {
        map.getCanvas().style.cursor = App.drawMode ? "crosshair" : "grab";
        popup.remove();
      });
    } else {
      map.getSource(RF_SOURCE).setData(fc);
    }
  }

  function renderSegments(segments) {
    var map = App.map;
    if (!map || segments.length === 0) return;

    var features = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      features.push({
        type: "Feature",
        properties: {
          segmentIndex: i,
          cdi: seg.cdi,
          classification: seg.classification
        },
        geometry: seg.bufferGeometry
      });
    }

    var fc = { type: "FeatureCollection", features: features };

    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "cdi"], 0],
      0, "rgba(255,200,200,0.2)",
      2, "rgba(255,200,100,0.3)",
      3, "rgba(100,200,100,0.3)",
      5, "rgba(50,100,200,0.3)"
    ];

    if (map.getSource(RF_SEG_SOURCE)) {
      map.getSource(RF_SEG_SOURCE).setData(fc);
    } else {
      map.addSource(RF_SEG_SOURCE, { type: "geojson", data: fc });
      map.addLayer({
        id: RF_SEG_LINE_LAYER, type: "line", source: RF_SEG_SOURCE,
        paint: { "line-color": "#e65100", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [4, 2] }
      });
    }
  }

  function removeChoropleth() {
    var map = App.map;
    if (!map) return;
    if (map.getLayer(RF_FILL_LAYER)) map.removeLayer(RF_FILL_LAYER);
    if (map.getLayer(RF_LINE_LAYER)) map.removeLayer(RF_LINE_LAYER);
    if (map.getSource(RF_SOURCE)) map.removeSource(RF_SOURCE);
    if (map.getLayer(RF_SEG_FILL_LAYER)) map.removeLayer(RF_SEG_FILL_LAYER);
    if (map.getLayer(RF_SEG_LINE_LAYER)) map.removeLayer(RF_SEG_LINE_LAYER);
    if (map.getSource(RF_SEG_SOURCE)) map.removeSource(RF_SEG_SOURCE);
  }

  function clearAll() {
    removeChoropleth();
    _lastResult = null;
    _stale = false;
    _calibration = null;
    _calibData = null;
    _systemResult = null;
    _perRouteCDI = null;
    _matchResult = null;
    _selectedCorridor = "all";
    App.popup.hideFloatingWidget("rf-legend");
    if (isPopupVisible()) {
      var el = document.getElementById("rfDemandResults");
      if (el) el.style.display = "none";
      var statusEl = document.getElementById("rfDemandStatus");
      if (statusEl) statusEl.style.display = "none";
      var sysEl = document.getElementById("rfSystemResults");
      if (sysEl) sysEl.style.display = "none";
      var sysStatusEl = document.getElementById("rfSystemStatus");
      if (sysStatusEl) sysStatusEl.style.display = "none";
      // Reset calibrate step gates
      var step2 = document.getElementById("rfCalibStep2");
      if (step2) { step2.style.opacity = "0.5"; step2.style.pointerEvents = "none"; }
      var step3 = document.getElementById("rfCalibStep3");
      if (step3) { step3.style.opacity = "0.5"; step3.style.pointerEvents = "none"; }
    }
    App.setStatus("Ridership analysis cleared");
  }

  // ---- Calibration helpers ----

  // Get the CDI value for the currently selected corridor
  function getActiveCDI() {
    // If a specific corridor is selected and we have per-route data, use its CDI
    if (_selectedCorridor !== "all" && _perRouteCDI) {
      var parts = _selectedCorridor.split(":");
      var type = parts[0];
      var idx = parseInt(parts[1], 10);
      for (var i = 0; i < _perRouteCDI.length; i++) {
        if (_perRouteCDI[i].featureType === type && _perRouteCDI[i].featureIndex === idx) {
          return _perRouteCDI[i].cdi;
        }
      }
    }
    // Fall back to system CDI from calibration, then to corridor CDI from demand
    if (_systemResult && _systemResult.systemCDI) return _systemResult.systemCDI.value;
    if (_lastResult && _lastResult.corridorCDI) return _lastResult.corridorCDI.value;
    return NaN;
  }

  function getTargetCorridorLength() {
    // Return length in miles for the currently selected corridor.
    if (_selectedCorridor !== "all" && _perRouteCDI) {
      var parts = _selectedCorridor.split(":");
      var type = parts[0];
      var idx = parseInt(parts[1], 10);
      for (var i = 0; i < _perRouteCDI.length; i++) {
        var r = _perRouteCDI[i];
        if (r.featureType === type && r.featureIndex === idx) {
          return (Number.isFinite(r.lengthMiles) && r.lengthMiles > 0) ? r.lengthMiles : 1;
        }
      }
    }
    // "all" or no match: total length of all drawn routes
    var total = RM.getRouteLength();
    return (Number.isFinite(total) && total > 0) ? total : 1;
  }

  function populateCorridorDropdown() {
    var sel = document.getElementById("rfCorridorSelect");
    if (!sel) return;
    sel.innerHTML = '<option value="all">All corridors (system-wide)</option>';
    if (!_perRouteCDI) return;
    for (var i = 0; i < _perRouteCDI.length; i++) {
      var pr = _perRouteCDI[i];
      var opt = document.createElement("option");
      opt.value = pr.featureType + ":" + pr.featureIndex;
      opt.textContent = pr.name + " (CDI: " + (Number.isFinite(pr.cdi) ? pr.cdi.toFixed(2) : "N/A") + ")";
      sel.appendChild(opt);
    }
  }

  // ---- Layer 2: Calibration (system analysis + CSV matching) ----

  async function runSystemAnalysis() {
    if (_running) return;
    _running = true;

    var statusEl = document.getElementById("rfSystemStatus");
    var textEl = document.getElementById("rfSystemStatusText");
    var runBtn = document.getElementById("rfRunSystemAnalysis");
    if (runBtn) runBtn.disabled = true;
    if (statusEl) { statusEl.style.display = ""; statusEl.className = "rf-status"; }

    try {
      var geoLevel = document.getElementById("rfCalibGeoLevel").value;
      var year = document.getElementById("rfCalibYearSelect").value;
      var apportionCb = document.getElementById("rfCalibApportionByArea");
      var apportion = apportionCb ? apportionCb.checked : false;
      _apportionByArea = apportion;

      var result = await RM.computeSystemDemand({
        geoLevel: geoLevel,
        year: year,
        weights: _weights,
        lodesData: App.lodesData,
        apportionByArea: apportion,
        onProgress: function (msg) {
          if (textEl) textEl.textContent = msg;
          App.setStatus(msg);
        }
      });

      _systemResult = result;
      _perRouteCDI = result.routeCDIs;
      _stale = false;

      // Render choropleth
      var tpi = result.tpiResult;
      App.renderCensusOverlay(tpi.apportionByArea && tpi.clippedGeos ? tpi.clippedGeos : tpi.geos);
      renderChoropleth({ tpiResult: tpi, corridorCDI: result.systemCDI });

      // Show legend
      App.popup.showFloatingWidget("rf-legend", "projects/ridership-legend.html", {
        position: "bottom-left",
        width: 170,
        title: "Demand Legend"
      });

      // Display per-route CDI results
      displaySystemResults(result);

      // Populate the Demand tab corridor dropdown
      populateCorridorDropdown();

      // Enable Step 2
      var step2 = document.getElementById("rfCalibStep2");
      if (step2) { step2.style.opacity = "1"; step2.style.pointerEvents = "auto"; }

      if (textEl) textEl.textContent = "System analysis complete.";
      if (statusEl) statusEl.className = "rf-status rf-status-done";
      App.setStatus("System analysis complete");

    } catch (err) {
      console.error("System analysis error:", err);
      if (textEl) textEl.textContent = "Error: " + (err.message || err);
      if (statusEl) statusEl.className = "rf-status rf-status-error";
      App.setStatus("System analysis error");
    } finally {
      _running = false;
      if (runBtn) runBtn.disabled = false;
    }
  }

  // ---- CDI transparency helpers ----

  // Compute system-wide average quintile score per factor (baseline for comparison bars)
  function computeSystemFactorAverages(tpiResult) {
    var avgs = {};
    if (!tpiResult || !tpiResult.factorScores) return avgs;
    var fsIter = tpiResult.factorScores.entries();
    var fsEntry = fsIter.next();
    while (!fsEntry.done) {
      var factorId = fsEntry.value[0];
      var scoreMap = fsEntry.value[1];
      var sum = 0, count = 0;
      var valIter = scoreMap.values();
      var v = valIter.next();
      while (!v.done) {
        if (Number.isFinite(v.value)) { sum += v.value; count++; }
        v = valIter.next();
      }
      avgs[factorId] = count > 0 ? sum / count : NaN;
      fsEntry = fsIter.next();
    }
    return avgs;
  }

  // Build HTML for per-factor breakdown bars for one route
  function buildRouteFactorBreakdownHTML(routeCDI, systemAvgs, effectiveWeights) {
    var factors = TPI.FACTORS;
    var breakdown = routeCDI.factorBreakdown || {};
    var html = '<div class="rf-route-factor-list">';

    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (effectiveWeights && effectiveWeights[f.id] != null) ? effectiveWeights[f.id] : 0;
      if (w === 0) continue; // Skip inactive factors

      var routeAvg = breakdown[f.id];
      var sysAvg = systemAvgs[f.id];
      var routeValid = Number.isFinite(routeAvg);
      var sysValid = Number.isFinite(sysAvg);

      // Bar widths: scale 1-5 to 0-100%
      var routeBarPct = routeValid ? ((routeAvg - 1) / 4) * 100 : 0;
      var sysMarkerPct = sysValid ? ((sysAvg - 1) / 4) * 100 : 0;

      // Color: green if route > system, red if route < system, neutral if close
      var diff = (routeValid && sysValid) ? routeAvg - sysAvg : 0;
      var barColor = diff > 0.3 ? "#48bb78" : (diff < -0.3 ? "#f56565" : "#a0aec0");

      html += '<div class="rf-route-factor-row">' +
        '<span class="rf-route-factor-name" title="' + (f.description || f.label) + '">' + f.label + '</span>' +
        '<span class="rf-route-factor-weight tiny">' + Math.round(w) + '%</span>' +
        '<span class="rf-route-factor-bar-wrap">' +
          '<span class="rf-route-factor-bar" style="width:' + routeBarPct.toFixed(0) + '%;background:' + barColor + ';" ' +
            'title="Route: ' + (routeValid ? routeAvg.toFixed(1) : 'N/A') + ' / System: ' + (sysValid ? sysAvg.toFixed(1) : 'N/A') + '"></span>' +
          (sysValid ? '<span class="rf-route-factor-sys-marker" style="left:' + sysMarkerPct.toFixed(0) + '%;" title="System avg: ' + sysAvg.toFixed(1) + '"></span>' : '') +
        '</span>' +
        '<span class="rf-route-factor-score">' + (routeValid ? routeAvg.toFixed(1) : 'N/A') + '</span>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  // Toggle expand/collapse of a route detail panel
  function toggleRouteDetail(e) {
    var row = e.currentTarget;
    var detailId = row.getAttribute("data-route-detail");
    var detail = document.getElementById(detailId);
    if (!detail) return;

    var expand = row.querySelector(".rf-route-score-expand");
    if (detail.style.display === "none") {
      detail.style.display = "";
      if (expand) expand.innerHTML = "&#9662;"; // down triangle
    } else {
      detail.style.display = "none";
      if (expand) expand.innerHTML = "&#9656;"; // right triangle
    }
  }

  function displaySystemResults(result) {
    if (!isPopupVisible()) return;
    var el = document.getElementById("rfSystemResults");
    if (el) el.style.display = "";

    // System CDI
    var sysEl = document.getElementById("rfSystemCDI");
    if (sysEl) sysEl.textContent = Number.isFinite(result.systemCDI.value)
      ? result.systemCDI.value.toFixed(2) : "\u2014";

    // Feature count
    var countEl = document.getElementById("rfSystemFeatureCount");
    if (countEl) countEl.textContent = String(result.routeCDIs.length);

    // Compute system-wide factor averages (baseline for comparison bars)
    var systemFactorAvgs = computeSystemFactorAverages(result.tpiResult);

    // Per-route score list with expandable factor details
    var listEl = document.getElementById("rfRouteScoreList");
    if (listEl && result.routeCDIs.length > 0) {
      var html = "";
      for (var i = 0; i < result.routeCDIs.length; i++) {
        var r = result.routeCDIs[i];
        var cdi = Number.isFinite(r.cdi) ? r.cdi.toFixed(2) : "N/A";
        var typeLabel = r.featureType === "route" ? "Route" : "Line";

        // Score range text (min - max composite among overlapping geos)
        var rangeText = "";
        if (r.compositeRange && Number.isFinite(r.compositeRange.min) && Number.isFinite(r.compositeRange.max)) {
          if (r.compositeRange.max - r.compositeRange.min < 0.1) {
            rangeText = "(~" + r.compositeRange.min.toFixed(1) + " uniform)";
          } else {
            rangeText = "(" + r.compositeRange.min.toFixed(1) + " \u2013 " + r.compositeRange.max.toFixed(1) + ")";
          }
        }

        html += '<div class="rf-route-score-item">' +
          '<div class="rf-route-score-row" data-route-detail="rfRouteDetail_' + i + '">' +
          '<span class="rf-route-score-expand">&#9656;</span>' +
          '<span class="rf-route-score-name">' + typeLabel + ': ' + r.name + '</span>' +
          '<span class="rf-route-score-cdi">' + cdi + '</span>' +
          (rangeText ? '<span class="rf-route-score-range tiny">' + rangeText + '</span>' : '') +
          '<span class="rf-cdi-badge rf-cdi-' + r.classification.toLowerCase().replace(/[^a-z]/g, "") + '">' + r.classification + '</span>' +
          '<span class="rf-route-score-geos tiny">' + r.geoCount + ' geos</span>' +
          '</div>';

        // Expandable factor breakdown detail panel
        html += '<div class="rf-route-score-detail" id="rfRouteDetail_' + i + '" style="display:none;">';
        html += buildRouteFactorBreakdownHTML(r, systemFactorAvgs, result.tpiResult.effectiveWeights);
        html += '</div></div>';
      }
      listEl.innerHTML = html;

      // Wire click-to-expand on each row
      var rows = listEl.querySelectorAll(".rf-route-score-row[data-route-detail]");
      for (var ri = 0; ri < rows.length; ri++) {
        rows[ri].addEventListener("click", toggleRouteDetail);
      }
    }
  }

  function handleCalibUpload(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var result = Papa.parse(e.target.result, { header: true, skipEmptyLines: true });
      if (!result.data || result.data.length === 0) {
        alert("No data found in CSV.");
        return;
      }
      _calibData = result;
      var nameEl = document.getElementById("rfCalibFileName");
      if (nameEl) nameEl.textContent = file.name + " (" + result.data.length + " rows)";

      // Show column mapping
      var mappingEl = document.getElementById("rfCalibMapping");
      if (mappingEl) mappingEl.style.display = "";

      // Fill column dropdowns
      var headers = result.meta.fields || [];
      var cols = ["rfCalibColName", "rfCalibColRidership", "rfCalibColHeadway", "rfCalibColServiceType"];
      var guesses = [
        ["route", "name", "corridor"],
        ["ridership", "boardings", "riders", "daily"],
        ["headway", "frequency", "freq", "minutes"],
        ["service", "type", "mode"]
      ];

      for (var i = 0; i < cols.length; i++) {
        var sel = document.getElementById(cols[i]);
        if (!sel) continue;
        sel.innerHTML = '<option value="">-- Select --</option>';
        for (var h = 0; h < headers.length; h++) {
          var opt = document.createElement("option");
          opt.value = headers[h];
          opt.textContent = headers[h];
          sel.appendChild(opt);
        }
        // Auto-guess
        var guess = App.guessHeader(headers, guesses[i]);
        if (guess) sel.value = guess;
      }
    };
    reader.readAsText(file);
  }

  function runMatchRoutes() {
    if (!_calibData || !_perRouteCDI) return;

    var colName = document.getElementById("rfCalibColName").value;
    if (!colName) { alert("Please select the Route Name column."); return; }

    _matchResult = RM.matchRoutesToCSV(_perRouteCDI, _calibData.data, colName);

    // Display match results
    var listEl = document.getElementById("rfMatchList");
    var resultsEl = document.getElementById("rfMatchResults");
    if (resultsEl) resultsEl.style.display = "";

    if (listEl) {
      var html = "";
      // Matched rows
      for (var m = 0; m < _matchResult.matched.length; m++) {
        var match = _matchResult.matched[m];
        var csvName = match.csvRow[colName] || "";
        var cdi = Number.isFinite(match.routeCDI.cdi) ? match.routeCDI.cdi.toFixed(2) : "N/A";
        html += '<div class="rf-match-row rf-match-ok">' +
          '<span class="rf-match-icon">&#10003;</span>' +
          '<span class="rf-match-csv-name">' + csvName + '</span>' +
          '<span class="rf-match-arrow">&rarr;</span>' +
          '<span class="rf-match-feature">' + match.routeCDI.name + '</span>' +
          '<span class="rf-match-cdi">CDI: ' + cdi + '</span>' +
          '</div>';
      }
      // Unmatched rows
      for (var u = 0; u < _matchResult.unmatched.length; u++) {
        var unm = _matchResult.unmatched[u];
        var uName = unm.csvRow[colName] || "(empty)";
        html += '<div class="rf-match-row rf-match-fail">' +
          '<span class="rf-match-icon">&#10007;</span>' +
          '<span class="rf-match-csv-name">' + uName + '</span>' +
          '<span class="rf-match-reason tiny">' + unm.reason + '</span>' +
          '</div>';
      }
      listEl.innerHTML = html;
    }

    // Show warnings
    var warnEl = document.getElementById("rfMatchWarnings");
    if (warnEl) {
      var warnings = [];
      if (_matchResult.duplicateWarnings.length > 0) {
        warnings = warnings.concat(_matchResult.duplicateWarnings);
      }
      if (_matchResult.matched.length < 3) {
        warnings.push("Only " + _matchResult.matched.length + " route(s) matched. Recommend 3+ for reliable calibration.");
      }
      if (warnings.length > 0) {
        warnEl.style.display = "";
        warnEl.textContent = warnings.join(" ");
      } else {
        warnEl.style.display = "none";
      }
    }

    // Enable Step 3 if we have at least 2 matches
    var step3 = document.getElementById("rfCalibStep3");
    if (step3 && _matchResult.matched.length >= 2) {
      step3.style.opacity = "1";
      step3.style.pointerEvents = "auto";
    }
  }

  function runCalibration() {
    if (!_matchResult || _matchResult.matched.length < 2) {
      alert("Need at least 2 matched routes to calibrate.");
      return;
    }

    var colRidership = document.getElementById("rfCalibColRidership").value;
    if (!colRidership) { alert("Please select the ridership column."); return; }

    var method = document.querySelector('input[name="rfCalibMethod"]:checked');
    var methodVal = method ? method.value : "ratio";

    // Build observation array using per-route CDI (the core fix)
    var obs = [];
    for (var i = 0; i < _matchResult.matched.length; i++) {
      var match = _matchResult.matched[i];
      var ridership = parseFloat(match.csvRow[colRidership]);
      if (!Number.isFinite(ridership)) continue;
      var routeCDI = match.routeCDI.cdi;
      if (!Number.isFinite(routeCDI) || routeCDI <= 0) continue;
      if (_normalizeByLength) {
        var len = match.routeCDI.lengthMiles;
        if (!Number.isFinite(len) || len <= 0) continue;
        ridership = ridership / len;
      }
      obs.push({ ridership: ridership, demandIndex: routeCDI });
    }

    if (obs.length < 2) {
      alert("Not enough valid data points (need 2+ with valid ridership and CDI).");
      return;
    }

    var calibResult;
    if (methodVal === "regression") {
      calibResult = RM.calibrateRegression(obs);
      _calibration = { factor: calibResult.slope, intercept: calibResult.intercept, n: calibResult.n, rSquared: calibResult.rSquared, method: "regression" };
    } else {
      calibResult = RM.calibrateRatio(obs);
      _calibration = { factor: calibResult.factor, n: calibResult.n, rSquared: calibResult.rSquared, method: "ratio" };
    }

    // Display results
    var resultsEl = document.getElementById("rfCalibResults");
    if (resultsEl) resultsEl.style.display = "";

    var factorEl = document.getElementById("rfCalibFactor");
    if (factorEl) factorEl.textContent = _calibration.factor.toFixed(4);

    var r2El = document.getElementById("rfCalibRSquared");
    if (r2El) r2El.textContent = _calibration.rSquared != null ? _calibration.rSquared.toFixed(4) : "\u2014";

    var sizeEl = document.getElementById("rfCalibSampleSize");
    if (sizeEl) sizeEl.textContent = String(_calibration.n);

    var warnEl = document.getElementById("rfCalibWarning");
    if (warnEl) {
      var warning = calibResult.warning || "";
      if (_calibration.n < 5) warning += (warning ? " " : "") + "Small sample size (" + _calibration.n + " routes).";
      if (warning) {
        warnEl.style.display = "";
        warnEl.textContent = warning;
      } else {
        warnEl.style.display = "none";
      }
    }

    var expBtn = document.getElementById("rfExportCalibJSON");
    if (expBtn) expBtn.disabled = false;

    // Show next step
    var nextStep = document.getElementById("rfCalibNextStep");
    if (nextStep) nextStep.style.display = "";
  }

  // ---- Layer 3: Elasticity ----

  function refreshElasticity() {
    if (!isPopupVisible()) return;

    var stId = document.getElementById("rfServiceType").value;
    var st = RM.getServiceType(stId);

    // Display premiums
    var premEl = document.getElementById("rfPremiumDisplay");
    if (premEl) {
      premEl.innerHTML =
        '<div class="rf-premium-row"><span class="rf-premium-label">Frequency</span>' +
        '<span class="rf-premium-range">' + fmtPct(st.frequencyPremium.low) + ' - ' + fmtPct(st.frequencyPremium.high) + '</span></div>' +
        '<div class="rf-premium-row"><span class="rf-premium-label">Speed</span>' +
        '<span class="rf-premium-range">' + fmtPct(st.speedPremium.low) + ' - ' + fmtPct(st.speedPremium.high) + '</span></div>' +
        '<div class="rf-premium-row"><span class="rf-premium-label">Mode</span>' +
        '<span class="rf-premium-range">' + fmtPct(st.modePremium.low) + ' - ' + fmtPct(st.modePremium.high) + '</span></div>';
    }

    // Compute elasticity if demand exists
    var noCDI = document.getElementById("rfElasticityNoCDI");
    var resultsEl = document.getElementById("rfElasticityResults");

    if (!Number.isFinite(getActiveCDI())) {
      if (noCDI) noCDI.style.display = "";
      if (resultsEl) resultsEl.style.display = "none";
      return;
    }

    if (noCDI) noCDI.style.display = "none";
    if (resultsEl) resultsEl.style.display = "";

    var baseHeadway = parseFloat(document.getElementById("rfBaseHeadway").value) || 30;
    var newHeadway = parseFloat(document.getElementById("rfNewHeadway").value) || 15;
    var freqElast = parseFloat(document.getElementById("rfFreqElastValue").value) || 0.5;

    var calibFactor = (_calibration && _calibration.factor) ? _calibration.factor : 1;
    var lengthScale = (_normalizeByLength && _calibration) ? getTargetCorridorLength() : 1;
    var baseCDI = getActiveCDI() * calibFactor * lengthScale;

    var elast = RM.applyElasticity(baseCDI, {
      serviceTypeId: stId,
      baseHeadway: baseHeadway,
      newHeadway: newHeadway,
      freqElasticity: freqElast
    });

    var lowEl = document.getElementById("rfElastLow");
    var midEl = document.getElementById("rfElastMid");
    var highEl = document.getElementById("rfElastHigh");
    if (lowEl) lowEl.textContent = fmtNum(elast.low);
    if (midEl) midEl.textContent = fmtNum(elast.mid);
    if (highEl) highEl.textContent = fmtNum(elast.high);

    var freqEffEl = document.getElementById("rfFreqEffect");
    if (freqEffEl) freqEffEl.textContent = elast.freqEffect.toFixed(3) + "x";

    var baseCDIEl = document.getElementById("rfBaseCDI");
    if (baseCDIEl) baseCDIEl.textContent = baseCDI.toFixed(2);
  }

  function fmtPct(v) { return "+" + Math.round(v * 100) + "%"; }
  function fmtNum(v) { return Number.isFinite(v) ? v.toFixed(1) : "\u2014"; }

  // ---- Layer 4: Scenarios ----

  function saveAllScenarioForms() {
    for (var i = 0; i < 4; i++) {
      var s = _scenarios[i];
      var nameEl = document.getElementById("rfScenName_" + i);
      if (nameEl) s.name = nameEl.value;
      s.serviceTypeId = (document.getElementById("rfScenServiceType_" + i) || {}).value || "local_bus";
      s.headway = parseFloat((document.getElementById("rfScenHeadway_" + i) || {}).value) || 30;
      s.span = parseFloat((document.getElementById("rfScenSpan_" + i) || {}).value) || 14;
      s.avgSpeed = parseFloat((document.getElementById("rfScenSpeed_" + i) || {}).value) || 15;
      s.costPerRevenueHour = parseFloat((document.getElementById("rfScenCostPerHr_" + i) || {}).value) || 150;
      s.serviceDaysPerYear = parseInt((document.getElementById("rfScenServiceDays_" + i) || {}).value, 10) || 260;
    }
  }

  function loadAllScenarioForms() {
    for (var i = 0; i < 4; i++) {
      var s = _scenarios[i];
      var nameEl = document.getElementById("rfScenName_" + i);
      if (nameEl) nameEl.value = s.name || SCENARIO_NAMES[i];
      var stEl = document.getElementById("rfScenServiceType_" + i);
      if (stEl) stEl.value = s.serviceTypeId || "local_bus";
      var hwEl = document.getElementById("rfScenHeadway_" + i);
      if (hwEl) hwEl.value = String(s.headway || 30);
      var spanEl = document.getElementById("rfScenSpan_" + i);
      if (spanEl) spanEl.value = String(s.span || 14);
      var speedEl = document.getElementById("rfScenSpeed_" + i);
      if (speedEl) speedEl.value = String(s.avgSpeed || 15);
      var costEl = document.getElementById("rfScenCostPerHr_" + i);
      if (costEl) costEl.value = String(s.costPerRevenueHour || 150);
      var daysEl = document.getElementById("rfScenServiceDays_" + i);
      if (daysEl) daysEl.value = String(s.serviceDaysPerYear || 260);
    }
  }

  function buildAndCompareScenarios() {
    var activeCDI = getActiveCDI();
    if (!Number.isFinite(activeCDI)) {
      alert("Run Demand or Calibrate analysis first.");
      return;
    }

    var routeLength = RM.getRouteLength();
    var calibFactor = (_calibration && _calibration.factor) ? _calibration.factor : 1;
    var lengthScale = (_normalizeByLength && _calibration) ? getTargetCorridorLength() : 1;
    var baseCDI = activeCDI;
    var freqElast = parseFloat((document.getElementById("rfFreqElastValue") || {}).value) || 0.5;

    var builtScenarios = [];

    for (var i = 0; i < 4; i++) {
      var name = (document.getElementById("rfScenName_" + i) || {}).value || SCENARIO_NAMES[i];
      var serviceTypeId = (document.getElementById("rfScenServiceType_" + i) || {}).value || "local_bus";
      var headway = parseFloat((document.getElementById("rfScenHeadway_" + i) || {}).value) || 30;
      var span = parseFloat((document.getElementById("rfScenSpan_" + i) || {}).value) || 14;
      var avgSpeed = parseFloat((document.getElementById("rfScenSpeed_" + i) || {}).value) || 15;
      var costPerRevenueHour = parseFloat((document.getElementById("rfScenCostPerHr_" + i) || {}).value) || 150;
      var serviceDaysPerYear = parseInt((document.getElementById("rfScenServiceDays_" + i) || {}).value, 10) || 260;

      var elast = RM.applyElasticity(baseCDI * calibFactor * lengthScale, {
        serviceTypeId: serviceTypeId,
        baseHeadway: 30, // baseline local bus
        newHeadway: headway,
        freqElasticity: freqElast
      });

      var built = RM.buildScenario({
        name: name,
        serviceTypeId: serviceTypeId,
        routeLengthMiles: routeLength,
        headway: headway,
        span: span,
        avgSpeed: avgSpeed,
        costPerRevenueHour: costPerRevenueHour,
        serviceDaysPerYear: serviceDaysPerYear,
        baseDemandCDI: baseCDI * calibFactor * lengthScale,
        elasticityResult: elast,
        calibrationFactor: 1 // already applied via baseCDI * calibFactor * lengthScale
      });

      builtScenarios.push(built);
    }

    // Build comparison table
    displayComparisonTable(builtScenarios);

    // Enable exports
    var expCSV = document.getElementById("rfExportScenariosCSV");
    var expJSON = document.getElementById("rfExportScenariosJSON");
    if (expCSV) expCSV.disabled = false;
    if (expJSON) expJSON.disabled = false;
  }

  function displayComparisonTable(scenarios) {
    var noCDI = document.getElementById("rfScenarioNoCDI");
    var tableEl = document.getElementById("rfComparisonTable");
    if (noCDI) noCDI.style.display = "none";
    if (tableEl) tableEl.style.display = "";

    var thead = document.getElementById("rfCompareHead");
    var tbody = document.getElementById("rfCompareBody");
    if (!thead || !tbody) return;

    // Build header
    thead.innerHTML = '<tr>' +
      '<th>Metric</th>' +
      scenarios.map(function (s) { return '<th>' + s.name + '</th>'; }).join("") +
      '</tr>';

    // Build rows
    var metrics = [
      { label: "Service Type", key: function (s) { return RM.getServiceType(s.serviceTypeId).label; } },
      { label: "Headway (min)", key: function (s) { return s.headway; } },
      { label: "Span (hrs/day)", key: function (s) { return s.span; } },
      { label: "Avg Speed (mph)", key: function (s) { return s.avgSpeed; } },
      { label: "Vehicles Needed", key: function (s) { return s.vehiclesNeeded; } },
      { label: "Rev-Hrs / Day", key: function (s) { return s.revenueHoursPerDay.toFixed(1); } },
      { label: "Annual Rev-Hrs", key: function (s) { return Math.round(s.annualRevenueHours).toLocaleString(); } },
      { label: "Annual Op. Cost", key: function (s) { return "$" + Math.round(s.annualOperatingCost).toLocaleString(); } },
      { label: "Daily Ridership (Low)", key: function (s) { return Math.round(s.dailyRidership.low).toLocaleString(); } },
      { label: "Daily Ridership (Mid)", key: function (s) { return Math.round(s.dailyRidership.mid).toLocaleString(); }, highlight: true },
      { label: "Daily Ridership (High)", key: function (s) { return Math.round(s.dailyRidership.high).toLocaleString(); } },
      { label: "Annual Ridership (Mid)", key: function (s) { return Math.round(s.annualRidership.mid).toLocaleString(); }, highlight: true },
      { label: "Boardings / Rev-Hr (Mid)", key: function (s) { return s.boardingsPerRevHr.mid.toFixed(1); } },
      { label: "Cost / Boarding (Mid)", key: function (s) { return "$" + s.costPerBoarding.mid.toFixed(2); } }
    ];

    tbody.innerHTML = metrics.map(function (m) {
      var cls = m.highlight ? ' class="rf-highlight-row"' : '';
      return '<tr' + cls + '><td>' + m.label + '</td>' +
        scenarios.map(function (s) { return '<td>' + m.key(s) + '</td>'; }).join("") +
        '</tr>';
    }).join("");

    // Store for export
    _lastBuiltScenarios = scenarios;
  }

  var _lastBuiltScenarios = null;

  // ---- Export helpers ----

  function _dateStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function _triggerDownload(content, mimeType, filename) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportDemandGeoJSON() {
    if (!_lastResult) return;
    var tpi = _lastResult.tpiResult;
    var factors = TPI.FACTORS;

    var features = tpi.geos.map(function (geo) {
      var geoid = geo.properties && geo.properties.GEOID;
      var sd = geoid ? tpi.scores.get(geoid) : null;
      var composite = (sd && Number.isFinite(sd.composite)) ? sd.composite : null;
      var props = {
        GEOID: geoid || "",
        cdiScore: composite != null ? parseFloat(composite.toFixed(4)) : null,
        cdiClass: composite != null ? RM.classifyCDI({ value: composite }).label : "N/A"
      };
      factors.forEach(function (f) {
        var rawMap = tpi.rawValues.get(f.id) || new Map();
        var raw = rawMap.get(geoid);
        props[f.id + "_raw"] = (raw != null && Number.isFinite(raw)) ? parseFloat(raw.toFixed(6)) : null;
        var scoreMap = tpi.factorScores.get(f.id) || new Map();
        props[f.id + "_score"] = scoreMap.get(geoid) || null;
      });
      return { type: "Feature", properties: props, geometry: geo.geometry };
    });

    _triggerDownload(
      JSON.stringify({ type: "FeatureCollection", features: features }, null, 2),
      "application/geo+json",
      "corridor-demand-" + _dateStamp() + ".geojson"
    );
  }

  function exportDemandCSV() {
    if (!_lastResult) return;
    var tpi = _lastResult.tpiResult;
    var factors = TPI.FACTORS;

    var header = ["GEOID", "cdiScore", "cdiClass"];
    factors.forEach(function (f) { header.push(f.id + "_raw", f.id + "_score"); });
    var rows = [header.join(",")];

    tpi.geoids.forEach(function (geoid) {
      var sd = tpi.scores.get(geoid);
      var composite = (sd && Number.isFinite(sd.composite)) ? sd.composite : null;
      var row = [geoid, composite != null ? composite.toFixed(4) : "", composite != null ? RM.classifyCDI({ value: composite }).label : ""];
      factors.forEach(function (f) {
        var rawMap = tpi.rawValues.get(f.id) || new Map();
        var raw = rawMap.get(geoid);
        row.push((raw != null && Number.isFinite(raw)) ? raw.toFixed(6) : "");
        var scoreMap = tpi.factorScores.get(f.id) || new Map();
        row.push(scoreMap.get(geoid) || "");
      });
      rows.push(row.join(","));
    });

    _triggerDownload(rows.join("\n"), "text/csv", "corridor-demand-" + _dateStamp() + ".csv");
  }

  function exportScenariosCSV() {
    if (!_lastBuiltScenarios || _lastBuiltScenarios.length === 0) return;
    var comp = RM.compareScenarios(_lastBuiltScenarios);
    var rows = [comp.headers.join(",")];
    for (var i = 0; i < _lastBuiltScenarios.length; i++) {
      rows.push(RM.scenarioToRow(_lastBuiltScenarios[i]).join(","));
    }
    _triggerDownload(rows.join("\n"), "text/csv", "ridership-scenarios-" + _dateStamp() + ".csv");
  }

  function exportScenariosJSON() {
    if (!_lastBuiltScenarios) return;
    _triggerDownload(
      JSON.stringify({ type: "ridership-scenarios", version: 1, scenarios: _lastBuiltScenarios, exportedAt: new Date().toISOString() }, null, 2),
      "application/json",
      "ridership-scenarios-" + _dateStamp() + ".json"
    );
  }

  function exportCalibJSON() {
    if (!_calibration) return;
    _triggerDownload(
      RM.exportCoefficients(_calibration),
      "application/json",
      "ridership-calibration-" + _dateStamp() + ".json"
    );
  }

  function handleCalibImport(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var result = RM.importCoefficients(e.target.result);
      if (result.error) {
        alert(result.error);
        return;
      }
      _calibration = result;
      // Update UI
      var resultsEl = document.getElementById("rfCalibResults");
      if (resultsEl) resultsEl.style.display = "";
      var factorEl = document.getElementById("rfCalibFactor");
      if (factorEl) factorEl.textContent = _calibration.factor ? _calibration.factor.toFixed(4) : "\u2014";
      var r2El = document.getElementById("rfCalibRSquared");
      if (r2El) r2El.textContent = _calibration.rSquared != null ? _calibration.rSquared.toFixed(4) : "\u2014";
      var sizeEl = document.getElementById("rfCalibSampleSize");
      if (sizeEl) sizeEl.textContent = String(_calibration.n || "\u2014");
      App.setStatus("Calibration coefficients imported");
    };
    reader.readAsText(file);
  }

  // ---- Stale indicator ----

  function markStale() {
    if (!_lastResult) return;
    _stale = true;
    if (!isPopupVisible()) return;
    var statusEl = document.getElementById("rfDemandStatus");
    var textEl = document.getElementById("rfDemandStatusText");
    if (statusEl && textEl) {
      statusEl.style.display = "";
      textEl.textContent = "Data has changed \u2014 re-run to update.";
      statusEl.className = "rf-status rf-status-stale";
    }
  }

  // ---- Module init (called once on first popup open) ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Tab navigation
    var tabs = document.querySelectorAll(".rf-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (e) {
        switchTab(e.target.getAttribute("data-tab"));
      });
    }

    // ---- Calibrate tab ----

    // "Adjust Weights" button opens the weight modal
    var adjBtn = document.getElementById("rfAdjustWeights");
    if (adjBtn) adjBtn.addEventListener("click", openWeightsModal);

    // Modal: Confirm saves pending weights
    var confirmBtn = document.getElementById("rfWeightsConfirm");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () {
        if (!_pendingWeights) return;
        _weights = Object.assign({}, _pendingWeights);
        closeWeightsModal();
        markStale();
      });
    }

    // Modal: Cancel discards changes
    var cancelBtn = document.getElementById("rfWeightsCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeWeightsModal);

    // Modal: Reset to defaults
    var resetBtn = document.getElementById("rfResetWeights");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!_pendingWeights) return;
        applyWeightsToModalSliders(TPI.getDefaultWeights());
      });
    }

    // Modal: Copy From TPI (reads TPI's current live weights)
    var copyBtn = document.getElementById("rfCopyFromTPI");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (typeof App.getTpiWeights === "function") {
          applyWeightsToModalSliders(App.getTpiWeights());
        } else {
          alert("Open the Transit Propensity Index tool first to copy its weights.");
        }
      });
    }

    var sysBtn = document.getElementById("rfRunSystemAnalysis");
    if (sysBtn) sysBtn.addEventListener("click", runSystemAnalysis);

    var calibApportionCb = document.getElementById("rfCalibApportionByArea");
    if (calibApportionCb) {
      calibApportionCb.checked = _apportionByArea;
      calibApportionCb.addEventListener("change", function () {
        _apportionByArea = calibApportionCb.checked;
        // Sync to demand tab checkbox
        var demandCb = document.getElementById("rfApportionByArea");
        if (demandCb) demandCb.checked = _apportionByArea;
        markStale();
      });
    }

    var calibNormCb = document.getElementById("rfCalibNormalizeByLength");
    if (calibNormCb) {
      calibNormCb.checked = _normalizeByLength;
      calibNormCb.addEventListener("change", function () {
        _normalizeByLength = calibNormCb.checked;
        var demandNormCb = document.getElementById("rfNormalizeByLength");
        if (demandNormCb) demandNormCb.checked = _normalizeByLength;
        markStale();
      });
    }

    var uploadBtn = document.getElementById("rfUploadCalibCSV");
    var fileInput = document.getElementById("rfCalibFile");
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length > 0) handleCalibUpload(fileInput.files[0]);
      });
    }

    var matchBtn = document.getElementById("rfMatchRoutes");
    if (matchBtn) matchBtn.addEventListener("click", runMatchRoutes);

    var calibBtn = document.getElementById("rfRunCalibration");
    if (calibBtn) calibBtn.addEventListener("click", runCalibration);

    // Calibration export/import
    var expCalib = document.getElementById("rfExportCalibJSON");
    if (expCalib) expCalib.addEventListener("click", exportCalibJSON);
    var impCalibBtn = document.getElementById("rfImportCalibJSON");
    var impCalibFile = document.getElementById("rfCalibImportFile");
    if (impCalibBtn && impCalibFile) {
      impCalibBtn.addEventListener("click", function () { impCalibFile.click(); });
      impCalibFile.addEventListener("change", function () {
        if (impCalibFile.files.length > 0) handleCalibImport(impCalibFile.files[0]);
      });
    }

    // Next step link from calibrate
    var goDemand = document.getElementById("rfGoToDemand");
    if (goDemand) goDemand.addEventListener("click", function (e) { e.preventDefault(); switchTab("demand"); });

    // ---- Demand tab ----
    var runBtn = document.getElementById("rfRunDemand");
    if (runBtn) runBtn.addEventListener("click", runDemand);

    var apportionCb = document.getElementById("rfApportionByArea");
    if (apportionCb) {
      apportionCb.checked = _apportionByArea;
      apportionCb.addEventListener("change", function () {
        _apportionByArea = apportionCb.checked;
        // Sync to calibrate tab checkbox
        var calibCb = document.getElementById("rfCalibApportionByArea");
        if (calibCb) calibCb.checked = _apportionByArea;
        markStale();
      });
    }

    var normCb = document.getElementById("rfNormalizeByLength");
    if (normCb) {
      normCb.checked = _normalizeByLength;
      normCb.addEventListener("change", function () {
        _normalizeByLength = normCb.checked;
        var calibNormCb2 = document.getElementById("rfCalibNormalizeByLength");
        if (calibNormCb2) calibNormCb2.checked = _normalizeByLength;
        markStale();
      });
    }

    var corridorSel = document.getElementById("rfCorridorSelect");
    if (corridorSel) {
      corridorSel.addEventListener("change", function () {
        _selectedCorridor = corridorSel.value;
      });
    }

    // CDI info button toggle
    var cdiInfoBtn = document.getElementById("rfCDIInfoBtn");
    var cdiTooltip = document.getElementById("rfCDITooltip");
    if (cdiInfoBtn && cdiTooltip) {
      cdiInfoBtn.addEventListener("click", function () {
        cdiTooltip.style.display = cdiTooltip.style.display === "none" ? "" : "none";
      });
    }

    // Next step links
    var goElast = document.getElementById("rfGoToElasticity");
    if (goElast) goElast.addEventListener("click", function (e) { e.preventDefault(); switchTab("elasticity"); });

    // Export demand
    var expGJ = document.getElementById("rfExportDemandGeoJSON");
    if (expGJ) expGJ.addEventListener("click", exportDemandGeoJSON);
    var expCSV = document.getElementById("rfExportDemandCSV");
    if (expCSV) expCSV.addEventListener("click", exportDemandCSV);

    // Elasticity tab
    var stSelect = document.getElementById("rfServiceType");
    if (stSelect) stSelect.addEventListener("change", refreshElasticity);

    var baseHw = document.getElementById("rfBaseHeadway");
    if (baseHw) baseHw.addEventListener("change", refreshElasticity);
    var newHw = document.getElementById("rfNewHeadway");
    if (newHw) newHw.addEventListener("change", refreshElasticity);

    // Frequency elasticity slider
    var freqSlider = document.getElementById("rfFreqElastSlider");
    var freqValue = document.getElementById("rfFreqElastValue");
    if (freqSlider && freqValue) {
      freqSlider.addEventListener("input", function () {
        freqValue.value = freqSlider.value;
        refreshElasticity();
      });
      freqValue.addEventListener("change", function () {
        freqSlider.value = freqValue.value;
        refreshElasticity();
      });
    }

    // Scenarios tab
    var buildBtn = document.getElementById("rfBuildScenarios");
    if (buildBtn) buildBtn.addEventListener("click", buildAndCompareScenarios);

    var expScenCSV = document.getElementById("rfExportScenariosCSV");
    if (expScenCSV) expScenCSV.addEventListener("click", exportScenariosCSV);
    var expScenJSON = document.getElementById("rfExportScenariosJSON");
    if (expScenJSON) expScenJSON.addEventListener("click", exportScenariosJSON);
  }

  // ---- Popup lifecycle hooks ----

  function onOpen(core) {
    // Sync apportion checkboxes
    var apportionCb = document.getElementById("rfApportionByArea");
    if (apportionCb) apportionCb.checked = _apportionByArea;
    var calibApportionCb = document.getElementById("rfCalibApportionByArea");
    if (calibApportionCb) calibApportionCb.checked = _apportionByArea;

    // Sync normalize-by-length checkboxes
    var normCb = document.getElementById("rfNormalizeByLength");
    if (normCb) normCb.checked = _normalizeByLength;
    var calibNormCb = document.getElementById("rfCalibNormalizeByLength");
    if (calibNormCb) calibNormCb.checked = _normalizeByLength;

    // Restore system analysis state
    if (_systemResult) {
      displaySystemResults(_systemResult);
      populateCorridorDropdown();
      var step2 = document.getElementById("rfCalibStep2");
      if (step2) { step2.style.opacity = "1"; step2.style.pointerEvents = "auto"; }
    }
    if (_matchResult && _matchResult.matched.length >= 2) {
      var step3 = document.getElementById("rfCalibStep3");
      if (step3) { step3.style.opacity = "1"; step3.style.pointerEvents = "auto"; }
    }

    // Restore demand results
    if (_lastResult) {
      displayDemandResults(_lastResult);
    }

    // Restore corridor dropdown selection
    var corridorSel = document.getElementById("rfCorridorSelect");
    if (corridorSel && _selectedCorridor) corridorSel.value = _selectedCorridor;

    // Show uncalibrated warning if needed
    var uncalibWarn = document.getElementById("rfUncalibratedWarning");
    if (uncalibWarn) uncalibWarn.style.display = _systemResult ? "none" : (_lastResult ? "" : "none");

    if (_stale) markStale();

    // Restore active tab
    switchTab(_activeTab);

    // Restore all scenario form values
    loadAllScenarioForms();
  }

  function onClose(core) {
    // Save all scenario form state
    saveAllScenarioForms();
  }

  async function update(core) {
    if (_lastResult && !core.getUnion()) {
      clearAll();
    } else {
      markStale();
    }
  }

  // ---- Session persistence (cache module hooks) ----

  // Helper: serialize the tpiResult Maps inside a system/demand result.
  function serializeTpiResult(tpi, mode) {
    if (!tpi) return null;
    var obj = {
      geoLevel: tpi.geoLevel,
      year: tpi.year,
      geoids: tpi.geoids ? tpi.geoids.slice() : [],
      effectiveWeights: tpi.effectiveWeights ? Object.assign({}, tpi.effectiveWeights) : {},
      tractFallbackFactors: tpi.tractFallbackFactors ? tpi.tractFallbackFactors.slice() : [],
      apportionByArea: tpi.apportionByArea || false,
      scores: App.mapToObj(tpi.scores),
      factorScores: App.nestedMapToObj(tpi.factorScores),
      rawValues: App.nestedMapToObj(tpi.rawValues)
    };
    if (mode === "full" && tpi.geos) {
      obj.geos = tpi.geos.slice();
    }
    return obj;
  }

  // Helper: reconstruct a tpiResult from serialized data.
  function deserializeTpiResult(r) {
    if (!r) return null;
    return {
      geoLevel: r.geoLevel,
      year: r.year,
      geoids: r.geoids || [],
      geos: r.geos || [],
      effectiveWeights: r.effectiveWeights || {},
      tractFallbackFactors: r.tractFallbackFactors || [],
      apportionByArea: r.apportionByArea || false,
      scores: App.objToMap(r.scores),
      factorScores: App.nestedObjToMap(r.factorScores),
      rawValues: App.nestedObjToMap(r.rawValues)
    };
  }

  function saveRfState(mode) {
    var data = {
      weights: Object.assign({}, _weights),
      apportionByArea: _apportionByArea,
      normalizeByLength: _normalizeByLength,
      calibration: _calibration ? Object.assign({}, _calibration) : null,
      scenarios: _scenarios.map(function (s) { return Object.assign({}, s); }),
      selectedCorridor: _selectedCorridor,
      activeTab: _activeTab,
      perRouteCDI: _perRouteCDI ? _perRouteCDI.slice() : null
    };

    if (_systemResult) {
      data.systemResult = {
        systemCDI: _systemResult.systemCDI ? Object.assign({}, _systemResult.systemCDI) : null,
        geoLevel: _systemResult.geoLevel,
        year: _systemResult.year,
        tpiResult: serializeTpiResult(_systemResult.tpiResult, mode)
      };
    }

    return data;
  }

  function restoreRfState(data) {
    if (!data) return;

    if (data.weights) _weights = Object.assign({}, data.weights);
    if (data.apportionByArea != null) _apportionByArea = !!data.apportionByArea;
    if (data.normalizeByLength != null) _normalizeByLength = !!data.normalizeByLength;
    if (data.calibration) _calibration = Object.assign({}, data.calibration);
    if (Array.isArray(data.scenarios) && data.scenarios.length === 4) {
      for (var i = 0; i < 4; i++) _scenarios[i] = Object.assign({}, data.scenarios[i]);
    }
    if (data.selectedCorridor) _selectedCorridor = data.selectedCorridor;
    if (data.activeTab) _activeTab = data.activeTab;
    if (Array.isArray(data.perRouteCDI)) _perRouteCDI = data.perRouteCDI.slice();

    if (data.systemResult) {
      var tpiRestored = deserializeTpiResult(data.systemResult.tpiResult);
      _systemResult = {
        tpiResult: tpiRestored,
        systemCDI: data.systemResult.systemCDI || null,
        routeCDIs: _perRouteCDI || [],
        geoLevel: data.systemResult.geoLevel,
        year: data.systemResult.year
      };
      _stale = false;

      // If geometry was saved, render RF choropleth immediately
      if (tpiRestored && tpiRestored.geos && tpiRestored.geos.length > 0) {
        var displayCDI = _systemResult.systemCDI ||
          { value: NaN, scored: tpiRestored.geoids.length, total: tpiRestored.geoids.length };
        renderChoropleth({ tpiResult: tpiRestored, corridorCDI: displayCDI });
        App.renderCensusOverlay(tpiRestored.geos);
        App.popup.showFloatingWidget("rf-legend", "projects/ridership-legend.html", {
          position: "bottom-left", width: 170, title: "Demand Legend"
        });
      }
    }
  }

  // ---- Register module ----

  App.registerModule({
    id: "ridership-forecasting",
    name: "Ridership Forecasting",
    enabled: true,
    popupWidth: 960,
    popupHTML: "projects/ridership-forecasting-popup.html",

    floatingWidgets: [
      { id: "rf-legend", htmlFile: "projects/ridership-legend.html", position: "bottom-left", width: 170 }
    ],

    init: function (core) { init(core); },
    onOpen: function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    clear: function () { clearAll(); },
    update: async function (core) { await update(core); }
  });

  // Register with session cache so RF state is saved/restored with features
  if (App.cache && App.cache.registerModule) {
    App.cache.registerModule("rf", {
      collect: saveRfState,
      apply: restoreRfState
    });
  }

})();
