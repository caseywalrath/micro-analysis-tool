// js/projects/corridor-scoring.js
// Corridor Scoring: registers as an analysis module, opens in a 2-column popup,
// produces a ranked composite score per selected corridor using the per-route CDI engine.
// Depends on: App namespace, TPI namespace (tpi-scoring.js), RidershipModel (ridership-scoring.js),
//   App.popup (popup.js), turf (CDN).
// Step 1: scaffolding + static Settings column.
// No public API.

(function () {
  "use strict";
  var App = window.App = window.App || {};
  var TPI = window.TPI;

  // ---- Module-local state (persists across popup open/close) ----

  var _weights           = TPI ? TPI.getDefaultWeights() : {};
  var _pendingWeights    = null;   // temp copy while Adjust Weights modal is open (Step 2)
  var _featureFilter     = null;   // { routeIndices, lineIndices } or null (= all)
  var _lastResult        = null;   // { routeCDIs, geoLevel, year, apportionByArea, unionPolygon, weights } (Step 3+)
  var _stale             = false;
  var _running           = false;
  var _initialized       = false;
  var _apportionByArea   = false;

  // ---- DOM guard: only touch DOM when popup is open for this module ----

  function isPopupVisible() {
    return App.popup && App.popup.isOpen() && App.popup.currentModuleId() === "corridor-scoring";
  }

  // ---- Feature filter helpers (routes + lines only per plan) ----

  function buildUnionFromFilter(filter) {
    // null filter means "all corridors selected" — build union from every
    // route and line buffer.  We cannot pass null to RM.buildUnionFromFeatures
    // because that function treats null as "no features" and returns null.
    var polys = [];
    var routeBuffers = App.routeBuffers || [];
    var lineBuffers  = App.lineBuffers  || [];
    var i, idx;

    if (!filter) {
      for (i = 0; i < routeBuffers.length; i++) {
        if (routeBuffers[i]) polys.push(routeBuffers[i]);
      }
      for (i = 0; i < lineBuffers.length; i++) {
        if (lineBuffers[i]) polys.push(lineBuffers[i]);
      }
    } else {
      if (filter.routeIndices) {
        for (i = 0; i < filter.routeIndices.length; i++) {
          idx = filter.routeIndices[i];
          if (routeBuffers[idx]) polys.push(routeBuffers[idx]);
        }
      }
      if (filter.lineIndices) {
        for (i = 0; i < filter.lineIndices.length; i++) {
          idx = filter.lineIndices[i];
          if (lineBuffers[idx]) polys.push(lineBuffers[idx]);
        }
      }
    }

    if (!polys.length) return null;
    var union = polys[0];
    for (i = 1; i < polys.length; i++) {
      try { union = turf.union(union, polys[i]); } catch (e) { /* skip */ }
    }
    return union;
  }

  function getFeatureFilter() {
    var el = document.getElementById("csFeatureList");
    if (!el) return null;
    var boxes = el.querySelectorAll("input[type=checkbox]");
    if (!boxes.length) return null;
    var routeIndices = [], lineIndices = [];
    var allChecked = true;
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      var type = cb.getAttribute("data-type");
      var idx  = parseInt(cb.getAttribute("data-idx"), 10);
      if (cb.checked) {
        if      (type === "route") routeIndices.push(idx);
        else if (type === "line")  lineIndices.push(idx);
      } else {
        allChecked = false;
      }
    }
    if (allChecked) return null; // no filter needed (all selected)
    return { routeIndices: routeIndices, lineIndices: lineIndices };
  }

  // ---- Feature checklist (routes + lines) ----

  function buildFeatureChecklist() {
    var el = document.getElementById("csFeatureList");
    if (!el) return;

    // Capture current check state before rebuilding
    var prevState = {};
    var prev = el.querySelectorAll("input[type=checkbox]");
    for (var pi = 0; pi < prev.length; pi++) {
      prevState[prev[pi].getAttribute("data-type") + ":" + prev[pi].getAttribute("data-idx")] = prev[pi].checked;
    }

    el.innerHTML = "";
    var hasFeatures = false;

    function addRow(type, idx, name, badge) {
      hasFeatures = true;
      var key = type + ":" + idx;
      var checked = (key in prevState) ? prevState[key] : true;
      var row = document.createElement("div");
      row.className = "rf-feature-check-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-type", type);
      cb.setAttribute("data-idx", String(idx));
      cb.checked = checked;

      var lbl = document.createElement("label");
      lbl.style.cssText = "flex:1;cursor:pointer;";
      lbl.textContent = name;

      var badgeEl = document.createElement("span");
      badgeEl.className = "rf-feature-type-badge";
      badgeEl.textContent = badge;

      lbl.addEventListener("click", function (e) { e.preventDefault(); cb.checked = !cb.checked; markStale(); });
      cb.addEventListener("change", markStale);

      row.appendChild(cb);
      row.appendChild(lbl);
      row.appendChild(badgeEl);
      el.appendChild(row);
    }

    var routes = App.routes || [];
    var lines  = App.lines  || [];

    for (var ri = 0; ri < routes.length; ri++) {
      addRow("route", ri,
        (routes[ri].properties && routes[ri].properties.name) || ("Route " + (ri + 1)),
        "R");
    }
    for (var li = 0; li < lines.length; li++) {
      addRow("line", li,
        (lines[li].properties && lines[li].properties.name) || ("Line " + (li + 1)),
        "L");
    }

    if (!hasFeatures) {
      el.innerHTML = '<div style="padding:6px;color:var(--muted);font-size:12px;">No routes or lines drawn.</div>';
    }
  }

  // ---- Weight sliders (inside modal) ----

  function buildWeightSliders() {
    var container = document.getElementById("csWeightSliders");
    if (!container || !TPI) return;
    container.innerHTML = "";

    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (_weights[f.id] != null) ? _weights[f.id] : (f.defaultWeight || 0);

      var row = document.createElement("div");
      row.className = "tpi-slider-row";
      row.innerHTML =
        '<label class="tpi-slider-label" title="' + (f.description || "") + '">' + f.label + '</label>' +
        '<input type="range" class="tpi-slider cs-slider" min="0" max="100" step="5" value="' + w + '" data-factor="' + f.id + '">' +
        '<input type="number" class="tpi-slider-value" id="csW_' + f.id + '" value="' + w + '" min="0" max="100" step="1" data-factor="' + f.id + '">';
      container.appendChild(row);

      var slider   = row.querySelector("input[type=range]");
      var numInput = row.querySelector("input[type=number]");
      slider.addEventListener("input",  onModalSliderChange);
      numInput.addEventListener("change", onModalNumberChange);
    }
    updateModalWeightSum();
  }

  function syncSlidersToWeights(weights) {
    if (!TPI) return;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (weights[f.id] != null) ? weights[f.id] : 0;
      var slider   = document.querySelector('.cs-slider[data-factor="' + f.id + '"]');
      var numInput = document.getElementById("csW_" + f.id);
      if (slider)   slider.value   = String(w);
      if (numInput) numInput.value = String(w);
    }
    updateModalWeightSum();
  }

  function onModalSliderChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    _pendingWeights[factorId] = parseInt(e.target.value, 10);
    var numInput = document.getElementById("csW_" + factorId);
    if (numInput) numInput.value = String(_pendingWeights[factorId]);
    updateModalWeightSum();
  }

  function onModalNumberChange(e) {
    if (!_pendingWeights) return;
    var factorId = e.target.getAttribute("data-factor");
    var raw      = parseInt(e.target.value, 10);
    var clamped  = isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw));
    e.target.value = String(clamped);
    _pendingWeights[factorId] = clamped;
    var slider = document.querySelector('.cs-slider[data-factor="' + factorId + '"]');
    if (slider) slider.value = String(clamped);
    updateModalWeightSum();
  }

  function updateModalWeightSum() {
    if (!TPI) return 0;
    var weights = _pendingWeights || _weights;
    var sum = 0;
    var factors = TPI.FACTORS;
    for (var i = 0; i < factors.length; i++) sum += (weights[factors[i].id] || 0);

    var sumEl      = document.getElementById("csWeightSum");
    var warnEl     = document.getElementById("csWeightWarn");
    var confirmBtn = document.getElementById("csWeightsConfirm");
    if (sumEl)      { sumEl.textContent = String(sum); sumEl.style.color = sum === 100 ? "" : "#e53e3e"; }
    if (warnEl)     warnEl.style.visibility = sum === 100 ? "hidden" : "visible";
    if (confirmBtn) confirmBtn.disabled = (sum !== 100);
    return sum;
  }

  function openWeightsModal() {
    _pendingWeights = Object.assign({}, _weights);
    syncSlidersToWeights(_pendingWeights);
    var modal = document.getElementById("csWeightsModal");
    if (modal) modal.style.display = "";
  }

  function closeWeightsModal(confirm) {
    var modal = document.getElementById("csWeightsModal");
    if (modal) modal.style.display = "none";
    if (confirm && _pendingWeights) {
      var oldJSON = JSON.stringify(_weights);
      _weights    = Object.assign({}, _pendingWeights);
      if (JSON.stringify(_weights) !== oldJSON) markStale();
    }
    _pendingWeights = null;
  }

  function resetModalToDefaults() {
    if (!TPI) return;
    _pendingWeights = TPI.getDefaultWeights();
    syncSlidersToWeights(_pendingWeights);
  }

  // ---- LODES warning icon visibility ----

  function updateLodesWarnings() {
    var warnBtn = document.getElementById("csLodesWarnBtn");
    if (warnBtn) warnBtn.style.display = App.lodesData ? "none" : "";
  }

  // ---- Status + stale helpers ----

  function setStatus(msg, kind) {
    // kind: "" | "done" | "stale" | "running"
    var statusEl = document.getElementById("csStatus");
    var textEl   = document.getElementById("csStatusText");
    if (!statusEl || !textEl) return;
    statusEl.style.display = msg ? "" : "none";
    textEl.textContent = msg || "";
    statusEl.className = "rf-status" +
      (kind === "done"  ? " rf-status-done"  :
       kind === "stale" ? " rf-status-stale" : "");
  }

  function markStale() {
    _stale = true;
    setExportButtonsEnabled(false);
    if (!isPopupVisible()) return;
    if (_lastResult) {
      setStatus("Inputs changed — re-run to refresh scores.", "stale");
    }
  }

  // ---- Exports ----

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

  function _csvField(val) {
    if (val == null) return "";
    var s = String(val);
    if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function _buildMetadata() {
    return {
      tool:            "Micro Analysis Tool",
      module:          "Corridor Scoring",
      exportedAt:      new Date().toISOString(),
      geoLevel:        _lastResult ? _lastResult.geoLevel : null,
      acsYear:         _lastResult ? _lastResult.year     : null,
      apportionByArea: _lastResult ? _lastResult.apportionByArea : false,
      weights:         _lastResult ? _lastResult.weights  : null
    };
  }

  function exportCSV() {
    if (!_lastResult) return;
    var factors = TPI ? TPI.FACTORS : [];
    var rows    = _lastResult.routeCDIs || [];
    var meta    = _buildMetadata();

    var header = [
      "rank", "name", "feature_type", "feature_index",
      "cdi_score", "classification", "length_mi", "geo_count",
      "composite_min", "composite_max"
    ];
    for (var fi = 0; fi < factors.length; fi++) {
      header.push(factors[fi].id + "_avg_quintile");
    }

    var lines = [];
    lines.push("# Micro Analysis Tool — Corridor Scoring Export");
    lines.push("# Exported: "        + meta.exportedAt);
    lines.push("# Geography: "       + (meta.geoLevel || ""));
    lines.push("# ACS Year: "        + (meta.acsYear  || ""));
    lines.push("# Apportion by area: " + (meta.apportionByArea ? "yes" : "no"));
    lines.push(header.join(","));

    for (var i = 0; i < rows.length; i++) {
      var r  = rows[i];
      var cr = r.compositeRange || {};
      var row = [
        i + 1,
        _csvField(r.name),
        r.featureType || "",
        r.featureIndex != null ? r.featureIndex : "",
        Number.isFinite(r.cdi) ? r.cdi.toFixed(4) : "",
        _csvField(r.classification || ""),
        Number.isFinite(r.lengthMiles) ? r.lengthMiles.toFixed(4) : "",
        r.geoCount != null ? r.geoCount : "",
        Number.isFinite(cr.min) ? cr.min.toFixed(4) : "",
        Number.isFinite(cr.max) ? cr.max.toFixed(4) : ""
      ];
      var fb = r.factorBreakdown || {};
      for (var fj = 0; fj < factors.length; fj++) {
        var v = fb[factors[fj].id];
        row.push(Number.isFinite(v) ? v.toFixed(3) : "");
      }
      lines.push(row.join(","));
    }

    _triggerDownload(lines.join("\n"), "text/csv",
      "corridor-scoring-" + _dateStamp() + ".csv");
  }

  function exportGeoJSON() {
    if (!_lastResult) return;
    var rows = _lastResult.routeCDIs || [];
    var features = [];

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var src = getFeatureSourceGeom(r.featureType, r.featureIndex);
      if (!src || !src.geometry) continue;
      features.push({
        type: "Feature",
        geometry: src.geometry,
        properties: {
          name:             r.name,
          cdi:              Number.isFinite(r.cdi) ? parseFloat(r.cdi.toFixed(4)) : null,
          classification:   r.classification || "N/A",
          rank:             i + 1,
          featureType:      r.featureType,
          featureIndex:     r.featureIndex,
          lengthMiles:      Number.isFinite(r.lengthMiles) ? parseFloat(r.lengthMiles.toFixed(4)) : null,
          geoCount:         r.geoCount != null ? r.geoCount : null,
          compositeRange:   r.compositeRange || null,
          factorBreakdown:  r.factorBreakdown || {}
        }
      });
    }

    var geojson = {
      type: "FeatureCollection",
      metadata: _buildMetadata(),
      features: features
    };
    _triggerDownload(
      JSON.stringify(geojson, null, 2),
      "application/geo+json",
      "corridor-scoring-" + _dateStamp() + ".geojson"
    );
  }

  function setExportButtonsEnabled(enabled) {
    var csvBtn = document.getElementById("csExportCSV");
    var gjBtn  = document.getElementById("csExportGeoJSON");
    if (csvBtn) csvBtn.disabled = !enabled;
    if (gjBtn)  gjBtn.disabled  = !enabled;
  }

  // ---- Map choropleth (scored corridors colored by composite CDI) ----

  var CS_SOURCE      = "corridor-scoring-routes";
  var CS_LINE_LAYER  = "corridor-scoring-routes-layer";

  function getFeatureSourceGeom(featureType, idx) {
    if (featureType === "route") return (App.routes && App.routes[idx]) || null;
    if (featureType === "line")  return (App.lines  && App.lines[idx])  || null;
    return null;
  }

  function buildScoredFeatureCollection(result) {
    var features = [];
    var rows = (result && result.routeCDIs) || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var src = getFeatureSourceGeom(r.featureType, r.featureIndex);
      if (!src || !src.geometry) continue;
      features.push({
        type: "Feature",
        geometry: src.geometry,
        properties: {
          name:           r.name,
          cdi:            Number.isFinite(r.cdi) ? r.cdi : null,
          classification: r.classification || "N/A",
          rank:           i + 1,
          featureType:    r.featureType,
          featureIndex:   r.featureIndex
        }
      });
    }
    return { type: "FeatureCollection", features: features };
  }

  function renderMapChoropleth(result) {
    var map = App.map;
    if (!map || !result) return;
    var fc = buildScoredFeatureCollection(result);

    var colorExpr = [
      "interpolate", ["linear"], ["coalesce", ["get", "cdi"], 0],
      0, "rgba(200,200,200,0.6)",
      1, "#eff3ff",
      2, "#bdd7e7",
      3, "#6baed6",
      4, "#3182bd",
      5, "#08519c"
    ];

    if (!map.getSource(CS_SOURCE)) {
      map.addSource(CS_SOURCE, { type: "geojson", data: fc });
      map.addLayer({
        id: CS_LINE_LAYER,
        type: "line",
        source: CS_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color":  colorExpr,
          "line-width":  5,
          "line-opacity": 0.9
        }
      });

      // Hover tooltip
      var hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", CS_LINE_LAYER, function (e) {
        map.getCanvas().style.cursor = "pointer";
        if (!e.features || !e.features.length) return;
        var p = e.features[0].properties;
        var cdi = p.cdi != null ? Number(p.cdi).toFixed(2) : "N/A";
        var html = '<div style="font-size:12px;line-height:1.4;">' +
          '<b>#' + p.rank + '</b> &mdash; ' + (p.name || "") + '<br>' +
          '<b>Score:</b> ' + cdi + ' &mdash; ' + (p.classification || "N/A") +
          '</div>';
        hover.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on("mouseleave", CS_LINE_LAYER, function () {
        map.getCanvas().style.cursor = App.drawMode ? "crosshair" : "grab";
        hover.remove();
      });
    } else {
      map.getSource(CS_SOURCE).setData(fc);
    }
  }

  function clearMapChoropleth() {
    var map = App.map;
    if (!map) return;
    if (map.getLayer(CS_LINE_LAYER)) map.removeLayer(CS_LINE_LAYER);
    if (map.getSource(CS_SOURCE))    map.removeSource(CS_SOURCE);
  }

  // ---- Factor breakdown (per-corridor expansion) ----

  // System-wide average quintile per factor — used as comparison baseline.
  function computeSystemFactorAverages(tpiResult) {
    var avgs = {};
    if (!tpiResult || !tpiResult.factorScores) return avgs;
    var iter = tpiResult.factorScores.entries();
    var entry = iter.next();
    while (!entry.done) {
      var factorId = entry.value[0];
      var scoreMap = entry.value[1];
      var sum = 0, count = 0;
      var valIter = scoreMap.values();
      var v = valIter.next();
      while (!v.done) {
        if (Number.isFinite(v.value)) { sum += v.value; count++; }
        v = valIter.next();
      }
      avgs[factorId] = count > 0 ? sum / count : NaN;
      entry = iter.next();
    }
    return avgs;
  }

  function buildFactorBreakdownHTML(routeCDI, systemAvgs, effectiveWeights) {
    if (!TPI) return "";
    var factors = TPI.FACTORS;
    var breakdown = (routeCDI && routeCDI.factorBreakdown) || {};
    var html = '<div class="rf-route-factor-list">';

    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      var w = (effectiveWeights && effectiveWeights[f.id] != null) ? effectiveWeights[f.id] : 0;
      if (w === 0) continue;

      var routeAvg = breakdown[f.id];
      var sysAvg   = systemAvgs ? systemAvgs[f.id] : NaN;
      var rValid   = Number.isFinite(routeAvg);
      var sValid   = Number.isFinite(sysAvg);

      var routeBarPct  = rValid ? ((routeAvg - 1) / 4) * 100 : 0;
      var sysMarkerPct = sValid ? ((sysAvg   - 1) / 4) * 100 : 0;

      var diff = (rValid && sValid) ? routeAvg - sysAvg : 0;
      var barColor = diff > 0.3 ? "#48bb78" : (diff < -0.3 ? "#f56565" : "#a0aec0");

      html += '<div class="rf-route-factor-row">' +
        '<span class="rf-route-factor-name" title="' + escapeHTML(f.description || f.label) + '">' + escapeHTML(f.label) + '</span>' +
        '<span class="rf-route-factor-weight tiny">' + Math.round(w) + '%</span>' +
        '<span class="rf-route-factor-bar-wrap">' +
          '<span class="rf-route-factor-bar" style="width:' + routeBarPct.toFixed(0) + '%;background:' + barColor + ';" ' +
            'title="Corridor: ' + (rValid ? routeAvg.toFixed(1) : 'N/A') + ' / System: ' + (sValid ? sysAvg.toFixed(1) : 'N/A') + '"></span>' +
          (sValid ? '<span class="rf-route-factor-sys-marker" style="left:' + sysMarkerPct.toFixed(0) + '%;" title="System avg: ' + sysAvg.toFixed(1) + '"></span>' : '') +
        '</span>' +
        '<span class="rf-route-factor-score">' + (rValid ? routeAvg.toFixed(1) : 'N/A') + '</span>' +
        '</div>';
    }

    html += '</div>';
    return html;
  }

  // ---- Results table ----

  function pillClassFor(label) {
    switch (label) {
      case "High":        return "pill high";
      case "Medium":      return "pill med";
      case "Low-Medium":  return "pill ml";
      case "Low":         return "pill low";
      default:            return "pill na";
    }
  }

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatScore(cdi) {
    return Number.isFinite(cdi) ? cdi.toFixed(2) : "—";
  }

  function renderResultsTable(result) {
    var container = document.getElementById("csResultsTable");
    var resultsWrap = document.getElementById("csResults");
    var emptyState  = document.getElementById("csEmptyState");
    if (!container || !resultsWrap) return;

    var rows = (result && result.routeCDIs) || [];

    if (emptyState)  emptyState.style.display  = rows.length ? "none" : "";
    resultsWrap.style.display = rows.length ? "" : "none";

    if (!rows.length) { container.innerHTML = ""; return; }

    var systemAvgs = (result.tpiResult && result.tpiResult.__restoredSystemAverages)
      ? result.tpiResult.__restoredSystemAverages
      : computeSystemFactorAverages(result.tpiResult);
    var effWeights = (result.tpiResult && result.tpiResult.effectiveWeights) || result.weights || _weights;

    var html = '<table class="cs-results-table">' +
      '<thead><tr>' +
        '<th class="cs-col-rank">#</th>' +
        '<th class="cs-col-name">Corridor</th>' +
        '<th class="cs-col-score">Score</th>' +
        '<th class="cs-col-class">Classification</th>' +
        '<th class="cs-col-toggle" aria-label="Expand"></th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rank = i + 1;
      var pill = pillClassFor(r.classification);
      html +=
        '<tr class="cs-row" data-index="' + i + '">' +
          '<td class="cs-rank">' + rank + '</td>' +
          '<td class="cs-name">' + escapeHTML(r.name) +
            ' <span class="cs-feature-badge">' + (r.featureType === "line" ? "L" : "R") + '</span></td>' +
          '<td class="cs-score">' + formatScore(r.cdi) + '</td>' +
          '<td class="cs-class"><span class="' + pill + '">' + escapeHTML(r.classification || "N/A") + '</span></td>' +
          '<td class="cs-toggle"><span class="cs-caret">&#9656;</span></td>' +
        '</tr>' +
        '<tr class="cs-row-details" data-index="' + i + '" style="display:none;">' +
          '<td colspan="5">' +
            '<div class="cs-details-body">' +
              buildFactorBreakdownHTML(r, systemAvgs, effWeights) +
            '</div>' +
          '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Wire row click → toggle details
    var rowEls = container.querySelectorAll("tr.cs-row");
    rowEls.forEach(function (rowEl) {
      rowEl.addEventListener("click", function () {
        var idx = rowEl.getAttribute("data-index");
        var details = container.querySelector('tr.cs-row-details[data-index="' + idx + '"]');
        if (!details) return;
        var open = details.style.display !== "none";
        details.style.display = open ? "none" : "";
        rowEl.classList.toggle("cs-row-open", !open);
      });
    });
  }

  // ---- Scoring flow ----

  async function runScoring() {
    if (_running) return;
    var RM = window.RidershipModel;
    if (!RM || typeof RM.computeSystemDemand !== "function") {
      setStatus("RidershipModel not available.", "stale");
      return;
    }

    _running = true;
    var scoreBtn = document.getElementById("csScoreBtn");
    if (scoreBtn) scoreBtn.disabled = true;
    setStatus("Scoring…", "running");
    clearMapChoropleth(); // wipe any prior run so selection changes are visible

    try {
      var geoLevel = document.getElementById("csGeoLevel").value;
      var year     = document.getElementById("csYearSelect").value;

      var featureFilter = getFeatureFilter();
      var unionPolygon  = buildUnionFromFilter(featureFilter);

      if (!unionPolygon) {
        throw new Error("No corridors selected. Check at least one route or line.");
      }

      var result = await RM.computeSystemDemand({
        geoLevel:        geoLevel,
        year:            year,
        weights:         _weights,
        lodesData:       App.lodesData,
        apportionByArea: _apportionByArea,
        unionPolygon:    unionPolygon,
        featureFilter:   featureFilter,
        onProgress: function (msg) { setStatus(msg, "running"); }
      });

      // Sort ranked corridors by CDI descending
      var ranked = (result.routeCDIs || []).slice().sort(function (a, b) {
        var av = Number.isFinite(a.cdi) ? a.cdi : -Infinity;
        var bv = Number.isFinite(b.cdi) ? b.cdi : -Infinity;
        return bv - av;
      });

      _lastResult = {
        routeCDIs:       ranked,
        tpiResult:       result.tpiResult,
        systemCDI:       result.systemCDI,
        geoLevel:        geoLevel,
        year:            year,
        apportionByArea: _apportionByArea,
        unionPolygon:    unionPolygon,
        featureFilter:   featureFilter,
        weights:         Object.assign({}, _weights)
      };
      _stale = false;

      var geoCount = (result.tpiResult && result.tpiResult.geos) ? result.tpiResult.geos.length : 0;
      setStatus("Scored " + ranked.length + " corridor" + (ranked.length === 1 ? "" : "s") +
                " — " + geoCount + " geographies.", "done");

      renderResultsTable(_lastResult);
      renderMapChoropleth(_lastResult);
      if (App.popup && App.popup.showFloatingWidget) {
        App.popup.showFloatingWidget("cs-legend", "projects/corridor-scoring-legend.html", {
          position: "bottom-left",
          width: 180,
          title: "Corridor Score"
        });
      }
      setExportButtonsEnabled(true);
    } catch (err) {
      console.error("Corridor Scoring error:", err);
      setStatus("Error: " + (err.message || err), "stale");
    } finally {
      _running = false;
      if (scoreBtn) scoreBtn.disabled = false;
    }
  }

  // ---- Popup lifecycle ----

  function init(core) {
    if (_initialized) return;
    _initialized = true;

    // Geography level change
    var geoLevel = document.getElementById("csGeoLevel");
    if (geoLevel) geoLevel.addEventListener("change", markStale);

    // ACS year change
    var yearSel = document.getElementById("csYearSelect");
    if (yearSel) yearSel.addEventListener("change", markStale);

    // Apportion-by-area checkbox
    var apportionCb = document.getElementById("csApportionByArea");
    if (apportionCb) {
      apportionCb.checked = _apportionByArea;
      apportionCb.addEventListener("change", function () {
        _apportionByArea = apportionCb.checked;
        markStale();
      });
    }

    // Select all / clear
    var selectAll = document.getElementById("csSelectAll");
    if (selectAll) {
      selectAll.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#csFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = true; });
        markStale();
      });
    }
    var selectNone = document.getElementById("csSelectNone");
    if (selectNone) {
      selectNone.addEventListener("click", function (e) {
        e.preventDefault();
        document.querySelectorAll("#csFeatureList input[type=checkbox]").forEach(function (cb) { cb.checked = false; });
        markStale();
      });
    }

    // Adjust Weights modal
    var weightsBtn = document.getElementById("csWeightsBtn");
    if (weightsBtn) weightsBtn.addEventListener("click", openWeightsModal);

    var confirmBtn = document.getElementById("csWeightsConfirm");
    if (confirmBtn) confirmBtn.addEventListener("click", function () { closeWeightsModal(true); });

    var cancelBtn = document.getElementById("csWeightsCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", function () { closeWeightsModal(false); });

    var resetBtn = document.getElementById("csResetWeights");
    if (resetBtn) resetBtn.addEventListener("click", resetModalToDefaults);

    // Score Corridors
    var scoreBtn = document.getElementById("csScoreBtn");
    if (scoreBtn) scoreBtn.addEventListener("click", runScoring);

    // Exports
    var csvBtn = document.getElementById("csExportCSV");
    if (csvBtn) csvBtn.addEventListener("click", exportCSV);
    var gjBtn = document.getElementById("csExportGeoJSON");
    if (gjBtn) gjBtn.addEventListener("click", exportGeoJSON);

    // Populate weight sliders (in modal) with current _weights
    buildWeightSliders();
  }

  function onOpen(core) {
    var apportionCb = document.getElementById("csApportionByArea");
    if (apportionCb) apportionCb.checked = _apportionByArea;

    buildFeatureChecklist();
    if (_featureFilter) applyFeatureFilterToCheckboxes(_featureFilter);
    updateLodesWarnings();

    if (_lastResult) {
      renderResultsTable(_lastResult);
      setExportButtonsEnabled(!_stale);
    } else {
      setExportButtonsEnabled(false);
    }
    if (_stale) markStale();
  }

  function onClose(core) {
    // State persists in closure
  }

  function clearAll() {
    clearMapChoropleth();
    if (App.popup && App.popup.hideFloatingWidget) App.popup.hideFloatingWidget("cs-legend");
    _lastResult = null;
    _stale = false;
    if (isPopupVisible()) {
      var resultsEl = document.getElementById("csResults");
      if (resultsEl) resultsEl.style.display = "none";
      var emptyEl = document.getElementById("csEmptyState");
      if (emptyEl) emptyEl.style.display = "";
      setStatus("");
      setExportButtonsEnabled(false);
    }
  }

  async function update(core) {
    // Fires on feature/LODES changes even when popup closed — guard DOM writes.
    if (!isPopupVisible()) return;
    buildFeatureChecklist();
    updateLodesWarnings();
  }

  // ---- Apply a saved feature filter to the DOM checklist ----

  function applyFeatureFilterToCheckboxes(filter) {
    var el = document.getElementById("csFeatureList");
    if (!el || !filter) return;
    var routeSet = new Set((filter.routeIndices || []).map(Number));
    var lineSet  = new Set((filter.lineIndices  || []).map(Number));
    var boxes = el.querySelectorAll("input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) {
      var cb = boxes[i];
      var type = cb.getAttribute("data-type");
      var idx  = parseInt(cb.getAttribute("data-idx"), 10);
      if (type === "route") cb.checked = routeSet.has(idx);
      if (type === "line")  cb.checked = lineSet.has(idx);
    }
  }

  // ---- Session persistence ----

  function saveCsState(mode) {
    // Prefer the live checklist state if the popup is initialized.
    var currentFilter = document.getElementById("csFeatureList") ? getFeatureFilter() : _featureFilter;
    var data = {
      version:         1,
      weights:         Object.assign({}, _weights),
      apportionByArea: _apportionByArea,
      featureFilter:   currentFilter ? JSON.parse(JSON.stringify(currentFilter)) : null,
      geoLevel:        null,
      year:            null,
      lastSummary:     null,
      full:            null
    };
    var geoLevelEl = document.getElementById("csGeoLevel");
    var yearEl     = document.getElementById("csYearSelect");
    if (geoLevelEl) data.geoLevel = geoLevelEl.value;
    if (yearEl)     data.year     = yearEl.value;

    if (_lastResult) {
      data.lastSummary = {
        geoLevel:        _lastResult.geoLevel,
        year:            _lastResult.year,
        apportionByArea: _lastResult.apportionByArea,
        weights:         Object.assign({}, _lastResult.weights || {}),
        featureFilter:   _lastResult.featureFilter || null,
        routeCDIs:       (_lastResult.routeCDIs || []).map(function (r) {
          return {
            name:            r.name,
            featureType:     r.featureType,
            featureIndex:    r.featureIndex,
            cdi:             r.cdi,
            classification:  r.classification,
            geoCount:        r.geoCount,
            lengthMiles:     r.lengthMiles,
            factorBreakdown: r.factorBreakdown || {},
            compositeRange:  r.compositeRange || null
          };
        })
      };

      // Full mode: include system factor averages so the comparison
      // bars in factor breakdowns restore correctly after a file import.
      if (mode === "full" && _lastResult.tpiResult) {
        data.full = {
          systemFactorAverages: computeSystemFactorAverages(_lastResult.tpiResult),
          effectiveWeights:     _lastResult.tpiResult.effectiveWeights || null
        };
      }
    }
    return data;
  }

  function restoreCsState(data) {
    if (!data) return;
    if (data.weights)          _weights         = Object.assign({}, data.weights);
    if (data.apportionByArea != null) _apportionByArea = !!data.apportionByArea;
    if (data.featureFilter !== undefined) _featureFilter = data.featureFilter;

    var geoLevelEl = document.getElementById("csGeoLevel");
    var yearEl     = document.getElementById("csYearSelect");
    if (geoLevelEl && data.geoLevel) geoLevelEl.value = data.geoLevel;
    if (yearEl     && data.year)     yearEl.value     = data.year;

    if (!data.lastSummary) return;
    var s = data.lastSummary;
    // Re-synthesize enough of _lastResult for the table and map layers.
    var fakeTpi = null;
    if (data.full && data.full.effectiveWeights) {
      fakeTpi = { effectiveWeights: data.full.effectiveWeights };
      if (data.full.systemFactorAverages) {
        // Store pre-computed system averages so renderResultsTable can use them
        // without re-deriving from a (missing) factorScores Map.
        fakeTpi.__restoredSystemAverages = data.full.systemFactorAverages;
      }
    }
    _lastResult = {
      routeCDIs:       s.routeCDIs || [],
      tpiResult:       fakeTpi,
      systemCDI:       null,
      geoLevel:        s.geoLevel,
      year:            s.year,
      apportionByArea: s.apportionByArea,
      unionPolygon:    null,
      featureFilter:   s.featureFilter || null,
      weights:         Object.assign({}, s.weights || _weights)
    };
    _stale = false;

    // Render table + map immediately (popup may or may not be open).
    if (isPopupVisible()) {
      renderResultsTable(_lastResult);
      setExportButtonsEnabled(true);
    }
    renderMapChoropleth(_lastResult);
    if (App.popup && App.popup.showFloatingWidget) {
      App.popup.showFloatingWidget("cs-legend", "projects/corridor-scoring-legend.html", {
        position: "bottom-left", width: 180, title: "Corridor Score"
      });
    }
  }

  // ---- Register as analysis module ----

  App.registerModule({
    id:         "corridor-scoring",
    name:       "Corridor Scoring",
    enabled:    true,
    popupWidth: 960,
    popupHTML:  "projects/corridor-scoring-popup.html",

    init:    function (core) { init(core); },
    onOpen:  function (core) { onOpen(core); },
    onClose: function (core) { onClose(core); },
    clear:   function ()     { clearAll(); },
    update:  async function (core) { await update(core); }
  });

  // Register with session cache
  if (App.cache && App.cache.registerModule) {
    App.cache.registerModule("corridor-scoring", {
      collect: saveCsState,
      apply:   restoreCsState
    });
  }

})();
