// js/core/editing.js
// Feature editing: station click-drag, line/polygon vertex editing.
// Depends on: App.map, App.stations, App.lines, App.polygons,
//             App.moveStation, App.updateLineVertex, App.updatePolygonVertex,
//             App.renderStationLayers, App.renderLineLayers, App.renderPolygonLayers,
//             App.refreshFeaturePanel.
// Exports: App._editing, App.exitEditMode, App._initEditing

(function () {
  var App = window.App = window.App || {};

  // ---- Edit state ----
  // null when idle. Otherwise one of:
  //   { type: "station-drag", index: N }
  //   { type: "vertex-edit", featureType: "line"|"polygon", featureIndex: N }
  //   { type: "vertex-drag", featureType: "line"|"polygon", featureIndex: N, vertexIndex: N }

  var editState = null;
  App._editing = null;

  var EDIT_COLOR = "#f6ad55"; // orange highlight
  var EDIT_SRC = "edit-vertices";
  var EDIT_LAYER = "edit-vertices-layer";

  // ---- Edit vertex layer management ----

  function editVerticesGeoJSON(featureType, featureIndex) {
    var features = [];
    if (featureType === "line") {
      var line = App.lines[featureIndex];
      if (!line) return { type: "FeatureCollection", features: [] };
      line.geometry.coordinates.forEach(function (c, i) {
        features.push({
          type: "Feature",
          properties: { vertexIdx: i },
          geometry: { type: "Point", coordinates: c }
        });
      });
    } else if (featureType === "polygon") {
      var poly = App.polygons[featureIndex];
      if (!poly) return { type: "FeatureCollection", features: [] };
      var ring = poly.geometry.coordinates[0];
      // Skip closing vertex (last === first)
      for (var i = 0; i < ring.length - 1; i++) {
        features.push({
          type: "Feature",
          properties: { vertexIdx: i },
          geometry: { type: "Point", coordinates: ring[i] }
        });
      }
    }
    return { type: "FeatureCollection", features: features };
  }

  function showEditVertices(featureType, featureIndex) {
    var map = App.map;
    var data = editVerticesGeoJSON(featureType, featureIndex);
    if (!map.getSource(EDIT_SRC)) {
      map.addSource(EDIT_SRC, { type: "geojson", data: data });
      map.addLayer({
        id: EDIT_LAYER,
        type: "circle",
        source: EDIT_SRC,
        paint: {
          "circle-radius": 7,
          "circle-color": EDIT_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource(EDIT_SRC).setData(data);
    }
  }

  function hideEditVertices() {
    var map = App.map;
    if (map.getLayer(EDIT_LAYER)) map.removeLayer(EDIT_LAYER);
    if (map.getSource(EDIT_SRC)) map.removeSource(EDIT_SRC);
  }

  // ---- Feature index matching ----

  function findStationIndex(hitFeature) {
    var targetIdx = hitFeature.properties && hitFeature.properties.stationIdx;
    if (targetIdx != null) {
      for (var i = 0; i < App.stations.length; i++) {
        if (App.stations[i].properties.stationIdx == targetIdx) return i;
      }
    }
    // Fallback: match by coordinates
    var hitCoords = hitFeature.geometry.coordinates;
    for (var j = 0; j < App.stations.length; j++) {
      var c = App.stations[j].geometry.coordinates;
      if (Math.abs(c[0] - hitCoords[0]) < 1e-6 && Math.abs(c[1] - hitCoords[1]) < 1e-6) {
        return j;
      }
    }
    return -1;
  }

  function findLineIndex(hitFeature) {
    var targetIdx = hitFeature.properties && hitFeature.properties.lineIdx;
    if (targetIdx == null) return -1;
    for (var i = 0; i < App.lines.length; i++) {
      if (App.lines[i].properties.lineIdx == targetIdx) return i;
    }
    return -1;
  }

  function findPolygonIndex(hitFeature) {
    var targetIdx = hitFeature.properties && hitFeature.properties.polyIdx;
    if (targetIdx == null) return -1;
    for (var i = 0; i < App.polygons.length; i++) {
      if (App.polygons[i].properties.polyIdx == targetIdx) return i;
    }
    return -1;
  }

  // ---- Edit mode transitions ----

  function enterVertexEditMode(featureType, featureIndex) {
    editState = { type: "vertex-edit", featureType: featureType, featureIndex: featureIndex };
    App._editing = editState;
    showEditVertices(featureType, featureIndex);
    App.map.getCanvas().style.cursor = "pointer";
  }

  function exitEditMode() {
    editState = null;
    App._editing = null;
    hideEditVertices();
    if (!App.drawMode) {
      App.map.getCanvas().style.cursor = "grab";
    }
  }

  // ---- Safe queryRenderedFeatures helper ----

  function safeQuery(point, layerIds) {
    var map = App.map;
    var existing = [];
    for (var i = 0; i < layerIds.length; i++) {
      if (map.getLayer(layerIds[i])) existing.push(layerIds[i]);
    }
    if (existing.length === 0) return [];
    return map.queryRenderedFeatures(point, { layers: existing });
  }

  // ---- Initialization (called from app.js on map load) ----

  function init() {
    var map = App.map;

    // ---- Hover cursor management (when not in draw mode) ----
    map.on("mousemove", function (e) {
      if (App.drawMode) return;
      // Don't change cursor during active drags
      if (editState && (editState.type === "station-drag" || editState.type === "vertex-drag")) return;

      // Check edit vertex handles first (highest priority)
      if (editState && editState.type === "vertex-edit") {
        var editHits = safeQuery(e.point, [EDIT_LAYER]);
        if (editHits.length > 0) {
          map.getCanvas().style.cursor = "move";
          return;
        }
      }

      // Check stations
      var stationHits = safeQuery(e.point, ["stations-layer"]);
      if (stationHits.length > 0) {
        map.getCanvas().style.cursor = "move";
        return;
      }

      // Check lines and polygons
      var featureHits = safeQuery(e.point, ["lines-layer", "polygons-fill"]);
      if (featureHits.length > 0) {
        map.getCanvas().style.cursor = "pointer";
        return;
      }

      // Default: grab (unless in edit mode, show pointer for context)
      if (editState && editState.type === "vertex-edit") {
        map.getCanvas().style.cursor = "default";
      } else {
        map.getCanvas().style.cursor = "grab";
      }
    });

    // ---- Mousedown: start station drag or vertex drag ----
    map.on("mousedown", function (e) {
      if (App.drawMode) return;

      // Check for vertex handle drag first
      if (editState && editState.type === "vertex-edit") {
        var editHits = safeQuery(e.point, [EDIT_LAYER]);
        if (editHits.length > 0) {
          e.preventDefault();
          var vertexIdx = editHits[0].properties.vertexIdx;
          editState = {
            type: "vertex-drag",
            featureType: editState.featureType,
            featureIndex: editState.featureIndex,
            vertexIndex: vertexIdx
          };
          App._editing = editState;
          map.dragPan.disable();
          map.getCanvas().style.cursor = "grabbing";
          return;
        }
      }

      // Check for station drag
      var stationHits = safeQuery(e.point, ["stations-layer"]);
      if (stationHits.length > 0) {
        var stationIdx = findStationIndex(stationHits[0]);
        if (stationIdx >= 0) {
          e.preventDefault();
          editState = { type: "station-drag", index: stationIdx };
          App._editing = editState;
          map.dragPan.disable();
          map.getCanvas().style.cursor = "grabbing";
        }
      }
    });

    // ---- Mousemove: handle active drags ----
    map.on("mousemove", function (e) {
      if (!editState) return;

      if (editState.type === "station-drag") {
        // Lightweight live update (no buffer rebuild)
        App.stations[editState.index].geometry.coordinates = [e.lngLat.lng, e.lngLat.lat];
        var stSrc = map.getSource("stations");
        if (stSrc) stSrc.setData({ type: "FeatureCollection", features: App.stations });
        return;
      }

      if (editState.type === "vertex-drag") {
        var lng = e.lngLat.lng;
        var lat = e.lngLat.lat;
        if (editState.featureType === "line") {
          var line = App.lines[editState.featureIndex];
          if (line) {
            line.geometry.coordinates[editState.vertexIndex] = [lng, lat];
            var lineSrc = map.getSource("lines");
            if (lineSrc) lineSrc.setData({ type: "FeatureCollection", features: App.lines });
            // Also update saved line vertices
            var vertSrc = map.getSource("lines-vertices");
            if (vertSrc) {
              var vertFeatures = [];
              App.lines.forEach(function (l) {
                l.geometry.coordinates.forEach(function (c, idx) {
                  vertFeatures.push({
                    type: "Feature",
                    properties: { lineIdx: l.properties.lineIdx, waypointIdx: idx + 1 },
                    geometry: { type: "Point", coordinates: c }
                  });
                });
              });
              vertSrc.setData({ type: "FeatureCollection", features: vertFeatures });
            }
          }
        } else if (editState.featureType === "polygon") {
          var poly = App.polygons[editState.featureIndex];
          if (poly) {
            var ring = poly.geometry.coordinates[0];
            ring[editState.vertexIndex] = [lng, lat];
            if (editState.vertexIndex === 0) ring[ring.length - 1] = [lng, lat];
            var polySrc = map.getSource("polygons");
            if (polySrc) polySrc.setData({ type: "FeatureCollection", features: App.polygons });
            var outSrc = map.getSource("polygons-outlines");
            if (outSrc) {
              outSrc.setData({
                type: "FeatureCollection",
                features: App.polygons.map(function (f) {
                  return {
                    type: "Feature",
                    properties: f.properties,
                    geometry: { type: "LineString", coordinates: f.geometry.coordinates[0] }
                  };
                })
              });
            }
            var pvSrc = map.getSource("polygons-vertices");
            if (pvSrc) {
              var pvFeatures = [];
              App.polygons.forEach(function (p) {
                var r = p.geometry.coordinates[0];
                for (var vi = 0; vi < r.length - 1; vi++) {
                  pvFeatures.push({
                    type: "Feature",
                    properties: { polyIdx: p.properties.polyIdx, vertexIdx: vi + 1 },
                    geometry: { type: "Point", coordinates: r[vi] }
                  });
                }
              });
              pvSrc.setData({ type: "FeatureCollection", features: pvFeatures });
            }
          }
        }
        // Update edit handle positions
        showEditVertices(editState.featureType, editState.featureIndex);
        return;
      }
    });

    // ---- Mouseup: finalize drags ----
    map.on("mouseup", function (e) {
      if (!editState) return;

      if (editState.type === "station-drag") {
        App.moveStation(editState.index, e.lngLat.lng, e.lngLat.lat);
        editState = null;
        App._editing = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "grab";
        if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
        return;
      }

      if (editState.type === "vertex-drag") {
        // Finalize with full rebuild
        if (editState.featureType === "line") {
          App.updateLineVertex(editState.featureIndex, editState.vertexIndex, e.lngLat.lng, e.lngLat.lat);
        } else if (editState.featureType === "polygon") {
          App.updatePolygonVertex(editState.featureIndex, editState.vertexIndex, e.lngLat.lng, e.lngLat.lat);
        }
        // Return to vertex-edit mode (keep handles shown)
        editState = {
          type: "vertex-edit",
          featureType: editState.featureType,
          featureIndex: editState.featureIndex
        };
        App._editing = editState;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "move";
        showEditVertices(editState.featureType, editState.featureIndex);
        if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
        return;
      }
    });

    // ---- Click: enter/exit vertex edit mode for lines/polygons ----
    map.on("click", function (e) {
      if (App.drawMode) return;

      // If in vertex-edit mode, check if click is on empty area (exit)
      if (editState && editState.type === "vertex-edit") {
        // Check if click is on an edit handle (handled by mousedown, not here)
        var editHits = safeQuery(e.point, [EDIT_LAYER]);
        if (editHits.length > 0) return;

        // Check if click is on the same or another editable feature
        var featureHits = safeQuery(e.point, ["lines-layer", "polygons-fill"]);
        if (featureHits.length > 0) {
          var hit = featureHits[0];
          var layerId = hit.layer.id;
          if (layerId === "lines-layer") {
            var lineIdx = findLineIndex(hit);
            if (lineIdx >= 0) {
              exitEditMode();
              enterVertexEditMode("line", lineIdx);
              return;
            }
          } else if (layerId === "polygons-fill") {
            var polyIdx = findPolygonIndex(hit);
            if (polyIdx >= 0) {
              exitEditMode();
              enterVertexEditMode("polygon", polyIdx);
              return;
            }
          }
        }

        // Click on empty area → exit edit mode
        exitEditMode();
        return;
      }

      // Not in edit mode: check for click on lines or polygons to enter edit mode
      // (Skip if click was on a station — stations are drag-only)
      var stationHits = safeQuery(e.point, ["stations-layer"]);
      if (stationHits.length > 0) return;

      var linePolyHits = safeQuery(e.point, ["lines-layer", "polygons-fill"]);
      if (linePolyHits.length === 0) return;

      var hit2 = linePolyHits[0];
      var layerId2 = hit2.layer.id;
      if (layerId2 === "lines-layer") {
        var lineIdx2 = findLineIndex(hit2);
        if (lineIdx2 >= 0) {
          enterVertexEditMode("line", lineIdx2);
        }
      } else if (layerId2 === "polygons-fill") {
        var polyIdx2 = findPolygonIndex(hit2);
        if (polyIdx2 >= 0) {
          enterVertexEditMode("polygon", polyIdx2);
        }
      }
    });
  }

  // ---- Expose on App namespace ----

  App._editing = null;
  App.exitEditMode = exitEditMode;
  App._initEditing = init;
})();
