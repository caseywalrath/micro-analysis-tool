// js/core/measure.js
// Measure tool: click-to-measure distance (polyline) or area (polygon).
// Measurements are temporary — not saved to features, cache, or undo stack.
// Uses turf.length() and turf.area() for calculations.

(function () {
  "use strict";
  var App = window.App;

  // ---- Private state ----
  var _coords = [];          // array of [lng, lat]
  var _previewCoord = null;  // [lng, lat] or null
  var _isClosed = false;     // true when polygon closed
  var _markers = [];         // maplibregl.Marker instances (labels)
  var _vertexMarkers = [];   // maplibregl.Marker instances (point dots)

  var SNAP_PX = 15;          // pixel radius for snap-to-close
  var PURPLE = "#6b46c1";
  var PURPLE_LIGHT = "rgba(107, 70, 193, 0.15)";

  // ---- GeoJSON helpers ----

  function lineGeoJSON(coords) {
    if (coords.length < 2) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords }
      }]
    };
  }

  function polygonGeoJSON(coords) {
    if (coords.length < 3) return { type: "FeatureCollection", features: [] };
    var ring = coords.slice();
    ring.push(ring[0]); // close ring
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] }
      }]
    };
  }

  function emptyFC() {
    return { type: "FeatureCollection", features: [] };
  }

  // ---- Calculation helpers ----

  function segmentDistance(a, b) {
    var line = turf.lineString([a, b]);
    return turf.length(line, { units: "miles" });
  }

  function totalDistance(coords) {
    if (coords.length < 2) return 0;
    var line = turf.lineString(coords);
    return turf.length(line, { units: "miles" });
  }

  function polygonArea(coords) {
    if (coords.length < 3) return 0;
    var ring = coords.slice();
    ring.push(ring[0]);
    var poly = turf.polygon([ring]);
    var sqMeters = turf.area(poly);
    var acres = sqMeters * 0.000247105;
    var sqMiles = sqMeters * 3.861e-7;
    return { sqMeters: sqMeters, acres: acres, sqMiles: sqMiles };
  }

  function formatDist(miles) {
    if (miles < 0.1) {
      var ft = miles * 5280;
      return ft < 10 ? ft.toFixed(1) + " ft" : Math.round(ft) + " ft";
    }
    return miles < 10 ? miles.toFixed(2) + " mi" : miles.toFixed(1) + " mi";
  }

  function formatArea(a) {
    if (a.acres < 1) {
      return Math.round(a.sqMeters).toLocaleString() + " m\u00B2";
    }
    if (a.acres < 640) {
      return a.acres.toFixed(1) + " acres";
    }
    return a.sqMiles.toFixed(2) + " mi\u00B2";
  }

  // ---- Marker / label helpers ----

  function clearMarkers() {
    _markers.forEach(function (m) { m.remove(); });
    _markers = [];
    _vertexMarkers.forEach(function (m) { m.remove(); });
    _vertexMarkers = [];
  }

  function createLabel(text, lngLat, cssClass) {
    var el = document.createElement("div");
    el.className = "msr-label " + (cssClass || "");
    el.textContent = text;
    var marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat(lngLat)
      .addTo(App.map);
    return marker;
  }

  function createVertexDot(lngLat) {
    var el = document.createElement("div");
    el.className = "msr-vertex";
    var marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat(lngLat)
      .addTo(App.map);
    return marker;
  }

  function midpoint(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  // ---- Snap-to-close detection ----

  function isNearFirstPoint(lngLat) {
    if (_coords.length < 3) return false;
    var first = _coords[0];
    var p = App.map.project([first[0], first[1]]);
    var q = App.map.project([lngLat.lng, lngLat.lat]);
    var dx = p.x - q.x, dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy) < SNAP_PX;
  }

  // ---- Rebuild all labels from current state ----

  function rebuildLabels() {
    clearMarkers();

    // Vertex dots
    for (var i = 0; i < _coords.length; i++) {
      _vertexMarkers.push(createVertexDot(_coords[i]));
    }

    if (_isClosed && _coords.length >= 3) {
      // Polygon mode: show segment distances + area at centroid
      for (var j = 0; j < _coords.length; j++) {
        var next = (j + 1) % _coords.length;
        var d = segmentDistance(_coords[j], _coords[next]);
        var mid = midpoint(_coords[j], _coords[next]);
        _markers.push(createLabel(formatDist(d), mid, "msr-label-segment"));
      }
      // Perimeter
      var perim = totalDistance(_coords.concat([_coords[0]]));
      // Area label at centroid
      var ring = _coords.slice();
      ring.push(ring[0]);
      var centroid = turf.centroid(turf.polygon([ring]));
      var areaVal = polygonArea(_coords);
      _markers.push(createLabel(
        formatArea(areaVal) + "\n" + formatDist(perim) + " perimeter",
        centroid.geometry.coordinates,
        "msr-label-area"
      ));
    } else if (_coords.length >= 2) {
      // Line mode: segment labels + total at last point
      for (var k = 0; k < _coords.length - 1; k++) {
        var sd = segmentDistance(_coords[k], _coords[k + 1]);
        var sm = midpoint(_coords[k], _coords[k + 1]);
        _markers.push(createLabel(formatDist(sd), sm, "msr-label-segment"));
      }
      var tot = totalDistance(_coords);
      _markers.push(createLabel(formatDist(tot), _coords[_coords.length - 1], "msr-label-total"));
    }
  }

  // ---- Update map layers ----

  function updateLayers() {
    var map = App.map;
    var lineSrc = map.getSource("measure-line");
    var polySrc = map.getSource("measure-polygon");
    if (!lineSrc || !polySrc) return;

    if (_isClosed && _coords.length >= 3) {
      polySrc.setData(polygonGeoJSON(_coords));
      // Show full perimeter line including closing segment
      var closedLine = _coords.slice();
      closedLine.push(closedLine[0]);
      lineSrc.setData(lineGeoJSON(closedLine));
    } else {
      polySrc.setData(emptyFC());
      var allCoords = _coords.slice();
      if (_previewCoord && allCoords.length >= 1 && !_isClosed) {
        allCoords.push(_previewCoord);
      }
      lineSrc.setData(lineGeoJSON(allCoords));
    }
  }

  // ---- Live preview marker ----
  var _liveMarker = null;

  function updateLiveLabel() {
    if (_liveMarker) { _liveMarker.remove(); _liveMarker = null; }
    if (_isClosed || !_previewCoord || _coords.length < 1) return;

    var d = segmentDistance(_coords[_coords.length - 1], _previewCoord);
    _liveMarker = createLabel(formatDist(d), _previewCoord, "msr-label-live");
  }

  // ---- Public API ----

  App.initMeasureLayers = function () {
    var map = App.map;
    map.addSource("measure-line", { type: "geojson", data: emptyFC() });
    map.addSource("measure-polygon", { type: "geojson", data: emptyFC() });

    map.addLayer({
      id: "measure-polygon-fill",
      type: "fill",
      source: "measure-polygon",
      paint: { "fill-color": PURPLE, "fill-opacity": 0.12 }
    });
    map.addLayer({
      id: "measure-line-layer",
      type: "line",
      source: "measure-line",
      paint: {
        "line-color": PURPLE,
        "line-width": 2.5,
        "line-dasharray": [4, 3]
      }
    });
  };

  App.handleMeasureClick = function (lngLat) {
    if (_isClosed) {
      // Start fresh measurement after a completed polygon
      _coords = [];
      _isClosed = false;
      clearMarkers();
    }

    // Snap-to-close: click near first point with 3+ points
    if (isNearFirstPoint(lngLat)) {
      _isClosed = true;
      _previewCoord = null;
      if (_liveMarker) { _liveMarker.remove(); _liveMarker = null; }
      updateLayers();
      rebuildLabels();
      return;
    }

    _coords.push([lngLat.lng, lngLat.lat]);
    updateLayers();
    rebuildLabels();
  };

  App.setMeasurePreview = function (lngLat) {
    if (_isClosed) return;
    _previewCoord = lngLat ? [lngLat.lng, lngLat.lat] : null;
    updateLayers();
    updateLiveLabel();
  };

  App.clearMeasure = function () {
    _coords = [];
    _previewCoord = null;
    _isClosed = false;
    clearMarkers();
    if (_liveMarker) { _liveMarker.remove(); _liveMarker = null; }
    var map = App.map;
    var lineSrc = map.getSource("measure-line");
    var polySrc = map.getSource("measure-polygon");
    if (lineSrc) lineSrc.setData(emptyFC());
    if (polySrc) polySrc.setData(emptyFC());
  };

  App.undoLastMeasurePoint = function () {
    if (_isClosed) {
      // Reopen: remove closure, go back to line mode
      _isClosed = false;
    } else if (_coords.length > 0) {
      _coords.pop();
    }
    updateLayers();
    rebuildLabels();
  };

  App._measureDrawingInProgress = function () {
    return _coords.length > 0;
  };

})();
