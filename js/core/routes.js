// js/core/routes.js
// Route drawing: waypoint-based lines snapped to the street network via OSRM.
// Depends on: App.map (map.js), turf.
// Exports: routes, routeBuffers, handleRouteClick, setRoutePreview,
//          rebuildRouteBuffers, routeBufferUnionPolygon,
//          removeRoute, clearRoutes, undoLastRoute, cancelRouteDrawing,
//          renderRouteLayers, updateRouteWaypoint

(function () {
  var App = window.App = window.App || {};

  var OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";
  var ROUTE_COLOR = "#319795"; // teal
  var SNAP_PIXELS = 15;

  var routes = [];
  var routeBuffers = [];
  var routeBufferRadiusMiles = 0.5;

  // Current drawing state
  var currentWaypoints = [];   // user click points (committed)
  var currentRouteCoords = []; // resolved street geometry from OSRM (flattened)
  var previewCoord = null;     // cursor [lng, lat] for straight-line preview

  // Generation counter to discard stale async fetch results
  var _fetchGen = 0;

  /* ---- OSRM fetch ---- */

  async function fetchRoute(waypoints) {
    if (waypoints.length < 2) return null;
    var coords = waypoints.map(function (wp) { return wp[0] + "," + wp[1]; }).join(";");
    var url = OSRM_URL + coords + "?overview=full&geometries=geojson";
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error("OSRM HTTP " + res.status);
      var data = await res.json();
      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) return null;
      return data.routes[0].geometry.coordinates;
    } catch (e) {
      console.warn("Route fetch failed:", e);
      return null;
    }
  }

  /* ---- Buffer functions ---- */

  function rebuildRouteBuffers(radiusMiles) {
    if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
    routeBufferRadiusMiles = radiusMiles;
    routeBuffers.splice(0);
    if (radiusMiles > 0) {
      for (var i = 0; i < routes.length; i++) {
        var buf = turf.buffer(routes[i], radiusMiles, { units: "miles", steps: 64 });
        routeBuffers.push(buf);
      }
    }
    renderRouteLayers();
  }

  function routeBufferUnionPolygon() {
    if (routeBuffers.length === 0) return null;
    var u = routeBuffers[0];
    for (var i = 1; i < routeBuffers.length; i++) u = turf.union(u, routeBuffers[i]);
    return u;
  }

  function routeBuffersGeoJSON() {
    return { type: "FeatureCollection", features: routeBuffers };
  }

  /* ---- GeoJSON helpers ---- */

  function routesGeoJSON() {
    return { type: "FeatureCollection", features: routes };
  }

  // In-progress drawing: resolved route coords + straight preview segment to cursor.
  function currentDrawingGeoJSON() {
    var coords = currentRouteCoords.slice();

    if (previewCoord && currentWaypoints.length >= 1) {
      if (coords.length < 2) {
        // Only 1 waypoint so far — show straight line from it to cursor
        coords = [currentWaypoints[currentWaypoints.length - 1], previewCoord];
      } else {
        // Extend resolved route to cursor
        coords = coords.concat([previewCoord]);
      }
    }

    if (coords.length < 2) {
      return { type: "FeatureCollection", features: [] };
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
      features: currentWaypoints.map(function (c, i) {
        return {
          type: "Feature",
          properties: { idx: i + 1 },
          geometry: { type: "Point", coordinates: c }
        };
      })
    };
  }

  // Saved-route waypoints (small dots on the map).
  function savedWaypointsGeoJSON() {
    var features = [];
    routes.forEach(function (route) {
      (route.properties.waypoints || []).forEach(function (wp, i) {
        features.push({
          type: "Feature",
          properties: { routeIdx: route.properties.routeIdx, waypointIdx: i + 1 },
          geometry: { type: "Point", coordinates: wp }
        });
      });
    });
    return { type: "FeatureCollection", features: features };
  }

  /* ---- Map layer rendering ---- */

  function renderRouteLayers() {
    var map = App.map;

    // Route buffers (teal fill, rendered below the route line)
    if (!map.getSource("route-buffers")) {
      map.addSource("route-buffers", { type: "geojson", data: routeBuffersGeoJSON() });
      map.addLayer({
        id: "route-buffers-fill",
        type: "fill",
        source: "route-buffers",
        paint: { "fill-color": "#319795", "fill-opacity": 0.2 }
      });
      map.addLayer({
        id: "route-buffers-line",
        type: "line",
        source: "route-buffers",
        paint: { "line-color": "#319795", "line-width": 2, "line-opacity": 0.6 }
      });
    } else {
      map.getSource("route-buffers").setData(routeBuffersGeoJSON());
    }

    // Saved routes (solid teal line)
    if (!map.getSource("routes")) {
      map.addSource("routes", { type: "geojson", data: routesGeoJSON() });
      map.addLayer({
        id: "routes-layer",
        type: "line",
        source: "routes",
        paint: { "line-color": ROUTE_COLOR, "line-width": 3, "line-opacity": 0.8 }
      });
    } else {
      map.getSource("routes").setData(routesGeoJSON());
    }

    // Saved route waypoints (small dots)
    if (!map.getSource("routes-waypoints-saved")) {
      map.addSource("routes-waypoints-saved", { type: "geojson", data: savedWaypointsGeoJSON() });
      map.addLayer({
        id: "routes-waypoints-saved-layer",
        type: "circle",
        source: "routes-waypoints-saved",
        paint: {
          "circle-radius": 3,
          "circle-color": ROUTE_COLOR,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("routes-waypoints-saved").setData(savedWaypointsGeoJSON());
    }

    // In-progress route (dashed)
    if (!map.getSource("routes-drawing")) {
      map.addSource("routes-drawing", { type: "geojson", data: currentDrawingGeoJSON() });
      map.addLayer({
        id: "routes-drawing-layer",
        type: "line",
        source: "routes-drawing",
        paint: {
          "line-color": ROUTE_COLOR,
          "line-width": 2,
          "line-opacity": 0.7,
          "line-dasharray": [3, 2]
        }
      });
    } else {
      map.getSource("routes-drawing").setData(currentDrawingGeoJSON());
    }

    // In-progress waypoints (clickable-sized dots)
    if (!map.getSource("routes-waypoints")) {
      map.addSource("routes-waypoints", { type: "geojson", data: currentWaypointsGeoJSON() });
      map.addLayer({
        id: "routes-waypoints-layer",
        type: "circle",
        source: "routes-waypoints",
        paint: {
          "circle-radius": 6,
          "circle-color": ROUTE_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
        }
      });
    } else {
      map.getSource("routes-waypoints").setData(currentWaypointsGeoJSON());
    }

    if (typeof App.refreshFeaturePanel === "function") App.refreshFeaturePanel();
  }

  /* ---- Rubber-band preview (straight line, no API calls) ---- */

  function setRoutePreview(lngLat) {
    previewCoord = lngLat ? [lngLat.lng, lngLat.lat] : null;
    var src = App.map.getSource("routes-drawing");
    if (src) src.setData(currentDrawingGeoJSON());
  }

  /* ---- Snap-to-close detection ---- */

  function isNearLastWaypoint(lngLat) {
    if (currentWaypoints.length === 0) return false;
    var last = currentWaypoints[currentWaypoints.length - 1];
    var lastPx = App.map.project(last);
    var clickPx = App.map.project([lngLat.lng, lngLat.lat]);
    var dx = lastPx.x - clickPx.x;
    var dy = lastPx.y - clickPx.y;
    return Math.sqrt(dx * dx + dy * dy) < SNAP_PIXELS;
  }

  /* ---- Click handling ---- */

  async function handleRouteClick(lngLat) {
    // Snap-to-close: clicking near last waypoint saves the route
    if (currentWaypoints.length >= 2 && isNearLastWaypoint(lngLat)) {
      await saveRoute();
      return;
    }

    currentWaypoints.push([lngLat.lng, lngLat.lat]);

    if (currentWaypoints.length === 1) {
      // First waypoint — nothing to route yet
      renderRouteLayers();
      App.setStatus("Route started \u2014 click to add waypoints, click last point to save");
      return;
    }

    // Fetch route for all current waypoints. Use a generation counter to
    // discard results from fetches that were overtaken by a later click.
    var gen = ++_fetchGen;
    var snapshot = currentWaypoints.slice();

    App.setStatus("Routing\u2026");
    var coords = await fetchRoute(snapshot);

    if (gen !== _fetchGen) return; // stale result, a newer click happened

    currentRouteCoords = coords || snapshot;
    App.setStatus(currentWaypoints.length + " waypoints \u2014 click last point to save");
    renderRouteLayers();
  }

  /* ---- Save route ---- */

  async function saveRoute() {
    if (currentWaypoints.length < 2) {
      cancelRouteDrawing();
      return;
    }

    var coords = currentRouteCoords;
    if (coords.length < 2) {
      // No resolved geometry yet (rapid click) — fetch now
      App.setStatus("Routing\u2026");
      var fetched = await fetchRoute(currentWaypoints);
      coords = fetched || currentWaypoints.slice();
    }

    var idx = routes.length + 1;
    routes.push({
      type: "Feature",
      properties: {
        name: "Route " + idx,
        routeIdx: idx,
        waypoints: currentWaypoints.slice()
      },
      geometry: { type: "LineString", coordinates: coords }
    });

    var nWp = currentWaypoints.length;
    currentWaypoints = [];
    currentRouteCoords = [];
    previewCoord = null;
    rebuildRouteBuffers(routeBufferRadiusMiles);
    App.setStatus("Route " + idx + " saved (" + nWp + " waypoints)");
  }

  /* ---- Cancel / remove / clear / undo ---- */

  function cancelRouteDrawing() {
    if (currentWaypoints.length === 0 && !previewCoord) return;
    currentWaypoints = [];
    currentRouteCoords = [];
    previewCoord = null;
    renderRouteLayers();
  }

  function removeRoute(index) {
    if (index < 0 || index >= routes.length) return;
    routes.splice(index, 1);
    rebuildRouteBuffers(routeBufferRadiusMiles);
  }

  function clearRoutes() {
    if (typeof App.clearCensusOverlay === "function") App.clearCensusOverlay();
    routes.length = 0;
    currentWaypoints = [];
    currentRouteCoords = [];
    previewCoord = null;
    routeBuffers.splice(0);
    renderRouteLayers();
  }

  function undoLastRoute() {
    if (currentWaypoints.length > 0) {
      currentWaypoints.pop();
      if (currentWaypoints.length >= 2) {
        var gen = ++_fetchGen;
        var snapshot = currentWaypoints.slice();
        App.setStatus("Routing\u2026");
        fetchRoute(snapshot).then(function (coords) {
          if (gen !== _fetchGen) return;
          currentRouteCoords = coords || snapshot;
          renderRouteLayers();
          App.setStatus(currentWaypoints.length + " waypoints \u2014 click last point to save");
        });
      } else {
        currentRouteCoords = [];
        renderRouteLayers();
        if (currentWaypoints.length === 0) {
          App.setStatus("Route drawing cancelled");
        } else {
          App.setStatus("Route started \u2014 click to add waypoints, click last point to save");
        }
      }
      return;
    }
    if (routes.length > 0) {
      routes.pop();
      rebuildRouteBuffers(routeBufferRadiusMiles);
    }
  }

  /* ---- Vertex editing support ---- */

  // Re-routes the entire route after a waypoint is moved.
  // Called from editing.js on drag release.
  async function updateRouteWaypoint(routeIdx, wpIdx, lng, lat) {
    if (routeIdx < 0 || routeIdx >= routes.length) return;
    var route = routes[routeIdx];
    var waypoints = route.properties.waypoints;
    if (wpIdx < 0 || wpIdx >= waypoints.length) return;

    waypoints[wpIdx] = [lng, lat];

    if (waypoints.length >= 2) {
      App.setStatus("Re-routing\u2026");
      var coords = await fetchRoute(waypoints);
      route.geometry.coordinates = coords || waypoints.slice();
    } else {
      route.geometry.coordinates = waypoints.slice();
    }

    rebuildRouteBuffers(routeBufferRadiusMiles);
    App.setStatus("Route updated");
  }

  /* ---- Expose on App namespace ---- */

  App.routes = routes;
  App.routeBuffers = routeBuffers;
  App.rebuildRouteBuffers = rebuildRouteBuffers;
  App.routeBufferUnionPolygon = routeBufferUnionPolygon;
  App.handleRouteClick = handleRouteClick;
  App.setRoutePreview = setRoutePreview;
  App.removeRoute = removeRoute;
  App.clearRoutes = clearRoutes;
  App.undoLastRoute = undoLastRoute;
  App.cancelRouteDrawing = cancelRouteDrawing;
  App.renderRouteLayers = renderRouteLayers;
  App.updateRouteWaypoint = updateRouteWaypoint;
})();
