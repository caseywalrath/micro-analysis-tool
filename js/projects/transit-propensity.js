// js/projects/transit-propensity.js
// Transit Propensity Index project: registers as an analysis module,
// opens in a popup with 3-column layout, renders choropleth + floating legend.
// Depends on: App namespace, TPI namespace (tpi-scoring.js), App.popup (popup.js), turf (CDN).
// Exports: none (self-registers via App.registerModule)

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var TPI = window.TPI;

  // ---- Project-local state (persists across popup open/close) ----

  var _lastResult = null; // last TPI computation result
  var _weights = TPI.getDefaultWeights(); // current weight settings
  var _stale = false; // true when features changed since last compute
  var _running = false;
  var _rescoreTimer = null;
  var _initialized = false; // true after first init() call

  function getTpiClass(score) {
    if (!Number.isFinite(score)) return "N/A";
    if (score < 2) return "Low";
    if (score < 3) return "Medium-Low";
    if (score < 4) return "Medium";
    if (score < 5) return "Medium-High";
    return "High";
  }

  // ---- DOM guard: only touch DOM when popup is open for this module ----

  function isPopupVisible() {
    return App.popup.isOpen() && App.popup.currentModuleId() === "transit-propensity";
  }

  // ---- Weight sliders ----

  function buildWeightSliders() {
    var container = document.getElementById("tpiWeightSliders");
    if (!container) return;
    container.innerHTML = "";

    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = _weights[f.id] != null ? _weights[f.id] : f.defaultWeight;

      var row = document.createElement("div");
      row.className = "tpi-slider-row";

      row.innerHTML =
        '<label class="tpi-slider-label" title="' + f.description + '">' + f.label + '</label>' +
        '<input type="range" class="tpi-slider" min="0" max="100" step="5" value="' + w + '" data-factor="' + f.id + '" />' +
        '<span class="tpi-slider-value" id="tpiW_' + f.id + '">' + w + '</span>';

      container.appendChild(row);

      // Wire slider input
      var slider = row.querySelector("input[type=range]");
      slider.addEventListener("input", onSliderChange);
    }

    updateWeightSum();
  }

  function onSliderChange(e) {
    var factorId = e.target.getAttribute("data-factor");
    _weights[factorId] = parseInt(e.target.value, 10);
    var label = document.getElementById("tpiW_" + factorId);
    if (label) label.textContent = String(_weights[factorId]);
    var sum = updateWeightSum();
    if (_lastResult && sum === 100) {
      clearTimeout(_rescoreTimer);
      _rescoreTimer = setTimeout(runInstantRescore, 300);
    } else {
      markStale();
    }
  }

  function updateWeightSum() {
    var sum = 0;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      sum += (_weights[factors[i].id] || 0);
    }
    // DOM guard: only update UI if popup is visible
    if (!isPopupVisible()) return sum;

    var sumEl  = document.getElementById("tpiWeightSum");
    var warnEl = document.getElementById("tpiWeightWarn");
    var runBtn = document.getElementById("tpiRun");
    if (sumEl) sumEl.textContent = String(sum);
    var valid = (sum === 100);
    if (warnEl) {
      warnEl.style.display = valid ? "none" : "";
      if (sumEl) sumEl.style.color = valid ? "" : "#e53e3e";
    }
    if (runBtn && !_running) runBtn.disabled = !valid;
    return sum;
  }

  function resetWeights() {
    _weights = TPI.getDefaultWeights();
    // Update slider DOM
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var slider = document.querySelector('.tpi-slider[data-factor="' + f.id + '"]');
      if (slider) slider.value = String(f.defaultWeight);
      var label = document.getElementById("tpiW_" + f.id);
      if (label) label.textContent = String(f.defaultWeight);
    }
    updateWeightSum();
    markStale();
  }

  // ---- Stale indicator ----

  function markStale() {
    if (!_lastResult) return; // nothing computed yet
    _stale = true;
    // DOM guard: only update UI if popup is visible
    if (!isPopupVisible()) return;
    var statusEl = document.getElementById("tpiStatus");
    var textEl = document.getElementById("tpiStatusText");
    if (statusEl && textEl) {
      statusEl.style.display = "";
      textEl.textContent = "Data has changed \u2014 re-run to update scores.";
      statusEl.className = "tpi-status tpi-status-stale";
    }
  }

  // ---- Run TPI ----

  async function runTPI() {
    if (_running) return;
    _running = true;

    var statusEl = document.getElementById("tpiStatus");
    var textEl = document.getElementById("tpiStatusText");
    var runBtn = document.getElementById("tpiRun");

    if (runBtn) runBtn.disabled = true;
    if (statusEl) { statusEl.style.display = ""; statusEl.className = "tpi-status"; }

    try {
      // Read geo level and year from TPI's own selectors in the popup
      var geoLevel = document.getElementById("tpiGeoLevel").value;
      var year = document.getElementById("tpiYearSelect").value;

      var result = await TPI.computeTPI({
        geoLevel: geoLevel,
        year: year,
        weights: _weights,
        lodesData: App.lodesData,
        onProgress: function (msg) {
          if (textEl) textEl.textContent = msg;
          App.setStatus(msg);
        }
      });

      _lastResult = result;
      _stale = false;

      // Render census overlay with scored geographies
      App.renderCensusOverlay(result.geos);

      // Render choropleth + floating legend
      renderChoropleth(result);
      App.popup.showFloatingWidget("tpi-legend", "projects/tpi-legend.html", {
        position: "bottom-left",
        width: 160,
        title: "TPI Legend"
      });

      // Update results summary
      displayResults(result);

      if (textEl) textEl.textContent = "TPI computed successfully.";
      if (statusEl) statusEl.className = "tpi-status tpi-status-done";
      App.setStatus("TPI computed");

    } catch (err) {
      console.error("TPI error:", err);
      if (textEl) textEl.textContent = "Error: " + (err.message || err);
      if (statusEl) statusEl.className = "tpi-status tpi-status-error";
      App.setStatus("TPI error");
    } finally {
      _running = false;
      updateWeightSum(); // restores button disabled state based on weight validity
    }
  }

  function runInstantRescore() {
    if (!_lastResult) return;
    var rescored = TPI.rescoreFromRaw(_lastResult.rawValues, _weights, _lastResult.geoids);
    _lastResult.scores           = rescored.scores;
    _lastResult.factorScores     = rescored.factorScores;
    _lastResult.effectiveWeights = rescored.effectiveWeights;
    _stale = false;
    renderChoropleth(_lastResult);
    displayResults(_lastResult);
    var statusEl = document.getElementById("tpiStatus");
    var textEl   = document.getElementById("tpiStatusText");
    if (statusEl && textEl) {
      statusEl.style.display = "";
      statusEl.className = "tpi-status tpi-status-done";
      textEl.textContent = "Scores updated from cached data.";
    }
  }

  // ---- Display results summary ----

  function displayResults(result) {
    // DOM guard
    if (!isPopupVisible()) return;
    var resultsEl = document.getElementById("tpiResults");
    if (!resultsEl) return;
    resultsEl.style.display = "";

    // Geography count
    var geoCountEl = document.getElementById("tpiGeoCount");
    if (geoCountEl) {
      var geoLevelEl = document.getElementById("tpiGeoLevel");
      var geoLabel = (geoLevelEl && geoLevelEl.value === "tract") ? "tracts" : "block groups";
      geoCountEl.textContent = result.geoids.length + " " + geoLabel;
    }

    // Per-factor summary
    var summaryEl = document.getElementById("tpiFactorSummary");
    if (summaryEl) {
      var html = "";
      var factors = TPI.FACTORS;
      var fallbackSet = result.tractFallbackFactors || [];
      var anyFallback = false;
      for (var i = 0; i < factors.length; i++) {
        var f = factors[i];
        var w = result.effectiveWeights[f.id] || 0;
        if (w === 0) continue;

        var scoreMap = result.factorScores.get(f.id);
        var avgScore = NaN;
        if (scoreMap && scoreMap.size > 0) {
          var sum = 0; var cnt = 0;
          for (var entry of scoreMap.values()) {
            sum += entry; cnt++;
          }
          avgScore = cnt > 0 ? sum / cnt : NaN;
        }

        var statusClass = scoreMap && scoreMap.size > 0 ? "tpi-factor-ok" : "tpi-factor-na";
        var statusLabel = scoreMap && scoreMap.size > 0
          ? "avg " + avgScore.toFixed(1) + " / 5"
          : "N/A";

        var isFallback = fallbackSet.indexOf(f.id) !== -1;
        if (isFallback) anyFallback = true;
        var labelHtml = f.label + (isFallback ? ' <sup class="tpi-tract-marker" title="Tract-level data applied to block groups">\u2020</sup>' : "");

        html +=
          '<div class="tpi-factor-row">' +
            '<span class="tpi-factor-name">' + labelHtml + '</span>' +
            '<span class="tpi-factor-weight">' + Math.round(w) + '%</span>' +
            '<span class="tpi-factor-score ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>';
      }
      if (anyFallback) {
        html += '<div class="tpi-footnote">\u2020 Only available at Census Tract level. Tract values applied to all block groups within each tract.</div>';
      }
      summaryEl.innerHTML = html;
    }

    // Composite summary
    var compositeAvgEl = document.getElementById("tpiCompositeAvg");
    var scoredCountEl = document.getElementById("tpiScoredCount");

    if (compositeAvgEl) {
      var compSum = 0; var compCnt = 0;
      for (var entry2 of result.scores.values()) {
        if (Number.isFinite(entry2.composite)) {
          compSum += entry2.composite;
          compCnt++;
        }
      }
      var compAvg = compCnt > 0 ? compSum / compCnt : NaN;
      compositeAvgEl.textContent = Number.isFinite(compAvg) ? compAvg.toFixed(2) + " / 5" : "\u2014";
    }

    if (scoredCountEl) {
      var scored = 0;
      for (var entry3 of result.scores.values()) {
        if (Number.isFinite(entry3.composite)) scored++;
      }
      scoredCountEl.textContent = String(scored) + " / " + result.geoids.length;
    }

    var compositeMaxEl = document.getElementById("tpiCompositeMax");
    if (compositeMaxEl) {
      var compMax = NaN;
      for (var entry4 of result.scores.values()) {
        if (Number.isFinite(entry4.composite) && (isNaN(compMax) || entry4.composite > compMax))
          compMax = entry4.composite;
      }
      compositeMaxEl.textContent = Number.isFinite(compMax) ? compMax.toFixed(2) + " / 5" : "\u2014";
    }
  }

  // ---- Choropleth rendering ----

  var TPI_SOURCE = "tpi-choropleth";
  var TPI_FILL_LAYER = "tpi-choropleth-fill";
  var TPI_LINE_LAYER = "tpi-choropleth-line";

  function renderChoropleth(result) {
    var map = App.map;
    if (!map || !result) return;

    // Build GeoJSON with composite score as property
    var features = [];
    for (var i = 0; i < result.geos.length; i++) {
      var geo = result.geos[i];
      var geoid = geo.properties && geo.properties.GEOID;
      var scoreData = geoid ? result.scores.get(geoid) : null;
      var composite = (scoreData && Number.isFinite(scoreData.composite)) ? scoreData.composite : null;

      features.push({
        type: "Feature",
        properties: {
          GEOID: geoid,
          tpiScore: composite,
          factors: scoreData ? scoreData.factors : {}
        },
        geometry: geo.geometry
      });
    }

    var fc = { type: "FeatureCollection", features: features };

    // Color ramp: ColorBrewer Blues (sequential), 1=lightest -> 5=darkest
    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "tpiScore"], 0],
      0, "rgba(200,200,200,0.3)",
      1, "#eff3ff",
      2, "#bdd7e7",
      3, "#6baed6",
      4, "#3182bd",
      5, "#08519c"
    ];

    if (!map.getSource(TPI_SOURCE)) {
      map.addSource(TPI_SOURCE, { type: "geojson", data: fc });

      var beforeLayer = map.getLayer("buffers-fill") ? "buffers-fill" : undefined;

      map.addLayer({
        id: TPI_FILL_LAYER,
        type: "fill",
        source: TPI_SOURCE,
        paint: {
          "fill-color": colorExpr,
          "fill-opacity": 0.55
        }
      }, beforeLayer);

      map.addLayer({
        id: TPI_LINE_LAYER,
        type: "line",
        source: TPI_SOURCE,
        paint: {
          "line-color": "#333",
          "line-width": 0.5,
          "line-opacity": 0.4
        }
      }, beforeLayer);

      // Hover tooltip
      var popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

      map.on("mousemove", TPI_FILL_LAYER, function (e) {
        map.getCanvas().style.cursor = "pointer";
        if (e.features && e.features.length > 0) {
          var props = e.features[0].properties;
          var score = props.tpiScore;
          var geoid2 = props.GEOID || "\u2014";

          var html = '<div style="font-size:12px;line-height:1.4;">';
          html += '<b>GEOID:</b> ' + geoid2 + '<br>';
          html += '<b>TPI Score:</b> ' + (score != null ? Number(score).toFixed(2) : 'N/A') + ' / 5';

          var factors = null;
          try { factors = JSON.parse(props.factors); } catch (_) {}
          if (factors) {
            html += '<br><span style="color:#666;font-size:11px;">';
            var fNames = TPI.FACTORS;
            var fallbackIds = (_lastResult && _lastResult.tractFallbackFactors) ? _lastResult.tractFallbackFactors : [];
            for (var fi = 0; fi < fNames.length; fi++) {
              var fval = factors[fNames[fi].id];
              if (fval != null) {
                var isFb = fallbackIds.indexOf(fNames[fi].id) !== -1;
                html += fNames[fi].label + ': ' + fval + '/5' + (isFb ? ' <span style="color:#aaa">(T)</span>' : '') + '<br>';
              }
            }
            html += '</span>';
          }

          html += '</div>';
          popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        }
      });

      map.on("mouseleave", TPI_FILL_LAYER, function () {
        map.getCanvas().style.cursor = App.drawMode ? "crosshair" : "grab";
        popup.remove();
      });

    } else {
      map.getSource(TPI_SOURCE).setData(fc);
    }
  }

  function removeChoropleth() {
    var map = App.map;
    if (!map) return;
    if (map.getLayer(TPI_FILL_LAYER)) map.removeLayer(TPI_FILL_LAYER);
    if (map.getLayer(TPI_LINE_LAYER)) map.removeLayer(TPI_LINE_LAYER);
    if (map.getSource(TPI_SOURCE)) map.removeSource(TPI_SOURCE);
  }

  function clearChoropleth() {
    removeChoropleth();
    _lastResult = null; _stale = false;
    App.popup.hideFloatingWidget("tpi-legend");
    // DOM guard for popup elements
    if (isPopupVisible()) {
      var resultsEl = document.getElementById("tpiResults");
      if (resultsEl) resultsEl.style.display = "none";
      var statusEl = document.getElementById("tpiStatus");
      if (statusEl) statusEl.style.display = "none";
    }
    App.setStatus("TPI cleared");
  }

  // ---- Export helpers ----

  function _dateStamp() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function _triggerDownload(content, mimeType, filename) {
    var blob = new Blob([content], { type: mimeType });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportGeoJSON() {
    if (!_lastResult) return;
    var factors = TPI.FACTORS;
    var features = _lastResult.geos.map(function (geo) {
      var geoid = geo.properties && geo.properties.GEOID;
      var sd = geoid ? _lastResult.scores.get(geoid) : null;
      var composite = (sd && Number.isFinite(sd.composite)) ? sd.composite : null;
      var props = {
        GEOID: geoid || "",
        tpiScore: composite != null ? parseFloat(composite.toFixed(4)) : null,
        tpiClass: composite != null ? getTpiClass(composite) : "N/A"
      };
      factors.forEach(function (f) {
        var rawMap = _lastResult.rawValues.get(f.id) || new Map();
        var raw = rawMap.get(geoid);
        props[f.id + "_raw"] = (raw != null && Number.isFinite(raw)) ? parseFloat(raw.toFixed(6)) : null;
        var scoreMap = _lastResult.factorScores.get(f.id) || new Map();
        var sc = scoreMap.get(geoid);
        props[f.id + "_score"] = sc != null ? sc : null;
      });
      return { type: "Feature", properties: props, geometry: geo.geometry };
    });
    _triggerDownload(
      JSON.stringify({ type: "FeatureCollection", features: features }, null, 2),
      "application/geo+json",
      "tpi-export-" + _dateStamp() + ".geojson"
    );
  }

  function exportCSV() {
    if (!_lastResult) return;
    var factors = TPI.FACTORS;
    var header = ["GEOID", "tpiScore", "tpiClass"];
    factors.forEach(function (f) { header.push(f.id + "_raw", f.id + "_score"); });
    var rows = [header.join(",")];

    _lastResult.geoids.forEach(function (geoid) {
      var sd = _lastResult.scores.get(geoid);
      var composite = (sd && Number.isFinite(sd.composite)) ? sd.composite : null;
      var row = [
        geoid,
        composite != null ? composite.toFixed(4) : "",
        composite != null ? getTpiClass(composite) : ""
      ];
      factors.forEach(function (f) {
        var rawMap = _lastResult.rawValues.get(f.id) || new Map();
        var raw = rawMap.get(geoid);
        row.push((raw != null && Number.isFinite(raw)) ? raw.toFixed(6) : "");
        var scoreMap = _lastResult.factorScores.get(f.id) || new Map();
        var sc = scoreMap.get(geoid);
        row.push(sc != null ? String(sc) : "");
      });
      rows.push(row.join(","));
    });
    _triggerDownload(rows.join("\n"), "text/csv", "tpi-export-" + _dateStamp() + ".csv");
  }

  // ---- Project init (called once on first popup open) ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Wire "Compute TPI" button
    var runBtn = document.getElementById("tpiRun");
    if (runBtn) runBtn.addEventListener("click", function () { runTPI(); });

    // Wire reset weights button
    var resetBtn = document.getElementById("tpiResetWeights");
    if (resetBtn) resetBtn.addEventListener("click", resetWeights);

    // Wire show legend button
    var legendBtn = document.getElementById("tpiShowLegend");
    if (legendBtn) {
      legendBtn.addEventListener("click", function () {
        App.popup.showFloatingWidget("tpi-legend", "projects/tpi-legend.html", {
          position: "bottom-left",
          width: 160,
          title: "TPI Legend"
        });
      });
    }

    // Wire export buttons
    var exportGeoJSONBtn = document.getElementById("tpiExportGeoJSON");
    if (exportGeoJSONBtn) exportGeoJSONBtn.addEventListener("click", exportGeoJSON);

    var exportCSVBtn = document.getElementById("tpiExportCSV");
    if (exportCSVBtn) exportCSVBtn.addEventListener("click", exportCSV);

    // Build weight sliders
    buildWeightSliders();
  }

  // ---- Popup lifecycle hooks ----

  function onOpen(core) {
    // Refresh display from current state each time popup opens
    if (_lastResult) {
      displayResults(_lastResult);
    }
    if (_stale) {
      markStale();
    }
    updateWeightSum();
  }

  function onClose(core) {
    // No cleanup needed — state persists in closure
  }

  // ---- Module update (called on feature changes, even when popup is closed) ----

  async function update(core) {
    if (_lastResult && !core.getUnion()) {
      clearChoropleth();
    } else {
      markStale();
    }
  }

  // ---- Register as analysis module ----

  App.registerModule({
    id: "transit-propensity",
    name: "Transit Propensity Index",
    enabled: true,
    popupWidth: 760,
    popupHTML: "projects/transit-propensity-popup.html",

    floatingWidgets: [
      { id: "tpi-legend", htmlFile: "projects/tpi-legend.html", position: "bottom-left", width: 160 }
    ],

    init: function (core) {
      init(core);
    },

    onOpen: function (core) {
      onOpen(core);
    },

    onClose: function (core) {
      onClose(core);
    },

    clear: function () {
      clearChoropleth();
    },

    update: async function (core) {
      await update(core);
    }
  });

})();
