// js/core/lines.js
// Line drawing and management, map layer rendering.
// Depends on: App.map (map.js).
// Exports: lines, handleLineClick, clearLines, undoLastLine,
//          cancelLineDrawing, renderLineLayers

(function () {
  var App = window.App = window.App || {};

  var lines = [];          // Saved GeoJSON LineString features
  var currentCoords = [];  // Coordinates of the line currently being drawn
  var SNAP_PIXELS = 15;    // Click must be within this many pixels of last waypoint to save

  /* ---- GeoJSON helpers ---- */

  function linesGeoJSON() {
    return { type: "FeatureCollection", features: lines };
  }

  function currentLineGeoJSON() {
    if (currentCoords.length < 2) {
      return { type: "FeatureCollection", features: [] };
    }
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: currentCoords.slice() }
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

  function savedVerticesGeoJSON() {
    var features = [];
    lines.forEach(function (line) {
      line.geometry.coordinates.forEach(function (c, i) {
        features.push({
          type: "Feature",
          properties: { lineIdx: line.properties.lineIdx, waypointIdx: i + 1 },
          geometry: { type: "Point", coordinates: c }
        });
      });
    });
    return { type: "FeatureCollection", features: features };
  }

  /* ---- Sidebar panel update ---- */

  function updateLinesPanel() {
    var countEl = document.getElementById("nLines");
    if (countEl) countEl.textContent = String(lines.length);

    var drawingEl = document.getElementById("lineDrawing");
    if (drawingEl) {
      if (currentCoords.length > 0) {
        drawingEl.textContent = "Drawing: " + currentCoords.length +
          " waypoint" + (currentCoords.length !== 1 ? "s" : "") +
          " placed — click last point again to save";
      } else {
        drawingEl.textContent = "";
      }
    }
  }

  /* ---- Map layer rendering ---- */

  function renderLineLayers() {
    var map = App.map;

    // Saved lines (solid)
    if (!map.getSource("lines")) {
      map.addSource("lines", { type: "geojson", data: linesGeoJSON() });
      map.addLayer({
        id: "lines-layer",
        type: "line",
        source: "lines",
        paint: { "line-color": "#e53e3e", "line-width": 3, "line-opacity": 0.8 }
      });
    } else {
      map.getSource("lines").setData(linesGeoJSON());
    }

    // Saved line vertices (small dots)
    if (!map.getSource("lines-vertices")) {
      map.addSource("lines-vertices", { type: "geojson", data: savedVerticesGeoJSON() });
      map.addLayer({
        id: "lines-vertices-layer",
        type: "circle",
        source: "lines-vertices",
        paint: {
          "circle-radius": 3,
          "circle-color": "#e53e3e",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("lines-vertices").setData(savedVerticesGeoJSON());
    }

    // In-progress line (dashed)
    if (!map.getSource("lines-drawing")) {
      map.addSource("lines-drawing", { type: "geojson", data: currentLineGeoJSON() });
      map.addLayer({
        id: "lines-drawing-layer",
        type: "line",
        source: "lines-drawing",
        paint: { "line-color": "#e53e3e", "line-width": 2, "line-opacity": 0.6, "line-dasharray": [3, 2] }
      });
    } else {
      map.getSource("lines-drawing").setData(currentLineGeoJSON());
    }

    // In-progress waypoints (clickable-sized dots)
    if (!map.getSource("lines-waypoints")) {
      map.addSource("lines-waypoints", { type: "geojson", data: currentWaypointsGeoJSON() });
      map.addLayer({
        id: "lines-waypoints-layer",
        type: "circle",
        source: "lines-waypoints",
        paint: {
          "circle-radius": 6,
          "circle-color": "#e53e3e",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("lines-waypoints").setData(currentWaypointsGeoJSON());
    }

    updateLinesPanel();
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

  function handleLineClick(lngLat) {
    // If drawing and click is near last waypoint → save
    if (currentCoords.length >= 2 && isNearLastWaypoint(lngLat)) {
      saveLine();
      return;
    }

    // Otherwise add a waypoint
    currentCoords.push([lngLat.lng, lngLat.lat]);
    renderLineLayers();

    if (currentCoords.length === 1) {
      App.setStatus("Line started — click to add waypoints, click last point to save");
    } else {
      App.setStatus(currentCoords.length + " waypoints — click last point to save");
    }
  }

  function saveLine() {
    if (currentCoords.length < 2) {
      currentCoords.length = 0;
      renderLineLayers();
      return;
    }

    var idx = lines.length + 1;
    var nWaypoints = currentCoords.length;
    lines.push({
      type: "Feature",
      properties: { name: "Line " + idx, lineIdx: idx, waypoints: nWaypoints },
      geometry: { type: "LineString", coordinates: currentCoords.slice() }
    });

    currentCoords.length = 0;
    renderLineLayers();
    App.setStatus("Line " + idx + " saved (" + nWaypoints + " waypoints)");
  }

  function cancelLineDrawing() {
    if (currentCoords.length === 0) return;
    currentCoords.length = 0;
    renderLineLayers();
  }

  function clearLines() {
    lines.length = 0;
    currentCoords.length = 0;
    renderLineLayers();
  }

  function undoLastLine() {
    // If currently drawing, remove the last waypoint
    if (currentCoords.length > 0) {
      currentCoords.pop();
      renderLineLayers();
      if (currentCoords.length === 0) {
        App.setStatus("Line drawing cancelled");
      } else {
        App.setStatus(currentCoords.length + " waypoints — click last point to save");
      }
      return;
    }
    // Otherwise remove the last saved line
    if (lines.length > 0) {
      lines.pop();
      renderLineLayers();
    }
  }

  /* ---- Expose on App namespace ---- */

  App.lines = lines;
  App.handleLineClick = handleLineClick;
  App.clearLines = clearLines;
  App.undoLastLine = undoLastLine;
  App.cancelLineDrawing = cancelLineDrawing;
  App.renderLineLayers = renderLineLayers;
})();
