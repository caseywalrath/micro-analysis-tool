// js/core/map.js
// Map initialization: Carto light basemap via MapLibre GL JS.
// Depends on: maplibregl (loaded via CDN).
// Exports: map

(function () {
  var App = window.App = window.App || {};

  var rasterStyle = {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
        ],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
          '© <a href="https://carto.com/attributions">CARTO</a>'
      }
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }]
  };

  var map = new maplibregl.Map({
    container: "map",
    style: rasterStyle,
    center: [-104.9903, 39.7392],
    zoom: 10
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");

  App.map = map;
})();
