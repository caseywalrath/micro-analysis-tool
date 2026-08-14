// js/core/module-buffers.js
// Shared analysis-buffer helper. Feature Area Analysis, Transit Coverage,
// Transit Propensity, Ridership Forecasting, and Corridor Scoring can carry a
// module distance, independent of the Feature Settings global
// buffer radius (App.routeBuffers / App.lineBuffers / App.buffers, rebuilt by
// js/core/routes.js / lines.js / points.js). It never mutates those arrays and
// it can build either a private distance-based set or a selected display-buffer
// set for one analysis run.
// Depends on: App namespace, turf (CDN), App.points/lines/routes/polygons,
//   App.getPointWalkshed (walkshed.js, optional — guarded).
// No DOM access.

(function () {
  var App = window.App = window.App || {};

  App.ANALYSIS_BUFFER_DEFAULT_MILES = 0.5;
  App.ANALYSIS_BUFFER_MIN_MILES     = 0.05;
  App.ANALYSIS_BUFFER_MAX_MILES     = 5;

  // Fold an array of polygons into one union. Returns null for an empty array.
  function foldAnalysisUnion(polys) {
    if (!polys || !polys.length) return null;
    var union = polys[0];
    for (var i = 1; i < polys.length; i++) {
      try { union = turf.union(union, polys[i]); } catch (e) { /* skip */ }
    }
    return union;
  }

  // Build a single feature's private buffer polygon at the given distance.
  function buildAnalysisBuffer(feature, miles) {
    try { return turf.buffer(feature, miles, { units: "miles", steps: 64 }); }
    catch (e) { return null; }
  }

  // Return the drawn Feature Settings buffers for an explicit selection. This
  // makes "Use Display Buffers" honor the same per-feature overrides and
  // walkshed substitutions visible on the map. Polygons stay unbuffered.
  function buildDisplayBufferSet(filter) {
    var byType = { route: {}, line: {}, point: {}, polygon: {} };
    var allPolys = [];
    var count = 0;

    function add(type, features, displayBuffers, indices) {
      if (!indices) return;
      for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var feature = features[idx];
        if (!feature || (feature.properties && feature.properties.hidden)) continue;
        var polygon = displayBuffers[idx];
        if (!polygon) continue;
        byType[type][idx] = polygon;
        allPolys.push(polygon);
        count++;
      }
    }

    filter = filter || {};
    add("route", App.routes || [], App.routeBuffers || [], filter.routeIndices);
    add("line", App.lines || [], App.lineBuffers || [], filter.lineIndices);
    add("point", App.points || [], App.buffers || [], filter.pointIndices);

    var polygons = App.polygons || [];
    var polygonIndices = filter.polygonIndices || [];
    for (var pi = 0; pi < polygonIndices.length; pi++) {
      var pidx = polygonIndices[pi];
      var poly = polygons[pidx];
      if (!poly || (poly.properties && poly.properties.hidden)) continue;
      byType.polygon[pidx] = poly;
      allPolys.push(poly);
      count++;
    }

    return {
      byType: byType,
      union: foldAnalysisUnion(allPolys),
      get: function (type, idx) { return (byType[type] && byType[type][idx]) || null; },
      count: count
    };
  }

  // Read + validate a buffer-distance input. Accepts an element id (string),
  // a DOM element, or any object exposing `.value` (so it's testable without
  // a DOM — the golden harness passes a plain { value: "..." } object).
  function readAnalysisBufferMiles(elOrId, fallback) {
    var fb = (fallback != null) ? fallback : App.ANALYSIS_BUFFER_DEFAULT_MILES;
    var el = elOrId;
    if (typeof elOrId === "string") {
      el = (typeof document !== "undefined") ? document.getElementById(elOrId) : null;
    }
    if (!el || el.value == null) return fb;
    var v = parseFloat(el.value);
    if (!Number.isFinite(v)) return fb;
    if (v < App.ANALYSIS_BUFFER_MIN_MILES || v > App.ANALYSIS_BUFFER_MAX_MILES) return fb;
    return v;
  }

  // Build a private buffer set for a filter of drawn features at the given
  // distance. filter = { routeIndices, lineIndices, pointIndices, polygonIndices }
  // — any key may be absent; always explicit arrays, never "null means all".
  //
  // Points: a point flagged attributes.serviceAreaType === "walkshed" with a
  // valid cached walkshed keeps that walkshed polygon regardless of `miles`
  // (a walkshed is a study-area TYPE, not a distance) unless
  // opts.preserveWalksheds === false. Otherwise a plain circle at `miles`.
  //
  // Polygons: passed through unbuffered (already an area).
  //
  // Returns { byType: {route:{}, line:{}, point:{}, polygon:{}}, union, get(type, idx), count }.
  function buildAnalysisBufferSet(filter, miles, opts) {
    opts = opts || {};
    var preserveWalksheds = opts.preserveWalksheds !== false;
    var byType = { route: {}, line: {}, point: {}, polygon: {} };
    var allPolys = [];
    var count = 0;

    function addRouteLike(type, arr, indices) {
      if (!indices) return;
      for (var i = 0; i < indices.length; i++) {
        var idx = indices[i];
        var feat = arr[idx];
        if (!feat || (feat.properties && feat.properties.hidden)) continue;
        var buf = buildAnalysisBuffer(feat, miles);
        if (!buf) continue;
        byType[type][idx] = buf;
        allPolys.push(buf);
        count++;
      }
    }

    addRouteLike("route", App.routes || [], filter && filter.routeIndices);
    addRouteLike("line",  App.lines  || [], filter && filter.lineIndices);

    var points = App.points || [];
    var pointIndices = (filter && filter.pointIndices) || null;
    if (pointIndices) {
      for (var pi = 0; pi < pointIndices.length; pi++) {
        var idx = pointIndices[pi];
        var pf = points[idx];
        if (!pf || (pf.properties && pf.properties.hidden)) continue;
        var attrs = (pf.properties && pf.properties.attributes) || {};
        var buf = null;
        if (preserveWalksheds && attrs.serviceAreaType === "walkshed" &&
            typeof App.getPointWalkshed === "function") {
          var ws = App.getPointWalkshed(pf.properties.pointIdx);
          if (ws) {
            buf = { type: "Feature", geometry: ws.geometry || ws, properties: { pointIdx: pf.properties.pointIdx, walkshed: true } };
          }
        }
        if (!buf) {
          try {
            var pt = turf.point(pf.geometry.coordinates);
            var circle = turf.circle(pt, miles, { units: "miles", steps: 64 });
            buf = { type: circle.type, geometry: circle.geometry, properties: { pointIdx: pf.properties.pointIdx } };
          } catch (e) { buf = null; }
        }
        if (!buf) continue;
        byType.point[idx] = buf;
        allPolys.push(buf);
        count++;
      }
    }

    var polygons = App.polygons || [];
    var polygonIndices = (filter && filter.polygonIndices) || null;
    if (polygonIndices) {
      for (var gi = 0; gi < polygonIndices.length; gi++) {
        var gidx = polygonIndices[gi];
        var gf = polygons[gidx];
        if (!gf || (gf.properties && gf.properties.hidden)) continue;
        byType.polygon[gidx] = gf;
        allPolys.push(gf);
        count++;
      }
    }

    return {
      byType: byType,
      union: foldAnalysisUnion(allPolys),
      get: function (type, idx) { return (byType[type] && byType[type][idx]) || null; },
      count: count
    };
  }

  App.foldAnalysisUnion     = foldAnalysisUnion;
  App.buildAnalysisBuffer   = buildAnalysisBuffer;
  App.buildDisplayBufferSet = buildDisplayBufferSet;
  App.readAnalysisBufferMiles = readAnalysisBufferMiles;
  App.buildAnalysisBufferSet  = buildAnalysisBufferSet;
})();
