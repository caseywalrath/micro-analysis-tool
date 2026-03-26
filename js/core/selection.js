// js/core/selection.js
// Bidirectional hover + click-to-lock selection highlighting between the
// right-side feature panel and map features / buffer areas.
//
// State model:
//   _hovered       — { type, index } | null  — transient, set by mousemove / panel mouseenter
//   _multiSelected — [{ type, index }, ...]  — locked set, toggled by Ctrl/Cmd+click
//
// Single-select is a special case: _multiSelected with exactly 1 item.
// App._selected is derived for backward compat (editing.js station-drag gate):
//   _multiSelected.length === 1 ? _multiSelected[0] : null
//
// Map shows: all _multiSelected items + _hovered (if any)
// Panel shows: .fp-selected on every multi-selected item, .fp-hovered on hovered item
//
// Exports: App.initHighlightLayers, App.setHoveredFeature, App.clearHover,
//          App.selectFeature, App.toggleMultiSelect, App.clearSelection,
//          App.applyPanelHighlight, App.isFeatureSelected, App.getSelectedFeatures

(function () {
  var App = window.App = window.App || {};

  var _hovered = null;        // { type: "station"|"line"|"route"|"polygon"|"label", index: N }
  var _multiSelected = [];    // Array of { type, index }

  var EMPTY_FC = { type: "FeatureCollection", features: [] };

  var TYPE_COLOR = {
    station: "#2b6cb0",
    line:    "#e53e3e",
    route:   "#319795",
    polygon: "#38a169"
  };

  // ---- Helpers ----

  function isSelected(type, index) {
    for (var i = 0; i < _multiSelected.length; i++) {
      if (_multiSelected[i].type === type && _multiSelected[i].index === index) return true;
    }
    return false;
  }

  function syncSelectedCompat() {
    App._selected = _multiSelected.length === 1 ? _multiSelected[0] : null;
  }

  function syncVertexEditing() {
    if (_multiSelected.length === 1 && _multiSelected[0].type !== "station") {
      if (typeof App.activateVertexEdit === "function")
        App.activateVertexEdit(_multiSelected[0].type, _multiSelected[0].index);
    } else {
      if (typeof App.deactivateVertexEdit === "function")
        App.deactivateVertexEdit();
    }
    if (typeof App.refreshSavedVertices  === "function") App.refreshSavedVertices();
    if (typeof App.refreshSavedWaypoints === "function") App.refreshSavedWaypoints();
  }

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
        "line-width": 3,
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
        "fill-opacity": 0.25
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
        "line-width": 4,
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
        "line-width": 4.5,
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
        "circle-radius": 8,
        "circle-color": ["coalesce", ["get", "hl_color"], "#2b6cb0"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      }
    });
  }

  // ---- Internal: update MapLibre sources from current state ----

  function updateHighlightSources() {
    var map = App.map;
    if (!map || !map.getSource("hl-feature")) return;

    // Collect active items: all multi-selected + hovered (if not already selected)
    var items = _multiSelected.slice();
    if (_hovered && !isSelected(_hovered.type, _hovered.index)) {
      items.push(_hovered);
    }

    if (!items.length) {
      map.getSource("hl-feature").setData(EMPTY_FC);
      map.getSource("hl-buffer").setData(EMPTY_FC);
      return;
    }

    var featureGeos = [];
    var bufferGeos  = [];

    items.forEach(function (active) {
      var feature = null, buffer = null;
      if (active.type === "station") {
        feature = App.stations && App.stations[active.index];
        buffer  = App.buffers  && App.buffers[active.index];
      } else if (active.type === "line") {
        feature = App.lines       && App.lines[active.index];
        buffer  = App.lineBuffers && App.lineBuffers[active.index];
      } else if (active.type === "route") {
        feature = App.routes       && App.routes[active.index];
        buffer  = App.routeBuffers && App.routeBuffers[active.index];
      } else if (active.type === "polygon") {
        feature = App.polygons && App.polygons[active.index];
      }

      if (feature) {
        var color = (feature.properties && feature.properties.color) ||
                    (App.sectionColors && App.sectionColors[active.type]) ||
                    TYPE_COLOR[active.type] || "#2b6cb0";
        var props = {};
        var fp = feature.properties;
        if (fp) { for (var k in fp) { if (Object.prototype.hasOwnProperty.call(fp, k)) props[k] = fp[k]; } }
        props.hl_color = color;
        featureGeos.push({ type: "Feature", geometry: feature.geometry, properties: props });
      }
      if (buffer) {
        var bColor = (feature && feature.properties && feature.properties.color) ||
                     (App.sectionColors && App.sectionColors[active.type]) ||
                     TYPE_COLOR[active.type] || "#2b6cb0";
        bufferGeos.push({ type: "Feature", geometry: buffer.geometry, properties: { hl_color: bColor } });
      }
    });

    map.getSource("hl-feature").setData({ type: "FeatureCollection", features: featureGeos });
    map.getSource("hl-buffer").setData({ type: "FeatureCollection", features: bufferGeos });
  }

  // ---- Internal: apply CSS classes to panel items ----

  function applyPanelHighlight() {
    var items = document.querySelectorAll(".fp-item");
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      el.classList.remove("fp-hovered", "fp-selected");

      var elType  = el.dataset.featureType;
      var elIndex = parseInt(el.dataset.featureIndex, 10);

      if (isSelected(elType, elIndex)) {
        el.classList.add("fp-selected");
      } else if (_hovered && elType === _hovered.type && elIndex === _hovered.index) {
        el.classList.add("fp-hovered");
      }
    }
  }

  // ---- Public API ----

  function setHoveredFeature(type, index) {
    if (_multiSelected.length) return; // locked selection takes full priority
    if (_hovered && _hovered.type === type && _hovered.index === index) return; // no change
    _hovered = { type: type, index: index };
    updateHighlightSources();
    applyPanelHighlight();
  }

  function clearHover() {
    if (_multiSelected.length) return; // locked selection takes full priority
    if (!_hovered) return;
    _hovered = null;
    updateHighlightSources();
    applyPanelHighlight();
  }

  function getFeatureFromApp(type, index) {
    if (type === "station") return App.stations && App.stations[index];
    if (type === "line")    return App.lines    && App.lines[index];
    if (type === "route")   return App.routes   && App.routes[index];
    if (type === "polygon") return App.polygons && App.polygons[index];
    if (type === "label")   return App.labels   && App.labels[index];
    return null;
  }

  function selectFeature(type, index) {
    _multiSelected = [{ type: type, index: index }];
    _hovered = null;
    syncSelectedCompat();
    updateHighlightSources();
    applyPanelHighlight();
    syncVertexEditing();
    // Auto-update attributes popup if already open (switching features)
    if (typeof App.isAttrPopupOpen === "function" && App.isAttrPopupOpen()) {
      var feat = getFeatureFromApp(type, index);
      if (feat && typeof App.openAttrPopup === "function") {
        App.openAttrPopup(type, index, feat);
      }
    }
  }

  function toggleMultiSelect(type, index) {
    if (isSelected(type, index)) {
      _multiSelected = _multiSelected.filter(function (s) {
        return !(s.type === type && s.index === index);
      });
    } else {
      _multiSelected.push({ type: type, index: index });
    }
    _hovered = null;
    syncSelectedCompat();
    updateHighlightSources();
    applyPanelHighlight();
    syncVertexEditing();
  }

  function clearSelection() {
    if (!_multiSelected.length && !_hovered) return;
    _multiSelected = [];
    _hovered = null;
    syncSelectedCompat();
    updateHighlightSources();
    applyPanelHighlight();
    if (typeof App.deactivateVertexEdit === "function") App.deactivateVertexEdit();
    if (typeof App.refreshSavedVertices  === "function") App.refreshSavedVertices();
    if (typeof App.refreshSavedWaypoints === "function") App.refreshSavedWaypoints();
  }

  // ---- Expose ----

  App._selected           = null; // kept in sync via syncSelectedCompat()
  App.initHighlightLayers = initHighlightLayers;
  App.setHoveredFeature   = setHoveredFeature;
  App.clearHover          = clearHover;
  App.selectFeature       = selectFeature;
  App.toggleMultiSelect   = toggleMultiSelect;
  App.clearSelection      = clearSelection;
  App.applyPanelHighlight = applyPanelHighlight;
  App.isFeatureSelected   = isSelected;
  App.getSelectedFeatures = function () { return _multiSelected.slice(); };
})();
