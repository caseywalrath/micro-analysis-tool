// js/core/features.js
// Right-side feature panel: lists all stations, lines, routes, polygons
// with editable names and per-item delete buttons.
// Depends on: App.stations (stations.js), App.lines (lines.js),
//             App.polygons (polygons.js).
// Exports: refreshFeaturePanel

(function () {
  var App = window.App = window.App || {};

  var TRASH_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '</svg>';

  function buildItem(feature, onDelete, featureType, featureIndex) {
    var div = document.createElement("div");
    div.className = "fp-item";
    div.dataset.featureType  = featureType;
    div.dataset.featureIndex = featureIndex;

    var input = document.createElement("input");
    input.type = "text";
    input.className = "fp-name";
    input.value = feature.properties.name;

    // Save name on blur or Enter key
    input.addEventListener("change", function () {
      feature.properties.name = input.value;
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
    });

    var delBtn = document.createElement("button");
    delBtn.className = "fp-delete";
    delBtn.title = "Delete";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", onDelete);

    // Hover and click wiring for bidirectional map highlighting
    div.addEventListener("mouseenter", function () {
      if (typeof App.setHoveredFeature === "function") App.setHoveredFeature(featureType, featureIndex);
    });
    div.addEventListener("mouseleave", function () {
      if (typeof App.clearHover === "function") App.clearHover();
    });
    div.addEventListener("click", function (e) {
      // Don't intercept clicks on the name input or delete button
      if (e.target === input || e.target === delBtn || delBtn.contains(e.target)) return;
      if (typeof App.selectFeature === "function") App.selectFeature(featureType, featureIndex);
    });

    div.appendChild(input);
    div.appendChild(delBtn);
    return div;
  }

  function populateList(containerId, features, removeFn, featureType) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    features.forEach(function (f, i) {
      el.appendChild(buildItem(f, function () {
        removeFn(i);
        if (typeof App.onFeatureDelete === "function") App.onFeatureDelete();
      }, featureType, i));
    });
  }

  function refreshFeaturePanel() {
    populateList("fp-stations", App.stations || [], App.removeStation || function () {}, "station");
    populateList("fp-lines",    App.lines    || [], App.removeLine    || function () {}, "line");
    populateList("fp-routes",   App.routes   || [], App.removeRoute   || function () {}, "route");
    populateList("fp-polygons", App.polygons || [], App.removePolygon || function () {}, "polygon");
    if (typeof App.applyPanelHighlight === "function") App.applyPanelHighlight();
  }

  App.refreshFeaturePanel = refreshFeaturePanel;

  // Wire feature panel collapse toggle
  (function () {
    var btn = document.getElementById('fp-collapse-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var panel = document.getElementById('feature-panel');
      var collapsed = panel.classList.toggle('fp-collapsed');
      btn.title = collapsed ? 'Show panel' : 'Hide panel';
      btn.setAttribute('aria-label', collapsed ? 'Show feature panel' : 'Hide feature panel');
    });
  })();
})();
