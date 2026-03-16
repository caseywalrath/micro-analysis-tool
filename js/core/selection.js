// js/core/selection.js
// Bidirectional hover + click-to-lock selection highlighting between the
// right-side feature panel and map features / buffer areas.
//
// State model:
//   _hovered  — { type, index } | null  — transient, set by mousemove / panel mouseenter
//   _selected — { type, index } | null  — locked, set by click; cleared by click-elsewhere or draw mode
//
// Map shows: _hovered || _selected (hover takes visual priority)
// Panel shows: both states via .fp-hovered and .fp-selected CSS classes
//
// Exports: App.initHighlightLayers, App.setHoveredFeature, App.clearHover,
//          App.selectFeature, App.clearSelection, App.applyPanelHighlight

(function () {
  var App = window.App = window.App || {};

  var _hovered = null;   // { type: "station"|"line"|"route"|"polygon", index: N }
  var _selected = null;

  var EMPTY_FC = { type: "FeatureCollection", features: [] };

  var TYPE_COLOR = {
    station: "#2b6cb0",
    line:    "#e53e3e",
    route:   "#319795",
    polygon: "#38a169"
  };

  // ---- Highlight sources / layers setup ----

  function initHighlightLayers() {
    var map = App.map;
    if (!map) return;

    // Two dynamic sources: one for the feature geometry, one for its buffer
    map.addSource("hl-feature", { type: "geojson", data: EMPTY_FC });
    map.addSource("hl-buffer",  { type: "geojson", data: EMPTY_FC });

    // Buffer outline — thicker than normal border
    map.addLayer({
      id: "hl-buf-outline",
      type: "line",
      source: "hl-buffer",
      paint: {
        "line-color": ["coalesce", ["get", "hl_color"], "#2b6cb0"],
        "line-width": 4,
        "line-opacity": 0.9
      }
    });

    // Polygon fill — more opaque
    map.addLayer({
      id: "hl-poly-fill",
      type: "fill",
      source: "hl-feature",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["coalesce", ["get", "hl_color"], "#38a169"],
        "fill-opacity": 0.35
      }
    });

    // Polygon outline — thicker
    map.addLayer({
      id: "hl-poly-outline",
      type: "line",
      source: "hl-feature",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": ["coalesce", ["get", "hl_color"], "#38a169"],
        "line-width": 5,
        "line-opacity": 1.0
      }
    });

    // Line / route — thicker
    map.addLayer({
      id: "hl-line",
      type: "line",
      source: "hl-feature",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": ["coalesce", ["get", "hl_color"], "#e53e3e"],
        "line-width": 6,
        "line-opacity": 1.0
      }
    });

    // Station point — larger circle with stronger stroke
    map.addLayer({
      id: "hl-circle",
      type: "circle",
      source: "hl-feature",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": 10,
        "circle-color": ["coalesce", ["get", "hl_color"], "#2b6cb0"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff"
      }
    });
  }

  // ---- Internal: update MapLibre sources from current state ----

  function updateHighlightSources() {
    var map = App.map;
    if (!map || !map.getSource("hl-feature")) return;

    var active = _hovered || _selected;
    if (!active) {
      map.getSource("hl-feature").setData(EMPTY_FC);
      map.getSource("hl-buffer").setData(EMPTY_FC);
      return;
    }

    var type  = active.type;
    var index = active.index;
    var color = TYPE_COLOR[type] || "#2b6cb0";
    var feature = null;
    var buffer  = null;

    if (type === "station") {
      feature = App.stations && App.stations[index];
      buffer  = App.buffers  && App.buffers[index];
    } else if (type === "line") {
      feature = App.lines       && App.lines[index];
      buffer  = App.lineBuffers && App.lineBuffers[index];
    } else if (type === "route") {
      feature = App.routes       && App.routes[index];
      buffer  = App.routeBuffers && App.routeBuffers[index];
    } else if (type === "polygon") {
      feature = App.polygons && App.polygons[index];
      buffer  = null;
    }

    // Feature source — copy geometry, inject hl_color into properties
    if (feature) {
      var props = {};
      var fp = feature.properties;
      if (fp) { for (var k in fp) { if (Object.prototype.hasOwnProperty.call(fp, k)) props[k] = fp[k]; } }
      props.hl_color = color;
      map.getSource("hl-feature").setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: feature.geometry,
          properties: props
        }]
      });
    } else {
      map.getSource("hl-feature").setData(EMPTY_FC);
    }

    // Buffer source
    if (buffer) {
      map.getSource("hl-buffer").setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: buffer.geometry,
          properties: { hl_color: color }
        }]
      });
    } else {
      map.getSource("hl-buffer").setData(EMPTY_FC);
    }
  }

  // ---- Internal: apply CSS classes to panel items ----

  function applyPanelHighlight() {
    var items = document.querySelectorAll(".fp-item");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.remove("fp-hovered", "fp-selected");

      var elType  = el.dataset.featureType;
      var elIndex = parseInt(el.dataset.featureIndex, 10);

      if (_selected && elType === _selected.type && elIndex === _selected.index) {
        el.classList.add("fp-selected");
      } else if (_hovered && elType === _hovered.type && elIndex === _hovered.index) {
        el.classList.add("fp-hovered");
      }
    }
  }

  // ---- Public API ----

  function setHoveredFeature(type, index) {
    if (_hovered && _hovered.type === type && _hovered.index === index) return; // no change
    _hovered = { type: type, index: index };
    updateHighlightSources();
    applyPanelHighlight();
  }

  function clearHover() {
    if (!_hovered) return;
    _hovered = null;
    updateHighlightSources();
    applyPanelHighlight();
  }

  function selectFeature(type, index) {
    _selected = { type: type, index: index };
    _hovered  = null;
    updateHighlightSources();
    applyPanelHighlight();
  }

  function clearSelection() {
    if (!_selected && !_hovered) return;
    _selected = null;
    _hovered  = null;
    updateHighlightSources();
    applyPanelHighlight();
  }

  // ---- Expose ----

  App.initHighlightLayers = initHighlightLayers;
  App.setHoveredFeature   = setHoveredFeature;
  App.clearHover          = clearHover;
  App.selectFeature       = selectFeature;
  App.clearSelection      = clearSelection;
  App.applyPanelHighlight = applyPanelHighlight;
})();
