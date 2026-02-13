// js/core/polygons.js
// Polygon drawing and management, map layer rendering.
// Depends on: App.map (map.js).
// Exports: polygons, handlePolygonClick, clearPolygons, undoLastPolygon,
//          cancelPolygonDrawing, renderPolygonLayers

(function () {
  var App = window.App = window.App || {};

  var polygons = [];       // Saved GeoJSON Polygon features
  var currentCoords = [];  // Vertices of the polygon being drawn
  var SNAP_PIXELS = 15;

  /* ---- GeoJSON helpers ---- */

  function polygonsGeoJSON() {
    return { type: "FeatureCollection", features: polygons };
  }

  function polygonOutlinesGeoJSON() {
    return {
      type: "FeatureCollection",
      features: polygons.map(function (f) {
        return {
          type: "Feature",
          properties: f.properties,
          geometry: {
            type: "LineString",
            coordinates: f.geometry.coordinates[0]
          }
        };
      })
    };
  }

  function savedVerticesGeoJSON() {
    var features = [];
    polygons.forEach(function (poly) {
      // Skip the closing coordinate (last === first)
      var ring = poly.geometry.coordinates[0];
      for (var i = 0; i < ring.length - 1; i++) {
        features.push({
          type: "Feature",
          properties: { polyIdx: poly.properties.polyIdx, vertexIdx: i + 1 },
          geometry: { type: "Point", coordinates: ring[i] }
        });
      }
    });
    return { type: "FeatureCollection", features: features };
  }

  // In-progress drawing: show as a closed outline once we have >= 3 points,
  // otherwise show the open path so far.
  function currentDrawingGeoJSON() {
    if (currentCoords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    var coords = currentCoords.slice();
    if (coords.length >= 3) {
      coords.push(coords[0]); // close the ring visually
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords }
      }]
    };
  }

  function currentWaypointsGeoJSON() {
    return {
      type: "FeatureCollection",
      features: currentCoords.map(function (c, i) {
        return {
          type: "Feature",
          properties: { idx: i + 1 },
          geometry: { type: "Point", coordinates: c }
        };
      })
    };
  }

  /* ---- Panel update ---- */

  function updatePolygonPanel() {
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  /* ---- Map layer rendering ---- */

  var COLOR = "#38a169"; // green

  function renderPolygonLayers() {
    var map = App.map;

    // Saved polygon fills
    if (!map.getSource("polygons")) {
      map.addSource("polygons", { type: "geojson", data: polygonsGeoJSON() });
      map.addLayer({
        id: "polygons-fill",
        type: "fill",
        source: "polygons",
        paint: { "fill-color": COLOR, "fill-opacity": 0.15 }
      });
    } else {
      map.getSource("polygons").setData(polygonsGeoJSON());
    }

    // Saved polygon outlines
    if (!map.getSource("polygons-outlines")) {
      map.addSource("polygons-outlines", { type: "geojson", data: polygonOutlinesGeoJSON() });
      map.addLayer({
        id: "polygons-outlines-layer",
        type: "line",
        source: "polygons-outlines",
        paint: { "line-color": COLOR, "line-width": 3, "line-opacity": 0.8 }
      });
    } else {
      map.getSource("polygons-outlines").setData(polygonOutlinesGeoJSON());
    }

    // Saved polygon vertices
    if (!map.getSource("polygons-vertices")) {
      map.addSource("polygons-vertices", { type: "geojson", data: savedVerticesGeoJSON() });
      map.addLayer({
        id: "polygons-vertices-layer",
        type: "circle",
        source: "polygons-vertices",
        paint: {
          "circle-radius": 3,
          "circle-color": COLOR,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("polygons-vertices").setData(savedVerticesGeoJSON());
    }

    // In-progress outline (dashed)
    if (!map.getSource("polygons-drawing")) {
      map.addSource("polygons-drawing", { type: "geojson", data: currentDrawingGeoJSON() });
      map.addLayer({
        id: "polygons-drawing-layer",
        type: "line",
        source: "polygons-drawing",
        paint: { "line-color": COLOR, "line-width": 2, "line-opacity": 0.6, "line-dasharray": [3, 2] }
      });
    } else {
      map.getSource("polygons-drawing").setData(currentDrawingGeoJSON());
    }

    // In-progress waypoints
    if (!map.getSource("polygons-waypoints")) {
      map.addSource("polygons-waypoints", { type: "geojson", data: currentWaypointsGeoJSON() });
      map.addLayer({
        id: "polygons-waypoints-layer",
        type: "circle",
        source: "polygons-waypoints",
        paint: {
          "circle-radius": 6,
          "circle-color": COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("polygons-waypoints").setData(currentWaypointsGeoJSON());
    }

    updatePolygonPanel();
  }

  /* ---- Click logic ---- */

  function isNearLastWaypoint(lngLat) {
    if (currentCoords.length === 0) return false;
    var last = currentCoords[currentCoords.length - 1];
    var lastPx = App.map.project(last);
    var clickPx = App.map.project([lngLat.lng, lngLat.lat]);
    var dx = lastPx.x - clickPx.x;
    var dy = lastPx.y - clickPx.y;
    return Math.sqrt(dx * dx + dy * dy) < SNAP_PIXELS;
  }

  function handlePolygonClick(lngLat) {
    // Need at least 3 vertices before closing
    if (currentCoords.length >= 3 && isNearLastWaypoint(lngLat)) {
      savePolygon();
      return;
    }

    currentCoords.push([lngLat.lng, lngLat.lat]);
    renderPolygonLayers();

    if (currentCoords.length === 1) {
      App.setStatus("Polygon started — click to add vertices, click last point to save");
    } else if (currentCoords.length === 2) {
      App.setStatus("2 vertices — need at least 3 to close polygon");
    } else {
      App.setStatus(currentCoords.length + " vertices — click last point to save");
    }
  }

  function savePolygon() {
    if (currentCoords.length < 3) {
      currentCoords.length = 0;
      renderPolygonLayers();
      return;
    }

    var idx = polygons.length + 1;
    var nVertices = currentCoords.length;
    var ring = currentCoords.slice();
    ring.push(ring[0]); // close the ring

    polygons.push({
      type: "Feature",
      properties: { name: "Polygon " + idx, polyIdx: idx, vertices: nVertices },
      geometry: { type: "Polygon", coordinates: [ring] }
    });

    currentCoords.length = 0;
    renderPolygonLayers();
    App.setStatus("Polygon " + idx + " saved (" + nVertices + " vertices)");
  }

  function cancelPolygonDrawing() {
    if (currentCoords.length === 0) return;
    currentCoords.length = 0;
    renderPolygonLayers();
  }

  function clearPolygons() {
    polygons.length = 0;
    currentCoords.length = 0;
    renderPolygonLayers();
  }

  function undoLastPolygon() {
    if (currentCoords.length > 0) {
      currentCoords.pop();
      renderPolygonLayers();
      if (currentCoords.length === 0) {
        App.setStatus("Polygon drawing cancelled");
      } else if (currentCoords.length < 3) {
        App.setStatus(currentCoords.length + " vertices — need at least 3 to close polygon");
      } else {
        App.setStatus(currentCoords.length + " vertices — click last point to save");
      }
      return;
    }
    if (polygons.length > 0) {
      polygons.pop();
      renderPolygonLayers();
    }
  }

  /* ---- Expose on App namespace ---- */

  App.polygons = polygons;
  App.handlePolygonClick = handlePolygonClick;
  App.clearPolygons = clearPolygons;
  App.undoLastPolygon = undoLastPolygon;
  App.cancelPolygonDrawing = cancelPolygonDrawing;
  App.renderPolygonLayers = renderPolygonLayers;
})();
