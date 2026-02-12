// js/core/census.js
// TIGERweb census geometry fetching, ACS data retrieval, and area-weighted aggregation.
// Depends on: App.map (map.js), App.bboxStringFromFeature (stations.js),
//             App.getMeta (utils.js), turf (CDN).

(function () {
  var App = window.App = window.App || {};

  // --- TIGERweb overlay rendering ---

  function renderCensusOverlay(geos) {
    var map = App.map;
    var srcId = "census-geos";
    var fillId = "census-geos-fill";
    var lineId = "census-geos-line";
    var fc = { type: "FeatureCollection", features: geos };

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: "geojson", data: fc });

      map.addLayer({
        id: fillId,
        type: "fill",
        source: srcId,
        paint: { "fill-color": "#111827", "fill-opacity": 0.08 }
      }, "buffers-fill");

      map.addLayer({
        id: lineId,
        type: "line",
        source: srcId,
        paint: { "line-color": "#111827", "line-width": 1, "line-opacity": 0.35 }
      }, "buffers-fill");
    } else {
      map.getSource(srcId).setData(fc);
    }
  }

  // --- Paginated TIGERweb query (shared by census.js and lodes.js) ---

  async function fetchAllTigerwebFeatures(layerUrl, params) {
    var pageSize = 1000;
    var offset = 0;
    var allFeatures = [];

    params.set("resultRecordCount", String(pageSize));

    while (true) {
      params.set("resultOffset", String(offset));
      var url = layerUrl + "/query?" + params.toString();
      var resp = await fetch(url);
      if (!resp.ok) throw new Error("TIGERweb error " + resp.status);
      var data = await resp.json();

      var features = data.features || [];
      allFeatures = allFeatures.concat(features);

      if (!data.exceededTransferLimit || features.length === 0) break;
      offset += features.length;
    }

    return allFeatures;
  }

  // --- TIGERweb fetch for tracts / block groups ---

  async function fetchTigerwebGeos(geoLevel, unionFeat) {
    var bbox = App.bboxStringFromFeature(unionFeat);
    var layerId = (geoLevel === "tract") ? 0 : 1;
    var layerUrl = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/" + layerId;

    var params = new URLSearchParams({
      where: "1=1",
      outFields: "GEOID",
      geometry: bbox,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
      returnGeometry: "true",
      f: "geojson"
    });

    var features = await fetchAllTigerwebFeatures(layerUrl, params);
    return features.filter(function (f) {
      return turf.booleanIntersects(f, unionFeat);
    });
  }

  // --- ACS API fetch + aggregation ---

  function parseGEOID(geoLevel, geoid) {
    var state = geoid.slice(0, 2);
    var county = geoid.slice(2, 5);
    var tract = geoid.slice(5, 11);
    var blkgrp = (geoLevel === "bg") ? geoid.slice(11, 12) : null;
    return { state: state, county: county, tract: tract, blkgrp: blkgrp };
  }

  async function fetchACSValues(geoLevel, year, varCode, geoids) {
    var groups = new Map();
    for (var gi = 0; gi < geoids.length; gi++) {
      var p = parseGEOID(geoLevel, geoids[gi]);
      var key = p.state + "-" + p.county;
      if (!groups.has(key)) groups.set(key, { state: p.state, county: p.county });
    }

    var results = new Map();
    var base = "https://api.census.gov/data/" + year + "/acs/acs5";

    for (var entry of groups.values()) {
      var forClause, inClause;
      if (geoLevel === "tract") {
        forClause = "tract:*";
        inClause = "state:" + entry.state + "%20county:" + entry.county;
      } else {
        forClause = "block%20group:*";
        inClause = "state:" + entry.state + "%20county:" + entry.county + "%20tract:*";
      }

      var url = base + "?get=NAME," + encodeURIComponent(varCode) + "&for=" + forClause + "&in=" + inClause;
      var resp = await fetch(url);
      if (!resp.ok) throw new Error("ACS API error " + resp.status + " for state " + entry.state + " county " + entry.county);
      var rows = await resp.json();

      var header = rows[0];
      var idxVar = header.indexOf(varCode);
      if (idxVar === -1) throw new Error("ACS response missing variable " + varCode);

      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var raw = r[idxVar];
        if (raw === null || raw === undefined || raw === "") continue;
        var val = Number(raw);
        if (!Number.isFinite(val)) continue;

        if (geoLevel === "tract") {
          var tract = r[header.indexOf("tract")];
          var st = r[header.indexOf("state")];
          var co = r[header.indexOf("county")];
          results.set(st + co + tract, val);
        } else {
          var bg = r[header.indexOf("block group")];
          var tract2 = r[header.indexOf("tract")];
          var st2 = r[header.indexOf("state")];
          var co2 = r[header.indexOf("county")];
          results.set(st2 + co2 + tract2 + bg, val);
        }
      }
    }
    return results;
  }

  async function fetchACSCountyValues(year, varCode, countyFipsList) {
    var base = "https://api.census.gov/data/" + year + "/acs/acs5";
    var byState = new Map();

    for (var ci = 0; ci < countyFipsList.length; ci++) {
      var c5 = countyFipsList[ci];
      var st = c5.slice(0, 2);
      var co = c5.slice(2, 5);
      if (!byState.has(st)) byState.set(st, []);
      byState.get(st).push(co);
    }

    var out = new Map();
    for (var entry of byState.entries()) {
      var stateFips = entry[0];
      var counties = entry[1];
      var url = base + "?get=NAME," + encodeURIComponent(varCode) + "&for=county:*&in=state:" + stateFips;
      var resp = await fetch(url);
      if (!resp.ok) throw new Error("ACS county fetch failed " + resp.status + " for state " + stateFips);
      var rows = await resp.json();
      var header = rows[0];
      var idxVar = header.indexOf(varCode);
      var idxState = header.indexOf("state");
      var idxCounty = header.indexOf("county");

      for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var co2 = r[idxCounty];
        if (!counties.includes(co2)) continue;
        var val = Number(r[idxVar]);
        if (!Number.isFinite(val)) continue;
        out.set(r[idxState] + co2, val);
      }
    }
    return out;
  }

  function aggregateWithinUnion(unionFeat, geos, valueMap, aggMode) {
    var numerator = 0;
    var denom = 0;
    var used = 0;

    for (var fi = 0; fi < geos.length; fi++) {
      var f = geos[fi];
      var geoid = f.properties && f.properties.GEOID;
      if (!geoid) continue;
      var v = valueMap.get(geoid);
      if (v == null) continue;

      var inter = turf.intersect(f, unionFeat);
      if (!inter) continue;

      var aInter = turf.area(inter);
      var aGeo = turf.area(f);
      if (aGeo <= 0) continue;

      var frac = Math.min(1, Math.max(0, aInter / aGeo));
      numerator += v * frac;
      denom += frac;
      used++;
    }

    if (aggMode === "avg") return { value: denom > 0 ? (numerator / denom) : NaN, used: used, weightSum: denom };
    return { value: numerator, used: used, weightSum: denom };
  }

  async function computeAcsValueOnly(varCode, year, geoLevel) {
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) return { value: NaN, used: 0 };

    var geos = await fetchTigerwebGeos(geoLevel, unionFeat);
    if (geos.length === 0) return { value: NaN, used: 0 };

    var geoids = geos.map(function (f) { return f.properties.GEOID; }).filter(Boolean);
    var valueMap = await fetchACSValues(geoLevel, year, varCode, geoids);

    var meta = App.getMeta(varCode);
    var agg = aggregateWithinUnion(unionFeat, geos, valueMap, meta.agg);
    return { value: agg.value, used: agg.used };
  }

  // --- Expose on App namespace ---

  App.renderCensusOverlay = renderCensusOverlay;
  App.fetchAllTigerwebFeatures = fetchAllTigerwebFeatures;
  App.fetchTigerwebGeos = fetchTigerwebGeos;
  App.parseGEOID = parseGEOID;
  App.fetchACSValues = fetchACSValues;
  App.fetchACSCountyValues = fetchACSCountyValues;
  App.aggregateWithinUnion = aggregateWithinUnion;
  App.computeAcsValueOnly = computeAcsValueOnly;
})();
