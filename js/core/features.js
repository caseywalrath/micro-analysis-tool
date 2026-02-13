// js/core/features.js
// Right-side feature panel: lists all stations, lines, routes, polygons
// with editable names. Coordinates are kept on the features for future
// import/export but are not displayed.
// Depends on: App.stations (stations.js), App.lines (lines.js).
// Exports: refreshFeaturePanel

(function () {
  var App = window.App = window.App || {};

  function buildItem(feature) {
    var div = document.createElement("div");
    div.className = "fp-item";

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

    div.appendChild(input);
    return div;
  }

  function populateList(containerId, features) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = "";
    features.forEach(function (f) {
      el.appendChild(buildItem(f));
    });
  }

  function refreshFeaturePanel() {
    populateList("fp-stations", App.stations || []);
    populateList("fp-lines", App.lines || []);
    // Routes and polygons will populate once those tools are implemented
  }

  App.refreshFeaturePanel = refreshFeaturePanel;
})();
