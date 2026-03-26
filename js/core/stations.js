// js/core/stations.js
// Station point + buffer management, map layer rendering.
// Depends on: App.map (map.js), turf (CDN).
// Exports: stations, buffers, addStationPoint, clearStations, undoLastStation,
//          renderStationLayers, bufferUnionPolygon, getUnion, bboxStringFromFeature

(function () {
  var App = window.App = window.App || {};

  var points = [];
  var buffers = [];
  var bufferRadiusMiles = 0.5; // user-defined; 0 = no buffers

  function pointsGeoJSON() { return { type: "FeatureCollection", features: points.filter(function (p) { return !p.properties.hidden; }) }; }
  function buffersGeoJSON() { return { type: "FeatureCollection", features: buffers }; }

  function updateCoordsPanel() {
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function renderStationLayers() {
    var map = App.map;
    var stationColor = (App.sectionColors && App.sectionColors.station) || "#2b6cb0";
    var ptsSrc = "stations";
    var ptsLayer = "stations-layer";
    var bufSrc = "buffers";
    var bufFillLayer = "buffers-fill";
    var bufLineLayer = "buffers-line";

    if (!map.getSource(bufSrc)) {
      map.addSource(bufSrc, { type: "geojson", data: buffersGeoJSON() });
      map.addLayer({
        id: bufFillLayer,
        type: "fill",
        source: bufSrc,
        paint: { "fill-color": stationColor, "fill-opacity": 0.08 }
      });
      map.addLayer({
        id: bufLineLayer,
        type: "line",
        source: bufSrc,
        paint: { "line-color": stationColor, "line-width": 2, "line-opacity": 0.4 }
      });
    } else {
      map.getSource(bufSrc).setData(buffersGeoJSON());
      map.setPaintProperty(bufFillLayer, "fill-color", stationColor);
      map.setPaintProperty(bufLineLayer, "line-color", stationColor);
    }

    var stationColorExpr = ["case", ["all", ["has", "color"], ["!=", ["get", "color"], ""]], ["get", "color"], stationColor];
    if (!map.getSource(ptsSrc)) {
      map.addSource(ptsSrc, { type: "geojson", data: pointsGeoJSON() });
      map.addLayer({
        id: ptsLayer,
        type: "circle",
        source: ptsSrc,
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-color": stationColorExpr,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource(ptsSrc).setData(pointsGeoJSON());
      map.setPaintProperty(ptsLayer, "circle-color", stationColorExpr);
    }

    updateCoordsPanel();
  }

  function addStationPoint(lon, lat) {
    var idx = points.length + 1;
    points.push({
      type: "Feature",
      properties: { name: "Station " + idx, stationIdx: idx, color: "" },
      geometry: { type: "Point", coordinates: [lon, lat] }
    });
    rebuildBuffers(bufferRadiusMiles);
  }

  // Rebuild all buffers from current stations at the given radius.
  // If radius is 0, buffers are cleared (points remain on the map).
  function rebuildBuffers(radiusMiles) {
    if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
    bufferRadiusMiles = radiusMiles;
    buffers.length = 0;
    if (radiusMiles > 0) {
      for (var i = 0; i < points.length; i++) {
        if (points[i].properties.hidden) continue;
        var coords = points[i].geometry.coordinates;
        var pt = turf.point(coords);
        var circle = turf.circle(pt, radiusMiles, { units: "miles", steps: 64 });
        buffers.push({
          type: circle.type,
          geometry: circle.geometry,
          properties: { stationIdx: points[i].properties.stationIdx }
        });
      }
    }
    renderStationLayers();
  }

  function bufferUnionPolygon() {
    if (buffers.length === 0) return null;
    var u = buffers[0];
    for (var i = 1; i < buffers.length; i++) u = turf.union(u, buffers[i]);
    return u;
  }

  function bboxStringFromFeature(feat) { return turf.bbox(feat).join(","); }

  function moveStation(index, lng, lat) {
    if (index < 0 || index >= points.length) return;
    points[index].geometry.coordinates = [lng, lat];
    rebuildBuffers(bufferRadiusMiles);
  }

  function removeStation(index) {
    if (index < 0 || index >= points.length) return;
    points.splice(index, 1);
    rebuildBuffers(bufferRadiusMiles);
  }

  function clearStations() {
    points.length = 0;
    buffers.length = 0;
    renderStationLayers();
  }

  function undoLastStation() {
    if (points.length === 0) return;
    points.pop();
    rebuildBuffers(bufferRadiusMiles);
  }

  // --- Expose on App namespace ---

  App.stations = points;
  App.buffers = buffers;
  App.addStationPoint = addStationPoint;
  App.rebuildBuffers = rebuildBuffers;
  App.moveStation = moveStation;
  App.removeStation = removeStation;
  App.clearStations = clearStations;
  App.undoLastStation = undoLastStation;
  App.renderStationLayers = renderStationLayers;
  App.bufferUnionPolygon = bufferUnionPolygon;
  App.bboxStringFromFeature = bboxStringFromFeature;
  App.getUnion = bufferUnionPolygon;
})();
