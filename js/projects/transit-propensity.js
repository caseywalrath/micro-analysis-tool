// js/projects/transit-propensity.js
// Transit Propensity Index project: registers with App, builds weight sliders,
// runs TPI scoring engine, displays results summary.
// Depends on: App namespace, TPI namespace (tpi-scoring.js), turf (CDN).
// Exports: none (self-registers via App.registerProject)

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var TPI = window.TPI;

  // ---- Project-local state ----

  var _lastResult = null; // last TPI computation result
  var _weights = TPI.getDefaultWeights(); // current weight settings
  var _stale = false; // true when features changed since last compute

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
    var val = parseInt(e.target.value, 10);
    _weights[factorId] = val;

    var label = document.getElementById("tpiW_" + factorId);
    if (label) label.textContent = String(val);

    updateWeightSum();
    markStale();
  }

  function updateWeightSum() {
    var sum = 0;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      sum += (_weights[factors[i].id] || 0);
    }

    var sumEl = document.getElementById("tpiWeightSum");
    var warnEl = document.getElementById("tpiWeightWarn");
    if (sumEl) sumEl.textContent = String(sum);

    if (warnEl) {
      if (sum !== 100) {
        warnEl.style.display = "";
        if (sumEl) sumEl.style.color = "#e53e3e";
      } else {
        warnEl.style.display = "none";
        if (sumEl) sumEl.style.color = "";
      }
    }
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
    var statusEl = document.getElementById("tpiStatus");
    var textEl = document.getElementById("tpiStatusText");
    if (statusEl && textEl) {
      statusEl.style.display = "";
      textEl.textContent = "Data has changed — re-run to update scores.";
      statusEl.className = "tpi-status tpi-status-stale";
    }
  }

  // ---- Run TPI ----

  var _running = false;

  async function runTPI() {
    if (_running) return;
    _running = true;

    var statusEl = document.getElementById("tpiStatus");
    var textEl = document.getElementById("tpiStatusText");
    var resultsEl = document.getElementById("tpiResults");
    var runBtn = document.getElementById("tpiRun");

    if (runBtn) runBtn.disabled = true;
    if (statusEl) { statusEl.style.display = ""; statusEl.className = "tpi-status"; }

    try {
      var geoLevel = document.getElementById("geoLevel").value;
      var year = document.getElementById("yearSelect").value;

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

      // Render choropleth
      renderChoropleth(result);

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
      if (runBtn) runBtn.disabled = false;
    }
  }

  // ---- Display results summary ----

  function displayResults(result) {
    var resultsEl = document.getElementById("tpiResults");
    if (!resultsEl) return;
    resultsEl.style.display = "";

    // Geography count
    var geoCountEl = document.getElementById("tpiGeoCount");
    if (geoCountEl) {
      var geoLabel = (document.getElementById("geoLevel").value === "tract") ? "tracts" : "block groups";
      geoCountEl.textContent = result.geoids.length + " " + geoLabel;
    }

    // Per-factor summary
    var summaryEl = document.getElementById("tpiFactorSummary");
    if (summaryEl) {
      var html = "";
      var factors = TPI.FACTORS;
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

        html +=
          '<div class="tpi-factor-row">' +
            '<span class="tpi-factor-name">' + f.label + '</span>' +
            '<span class="tpi-factor-weight">' + Math.round(w) + '%</span>' +
            '<span class="tpi-factor-score ' + statusClass + '">' + statusLabel + '</span>' +
          '</div>';
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
      compositeAvgEl.textContent = Number.isFinite(compAvg) ? compAvg.toFixed(2) + " / 5" : "—";
    }

    if (scoredCountEl) {
      var scored = 0;
      for (var entry3 of result.scores.values()) {
        if (Number.isFinite(entry3.composite)) scored++;
      }
      scoredCountEl.textContent = String(scored) + " / " + result.geoids.length;
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
          // Copy factor scores for tooltip
          factors: scoreData ? scoreData.factors : {}
        },
        geometry: geo.geometry
      });
    }

    var fc = { type: "FeatureCollection", features: features };

    // Color ramp: 1 (low propensity) -> 5 (high propensity)
    // Blue (low) -> Yellow -> Red (high)
    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "tpiScore"], 0],
      0, "rgba(200,200,200,0.3)",  // no score -> light gray
      1, "#2166ac",                // low -> blue
      2, "#67a9cf",
      3, "#fddbc7",               // mid -> warm
      4, "#ef8a62",
      5, "#b2182b"                 // high -> red
    ];

    if (!map.getSource(TPI_SOURCE)) {
      map.addSource(TPI_SOURCE, { type: "geojson", data: fc });

      // Insert fill below buffers-fill so buffers render on top
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
          var geoid = props.GEOID || "—";

          var html = '<div style="font-size:12px;line-height:1.4;">';
          html += '<b>GEOID:</b> ' + geoid + '<br>';
          html += '<b>TPI Score:</b> ' + (score != null ? Number(score).toFixed(2) : 'N/A') + ' / 5';

          // Factor breakdown
          var factors = null;
          try { factors = JSON.parse(props.factors); } catch (_) {}
          if (factors) {
            html += '<br><span style="color:#666;font-size:11px;">';
            var fNames = TPI.FACTORS;
            for (var fi = 0; fi < fNames.length; fi++) {
              var fval = factors[fNames[fi].id];
              if (fval != null) {
                html += fNames[fi].label + ': ' + fval + '/5<br>';
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

  // ---- Legend rendering ----

  function ensureLegend() {
    if (document.getElementById("tpi-legend")) return;

    var legend = document.createElement("div");
    legend.id = "tpi-legend";
    legend.className = "tpi-legend";
    legend.innerHTML =
      '<div class="tpi-legend-title">Transit Propensity</div>' +
      '<div class="tpi-legend-row">' +
        '<span class="tpi-legend-swatch" style="background:#2166ac;"></span>' +
        '<span>1 — Low</span>' +
      '</div>' +
      '<div class="tpi-legend-row">' +
        '<span class="tpi-legend-swatch" style="background:#67a9cf;"></span>' +
        '<span>2</span>' +
      '</div>' +
      '<div class="tpi-legend-row">' +
        '<span class="tpi-legend-swatch" style="background:#fddbc7;"></span>' +
        '<span>3</span>' +
      '</div>' +
      '<div class="tpi-legend-row">' +
        '<span class="tpi-legend-swatch" style="background:#ef8a62;"></span>' +
        '<span>4</span>' +
      '</div>' +
      '<div class="tpi-legend-row">' +
        '<span class="tpi-legend-swatch" style="background:#b2182b;"></span>' +
        '<span>5 — High</span>' +
      '</div>';

    // Insert into map container
    var mapContainer = document.getElementById("map");
    if (mapContainer) mapContainer.appendChild(legend);
  }

  function removeLegend() {
    var el = document.getElementById("tpi-legend");
    if (el) el.remove();
  }

  // ---- Project init ----

  function init(core) {
    // Wire "Compute TPI" button
    var runBtn = document.getElementById("tpiRun");
    if (runBtn) {
      runBtn.addEventListener("click", function () {
        runTPI();
      });
    }

    // Wire reset weights button
    var resetBtn = document.getElementById("tpiResetWeights");
    if (resetBtn) {
      resetBtn.addEventListener("click", resetWeights);
    }

    // Build weight sliders
    buildWeightSliders();
  }

  // ---- Project update (called on feature changes) ----

  async function update(core) {
    markStale();
  }

  // ---- Register project ----

  App.registerProject({
    id: "transit-propensity",
    name: "Transit Propensity Index",
    panelHTML: "projects/transit-propensity.html",

    panels: [
      {
        id: "tpi-weights",
        title: "TPI Weights",
        htmlFile: "projects/tpi-weights.html",
        collapsed: true,
        order: 31
      }
    ],

    init: function (core) {
      init(core);
    },

    update: async function (core) {
      await update(core);
    }
  });

})();
