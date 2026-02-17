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

  function pointsGeoJSON() { return { type: "FeatureCollection", features: points }; }
  function buffersGeoJSON() { return { type: "FeatureCollection", features: buffers }; }

  function updateCoordsPanel() {
    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  function renderStationLayers() {
    var map = App.map;
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
        paint: { "fill-color": "#2b6cb0", "fill-opacity": 0.2 }
      });
      map.addLayer({
        id: bufLineLayer,
        type: "line",
        source: bufSrc,
        paint: { "line-color": "#2b6cb0", "line-width": 2, "line-opacity": 0.6 }
      });
    } else {
      map.getSource(bufSrc).setData(buffersGeoJSON());
    }

    if (!map.getSource(ptsSrc)) {
      map.addSource(ptsSrc, { type: "geojson", data: pointsGeoJSON() });
      map.addLayer({
        id: ptsLayer,
        type: "circle",
        source: ptsSrc,
        paint: {
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-color": "#2b6cb0",
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource(ptsSrc).setData(pointsGeoJSON());
    }

    updateCoordsPanel();
  }

  function addStationPoint(lon, lat) {
    var idx = points.length + 1;
    points.push({
      type: "Feature",
      properties: { name: "Station " + idx, stationIdx: idx },
      geometry: { type: "Point", coordinates: [lon, lat] }
    });
    rebuildBuffers(bufferRadiusMiles);
  }

  // Rebuild all buffers from current stations at the given radius.
  // If radius is 0, buffers are cleared (points remain on the map).
  function rebuildBuffers(radiusMiles) {
    bufferRadiusMiles = radiusMiles;
    buffers.length = 0;
    if (radiusMiles > 0) {
      for (var i = 0; i < points.length; i++) {
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
