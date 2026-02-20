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

  function getTpiClass(score) {
    if (!Number.isFinite(score)) return "N/A";
    if (score < 2) return "Low";
    if (score < 3) return "Medium-Low";
    if (score < 4) return "Medium";
    if (score < 5) return "Medium-High";
    return "High";
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
  var _rescoreTimer = null;

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

    var compositeMaxEl = document.getElementById("tpiCompositeMax");
    if (compositeMaxEl) {
      var compMax = NaN;
      for (var entry4 of result.scores.values()) {
        if (Number.isFinite(entry4.composite) && (isNaN(compMax) || entry4.composite > compMax))
          compMax = entry4.composite;
      }
      compositeMaxEl.textContent = Number.isFinite(compMax) ? compMax.toFixed(2) + " / 5" : "—";
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

    // Color ramp: ColorBrewer Blues (sequential), 1=lightest → 5=darkest
    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "tpiScore"], 0],
      0, "rgba(200,200,200,0.3)",  // no score -> light gray
      1, "#eff3ff",                // low
      2, "#bdd7e7",
      3, "#6baed6",               // mid
      4, "#3182bd",
      5, "#08519c"                 // high
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

  function clearChoropleth() {
    removeChoropleth();
    _lastResult = null; _stale = false;
    var resultsEl = document.getElementById("tpiResults");
    if (resultsEl) resultsEl.style.display = "none";
    var statusEl = document.getElementById("tpiStatus");
    if (statusEl) statusEl.style.display = "none";
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

    // Wire clear choropleth button
    var clearBtn = document.getElementById("tpiClearChoropleth");
    if (clearBtn) clearBtn.addEventListener("click", clearChoropleth);

    // Wire export buttons
    var exportGeoJSONBtn = document.getElementById("tpiExportGeoJSON");
    if (exportGeoJSONBtn) exportGeoJSONBtn.addEventListener("click", exportGeoJSON);

    var exportCSVBtn = document.getElementById("tpiExportCSV");
    if (exportCSVBtn) exportCSVBtn.addEventListener("click", exportCSV);

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
      { id: "tpi-weights", title: "TPI Weights", htmlFile: "projects/tpi-weights.html", collapsed: true,  order: 31 },
      { id: "tpi-legend",  title: "TPI Legend",  htmlFile: "projects/tpi-legend.html",  collapsed: false, order: 32 }
    ],

    init: function (core) {
      init(core);
    },

    update: async function (core) {
      await update(core);
    }
  });

})();
