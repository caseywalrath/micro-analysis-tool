// js/core/map.js
// Map initialization: basemap via MapLibre GL JS, basemap switcher control.
// Depends on: maplibregl (loaded via CDN).
// Exports: map, switchBasemap

(function () {
  var App = window.App = window.App || {};

  // ---- Basemap registry ----

  var BASEMAPS = [
    {
      id: "carto-light",
      name: "Carto Light",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
      ],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    {
      id: "carto-dark",
      name: "Carto Dark",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      ],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>'
    },
    {
      id: "osm",
      name: "OpenStreetMap",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    {
      id: "satellite",
      name: "Satellite",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
    }
  ];

  var currentBasemapId = "carto-light";

  // ---- Initial map style (Carto Light) ----

  var initialBasemap = BASEMAPS[0];
  var rasterStyle = {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: initialBasemap.tiles,
        tileSize: 256,
        attribution: initialBasemap.attribution
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

  // ---- Default cursor: grab hand ----
  map.on("load", function () {
    map.getCanvas().style.cursor = "grab";
  });
  map.on("dragstart", function () {
    if (!App.drawMode && !App._editing) {
      map.getCanvas().style.cursor = "grabbing";
    }
  });
  map.on("dragend", function () {
    if (App.drawMode) {
      map.getCanvas().style.cursor = "crosshair";
    } else if (!App._editing) {
      map.getCanvas().style.cursor = "grab";
    }
  });

  // ---- Basemap switching ----

  function switchBasemap(basemapId) {
    if (basemapId === currentBasemapId) return;

    var basemap = null;
    for (var i = 0; i < BASEMAPS.length; i++) {
      if (BASEMAPS[i].id === basemapId) { basemap = BASEMAPS[i]; break; }
    }
    if (!basemap) return;

    // Find the first data layer (the layer right above "carto")
    var layers = map.getStyle().layers;
    var firstDataLayerId = null;
    for (var j = 0; j < layers.length; j++) {
      if (layers[j].id !== "carto") {
        firstDataLayerId = layers[j].id;
        break;
      }
    }

    // Remove old basemap
    if (map.getLayer("carto")) map.removeLayer("carto");
    if (map.getSource("carto")) map.removeSource("carto");

    // Add new basemap below all data layers
    map.addSource("carto", {
      type: "raster",
      tiles: basemap.tiles,
      tileSize: 256,
      attribution: basemap.attribution
    });

    if (firstDataLayerId) {
      map.addLayer({ id: "carto", type: "raster", source: "carto" }, firstDataLayerId);
    } else {
      map.addLayer({ id: "carto", type: "raster", source: "carto" });
    }

    currentBasemapId = basemapId;
  }

  // ---- Basemap switcher control (bottom-right) ----

  var LAYERS_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/>' +
    '<polyline points="2 17 12 22 22 17"/>' +
    '<polyline points="2 12 12 17 22 12"/>' +
    '</svg>';

  function BasemapControl() {}

  BasemapControl.prototype.onAdd = function (mapInstance) {
    this._map = mapInstance;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group basemap-switcher";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "basemap-btn";
    btn.title = "Switch basemap";
    btn.innerHTML = LAYERS_SVG;

    var dropdown = document.createElement("div");
    dropdown.className = "basemap-dropdown";
    dropdown.style.display = "none";

    for (var i = 0; i < BASEMAPS.length; i++) {
      var opt = document.createElement("button");
      opt.type = "button";
      opt.className = "basemap-option" + (BASEMAPS[i].id === currentBasemapId ? " active" : "");
      opt.textContent = BASEMAPS[i].name;
      opt.setAttribute("data-basemap", BASEMAPS[i].id);
      opt.addEventListener("click", (function (id) {
        return function () {
          switchBasemap(id);
          var allOpts = dropdown.querySelectorAll(".basemap-option");
          for (var j = 0; j < allOpts.length; j++) {
            allOpts[j].classList.toggle("active", allOpts[j].getAttribute("data-basemap") === id);
          }
          dropdown.style.display = "none";
        };
      })(BASEMAPS[i].id));
      dropdown.appendChild(opt);
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
    });

    // Close dropdown on click outside
    document.addEventListener("click", function () {
      dropdown.style.display = "none";
    });

    // Prevent dropdown clicks from closing dropdown via the document listener
    dropdown.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    this._container.appendChild(btn);
    this._container.appendChild(dropdown);
    return this._container;
  };

  BasemapControl.prototype.onRemove = function () {
    this._container.parentNode.removeChild(this._container);
    this._map = undefined;
  };

  map.addControl(new BasemapControl(), "bottom-right");

  // ---- Expose on App namespace ----

  App.map = map;
  App.switchBasemap = switchBasemap;
})();
