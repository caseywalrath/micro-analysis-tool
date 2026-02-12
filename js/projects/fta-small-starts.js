// js/projects/fta-small-starts.js
// FTA Small Starts (Land Use) project: breakpoint classification,
// CRE / Essential Services / LBAR upload + computation, ratings updater.
// Depends on: App namespace (utils, map, stations, census, lodes), turf (CDN).

(function () {
  var App = window.App = window.App || {};

  // ---- FTA-local state ----

  var CRE_MAP = null;    // Map(tractGEOID11 -> { total, high })
  var CRE_HEADERS = [];
  var CRE_ROWS = [];

  var ESS_POINTS = null; // array of [lon,lat]
  var ESS_HEADERS = [];
  var ESS_ROWS = [];

  var LBAR_SITES = null; // array {lon, lat, units, county5?}
  var LBAR_HEADERS = [];
  var LBAR_ROWS = [];

  // ---- LBAR plotting (map layer toggle) ----

  function lbarSitesToGeoJSON() {
    var feats = (LBAR_SITES || []).map(function (s, i) {
      return {
        type: "Feature",
        properties: { idx: i + 1 },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] }
      };
    });
    return { type: "FeatureCollection", features: feats };
  }

  function ensureLbarLayer() {
    var map = App.map;
    var srcId = "lbar-sites";
    var layerId = "lbar-sites-layer";
    var data = lbarSitesToGeoJSON();

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: "geojson", data: data });
      map.addLayer({
        id: layerId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": 3,
          "circle-color": "#333333",
          "circle-opacity": 0.85
        }
      });
    } else {
      map.getSource(srcId).setData(data);
    }
  }

  function removeLbarLayer() {
    var map = App.map;
    var srcId = "lbar-sites";
    var layerId = "lbar-sites-layer";
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(srcId)) map.removeSource(srcId);
  }

  function refreshLbarLayerVisibility() {
    var cb = document.getElementById("toggleLbarLayer");
    var on = cb && cb.checked;

    if (!on) { removeLbarLayer(); return; }
    if (!LBAR_SITES || LBAR_SITES.length === 0) { removeLbarLayer(); return; }
    ensureLbarLayer();
  }

  // ---- FTA breakpoint tables ----

  var BP = {
    popDensity: [
      { label: "High",        pill: "high", min: 15000, max: Infinity },
      { label: "Medium-High", pill: "mh",   min: 9600,  max: 14999 },
      { label: "Medium",      pill: "med",  min: 5760,  max: 9599 },
      { label: "Medium-Low",  pill: "ml",   min: 2560,  max: 5759 },
      { label: "Low",         pill: "low",  min: -Infinity, max: 2559 }
    ],
    employment: [
      { label: "High",        pill: "high", min: 220000, max: Infinity },
      { label: "Medium-High", pill: "mh",   min: 140000, max: 219999 },
      { label: "Medium",      pill: "med",  min: 70000,  max: 139999 },
      { label: "Medium-Low",  pill: "ml",   min: 40000,  max: 69999 },
      { label: "Low",         pill: "low",  min: -Infinity, max: 39999 }
    ],
    lbarRatio: [
      { label: "High",        pill: "high", min: 2.5000000001, max: Infinity },
      { label: "Medium-High", pill: "mh",   min: 2.25, max: 2.49 },
      { label: "Medium",      pill: "med",  min: 1.50, max: 2.24 },
      { label: "Medium-Low",  pill: "ml",   min: 1.10, max: 1.49 },
      { label: "Low",         pill: "low",  min: -Infinity, max: 1.09 }
    ],
    communityRiskPct: [
      { label: "High",        pill: "high", min: 50.0, max: Infinity },
      { label: "Medium-High", pill: "mh",   min: 40.0, max: 49.9 },
      { label: "Medium",      pill: "med",  min: 18.0, max: 39.9 },
      { label: "Medium-Low",  pill: "ml",   min: 5.0,  max: 17.9 },
      { label: "Low",         pill: "low",  min: -Infinity, max: 4.99 }
    ],
    essentialAvg: [
      { label: "High",        pill: "high", min: 7.0000000001, max: Infinity },
      { label: "Medium-High", pill: "mh",   min: 5.0, max: 7.0 },
      { label: "Medium",      pill: "med",  min: 3.0, max: 4.0 },
      { label: "Medium-Low",  pill: "ml",   min: 1.0, max: 2.0 },
      { label: "Low",         pill: "low",  min: -Infinity, max: 0.9999999999 }
    ]
  };

  var RATING_ORDER = ["Low", "Medium-Low", "Medium", "Medium-High", "High"];

  function classify(value, breakpoints) {
    if (!Number.isFinite(value)) return { label: "N/A", pill: "na" };
    for (var i = 0; i < breakpoints.length; i++) {
      var b = breakpoints[i];
      if (value >= b.min && value <= b.max) return { label: b.label, pill: b.pill };
    }
    return { label: "N/A", pill: "na" };
  }

  function bumpOneLevel(ratingLabel) {
    var idx = RATING_ORDER.indexOf(ratingLabel);
    if (idx < 0) return ratingLabel;
    return RATING_ORDER[Math.min(RATING_ORDER.length - 1, idx + 1)];
  }

  function setPill(elId, label, pillClass) {
    var el = document.getElementById(elId);
    el.textContent = label;
    el.className = "pill " + (pillClass || "na");
  }

  // ---- CRE builder + compute ----

  function buildCreMapFromRows(geoidCol, totalCol, highCol) {
    var m = new Map();
    for (var i = 0; i < CRE_ROWS.length; i++) {
      var r = CRE_ROWS[i];
      var geoid11 = App.normalizeTractGEOID(r[geoidCol]);
      if (!geoid11) continue;
      var total = App.toNumberSafe(r[totalCol]);
      var high = App.toNumberSafe(r[highCol]);
      if (!Number.isFinite(total) || !Number.isFinite(high)) continue;
      m.set(geoid11, { total: total, high: high });
    }
    return m;
  }

  async function computeCommunityRiskFromCre() {
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat || !CRE_MAP) return { pct: NaN, highInUnion: 0, totalInUnion: 0, used: 0 };

    var tracts = await App.fetchTigerwebGeos("tract", unionFeat);
    var highSum = 0;
    var totalSum = 0;
    var used = 0;

    for (var i = 0; i < tracts.length; i++) {
      var t = tracts[i];
      var geoid = t.properties && t.properties.GEOID;
      if (!geoid) continue;
      var v = CRE_MAP.get(geoid);
      if (!v) continue;

      var inter = turf.intersect(t, unionFeat);
      if (!inter) continue;

      var aInter = turf.area(inter);
      var aTract = turf.area(t);
      if (aTract <= 0) continue;
      var frac = Math.min(1, Math.max(0, aInter / aTract));

      highSum += v.high * frac;
      totalSum += v.total * frac;
      used++;
    }

    var pct = totalSum > 0 ? (highSum / totalSum) * 100 : NaN;
    return { pct: pct, highInUnion: highSum, totalInUnion: totalSum, used: used };
  }

  // ---- Essential services ----

  function extractPointsFromGeoJSON(obj) {
    var pts = [];
    if (!obj || obj.type !== "FeatureCollection" || !Array.isArray(obj.features)) return pts;
    for (var i = 0; i < obj.features.length; i++) {
      var f = obj.features[i];
      if (!f || !f.geometry) continue;
      if (f.geometry.type === "Point" && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2) {
        var lon = Number(f.geometry.coordinates[0]);
        var lat = Number(f.geometry.coordinates[1]);
        if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat]);
      }
    }
    return pts;
  }

  function buildPointsFromCsvRows(rows, latCol, lonCol) {
    var pts = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var lat = App.toNumberSafe(r[latCol]);
      var lon = App.toNumberSafe(r[lonCol]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      pts.push([lon, lat]);
    }
    return pts;
  }

  function computeEssentialServicesAvg() {
    var stations = App.stations;
    if (!ESS_POINTS || ESS_POINTS.length === 0 || stations.length === 0) return { avg: NaN, perStation: [] };

    var perStation = [];
    for (var si = 0; si < stations.length; si++) {
      var coords = stations[si].geometry.coordinates;
      var buf = turf.circle(turf.point([coords[0], coords[1]]), 1.0, { units: "miles", steps: 64 });
      var count = 0;
      for (var qi = 0; qi < ESS_POINTS.length; qi++) {
        if (turf.booleanPointInPolygon(turf.point(ESS_POINTS[qi]), buf)) count++;
      }
      perStation.push(count);
    }
    var avg = perStation.reduce(function (a, b) { return a + b; }, 0) / perStation.length;
    return { avg: avg, perStation: perStation };
  }

  // ---- LBAR ----

  function buildLbarSitesFromGeoJSON(obj) {
    var sites = [];
    if (!obj || obj.type !== "FeatureCollection" || !Array.isArray(obj.features)) return sites;
    for (var i = 0; i < obj.features.length; i++) {
      var f = obj.features[i];
      if (!f || !f.geometry || f.geometry.type !== "Point") continue;
      var c = f.geometry.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      var lon = Number(c[0]);
      var lat = Number(c[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;

      var p = f.properties || {};
      var units = App.toNumberSafe(p.units != null ? p.units : (p.UNITS != null ? p.UNITS : (p.lbar_units != null ? p.lbar_units : p.LBAR_UNITS)));
      if (!Number.isFinite(units)) continue;

      var county = String(p.county != null ? p.county : (p.COUNTY != null ? p.COUNTY : (p.county_fips != null ? p.county_fips : (p.COUNTY_FIPS != null ? p.COUNTY_FIPS : "")))).trim();
      var county5 = county.replace(/\D/g, "").slice(0, 5);
      sites.push({ lon: lon, lat: lat, units: units, county5: county5 || null });
    }
    return sites;
  }

  function buildLbarSitesFromCsvRows(rows, latCol, lonCol, unitsCol, countyCol) {
    var sites = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var lat = App.toNumberSafe(r[latCol]);
      var lon = App.toNumberSafe(r[lonCol]);
      var units = App.toNumberSafe(r[unitsCol]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(units)) continue;

      var county5 = null;
      if (countyCol) {
        var raw = String(r[countyCol] != null ? r[countyCol] : "").trim();
        var digits = raw.replace(/\D/g, "");
        if (digits.length >= 5) county5 = digits.slice(0, 5);
      }
      sites.push({ lon: lon, lat: lat, units: units, county5: county5 });
    }
    return sites;
  }

  function parseCountyListInput() {
    var raw = document.getElementById("lbarCounties").value || "";
    var parts = raw.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var cleaned = parts.map(function (x) { return x.replace(/\D/g, ""); }).filter(function (x) { return x.length === 5; });
    return Array.from(new Set(cleaned));
  }

  async function computeLbarRatio() {
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat || !LBAR_SITES || LBAR_SITES.length === 0) {
      return { ratio: NaN, shareStation: NaN, shareCounty: NaN, note: "LBAR inventory not loaded." };
    }

    var year = document.getElementById("yearSelect").value;
    var geoLevel = document.getElementById("geoLevel").value;

    // LBAR units in station union
    var lbarStation = 0;
    for (var i = 0; i < LBAR_SITES.length; i++) {
      var s = LBAR_SITES[i];
      if (turf.booleanPointInPolygon(turf.point([s.lon, s.lat]), unionFeat)) {
        lbarStation += s.units;
      }
    }

    // Total housing units in station union
    var huStationRes = await App.computeAcsValueOnly("B25001_001E", year, geoLevel);
    var huStation = huStationRes.value;
    var shareStation = (Number.isFinite(huStation) && huStation > 0) ? (lbarStation / huStation) : NaN;

    // County share inputs
    var counties = parseCountyListInput();
    if (counties.length === 0) {
      return { ratio: NaN, shareStation: shareStation, shareCounty: NaN, note: "Enter project counties (5-digit FIPS) to compute county share." };
    }

    var sitesWithCounty = LBAR_SITES.filter(function (s) { return s.county5 && s.county5.length === 5; });
    if (sitesWithCounty.length === 0) {
      return { ratio: NaN, shareStation: shareStation, shareCounty: NaN, note: "LBAR inventory missing county FIPS per site; cannot compute county share." };
    }

    var lbarCounty = 0;
    for (var j = 0; j < sitesWithCounty.length; j++) {
      if (counties.includes(sitesWithCounty[j].county5)) lbarCounty += sitesWithCounty[j].units;
    }

    var huCountyMap = await App.fetchACSCountyValues(year, "B25001_001E", counties);
    var huCounty = 0;
    var huFound = 0;
    for (var k = 0; k < counties.length; k++) {
      var v = huCountyMap.get(counties[k]);
      if (v != null) { huCounty += v; huFound++; }
    }

    var shareCounty = (huFound > 0 && huCounty > 0) ? (lbarCounty / huCounty) : NaN;
    var ratio = (Number.isFinite(shareStation) && Number.isFinite(shareCounty) && shareCounty > 0)
      ? (shareStation / shareCounty)
      : NaN;

    var note = Number.isFinite(shareCounty)
      ? "LBAR county share=" + (shareCounty * 100).toFixed(2) + "% (" + huFound + "/" + counties.length + " counties found in ACS)"
      : "County share unavailable.";

    return { ratio: ratio, shareStation: shareStation, shareCounty: shareCounty, note: note };
  }

  // ---- Breakpoint ratings updater ----

  async function updateBreakpointRatings() {
    var unionFeat = App.bufferUnionPolygon();
    var year = document.getElementById("yearSelect").value;
    var geoLevel = document.getElementById("geoLevel").value;

    // Reset defaults
    setPill("bpPopPill", "N/A", "na");
    setPill("bpEmpPill", "N/A", "na");
    setPill("bpLbarPill", "N/A", "na");
    setPill("bpCrePill", "N/A", "na");
    setPill("bpEssPill", "N/A", "na");

    document.getElementById("bpPopValue").textContent = "\u2014";
    document.getElementById("bpEmpValue").textContent = "\u2014";
    document.getElementById("bpLbarValue").textContent = "\u2014";
    document.getElementById("bpCreValue").textContent = "\u2014";
    document.getElementById("bpEssValue").textContent = "\u2014";

    document.getElementById("bpLbarNote").textContent = "Requires LBAR inventory + counties";
    document.getElementById("bpCreNote").textContent = "Requires CRE (tract) upload";
    document.getElementById("bpEssNote").textContent = "Requires essential services upload";

    if (!unionFeat) return;

    try {
      App.setStatus("Computing breakpoint ratings\u2026");

      // Population density
      var SQM_PER_SQMI = 2589988.110336;
      var areaSqMi = turf.area(unionFeat) / SQM_PER_SQMI;
      var popRes = await App.computeAcsValueOnly("B01003_001E", year, geoLevel);
      var popTotal = popRes.value;
      var popDensity = (Number.isFinite(popTotal) && Number.isFinite(areaSqMi) && areaSqMi > 0)
        ? (popTotal / areaSqMi) : NaN;

      document.getElementById("bpPopValue").textContent = Number.isFinite(popDensity)
        ? Math.round(popDensity).toLocaleString() + " persons/sq mile"
        : "\u2014";

      var popClass = classify(popDensity, BP.popDensity);
      setPill("bpPopPill", popClass.label, popClass.pill);

      // Employment served
      if (App.lodesData) {
        var empRes = await App.computeEmploymentServedOnly();
        var emp = empRes.value;
        document.getElementById("bpEmpValue").textContent = Number.isFinite(emp) ? emp.toLocaleString() : "\u2014";
        var empClass = classify(emp, BP.employment);
        setPill("bpEmpPill", empClass.label, empClass.pill);
      }

      // Community Risk
      if (CRE_MAP) {
        var cre = await computeCommunityRiskFromCre();
        var pct = cre.pct;
        document.getElementById("bpCreValue").textContent = Number.isFinite(pct) ? pct.toFixed(2) + "%" : "\u2014";
        var creClass = classify(pct, BP.communityRiskPct);
        setPill("bpCrePill", creClass.label, creClass.pill);
        document.getElementById("bpCreNote").textContent = "Used " + cre.used + " intersecting tracts (area-apportioned).";
      }

      // Essential services
      if (ESS_POINTS && ESS_POINTS.length > 0 && App.stations.length > 0) {
        var ess = computeEssentialServicesAvg();
        document.getElementById("bpEssValue").textContent = Number.isFinite(ess.avg) ? ess.avg.toFixed(2) : "\u2014";
        var essClass = classify(ess.avg, BP.essentialAvg);
        setPill("bpEssPill", essClass.label, essClass.pill);
        document.getElementById("bpEssNote").textContent =
          "1-mile buffers; " + App.stations.length + " stations; " + ESS_POINTS.length + " service points loaded.";
      }

      // LBAR ratio + boost
      if (LBAR_SITES && LBAR_SITES.length > 0) {
        var lbar = await computeLbarRatio();
        document.getElementById("bpLbarNote").textContent = lbar.note || "";

        if (Number.isFinite(lbar.ratio)) {
          document.getElementById("bpLbarValue").textContent =
            lbar.ratio.toFixed(2) + " (station share " + (lbar.shareStation * 100).toFixed(2) + "% / county share " + (lbar.shareCounty * 100).toFixed(2) + "%)";

          var cls = classify(lbar.ratio, BP.lbarRatio);

          if (Number.isFinite(lbar.shareCounty) && lbar.shareCounty > 0.05) {
            var bumpedLabel = bumpOneLevel(cls.label);
            var pillMap = { "Low": "low", "Medium-Low": "ml", "Medium": "med", "Medium-High": "mh", "High": "high" };
            cls = { label: bumpedLabel, pill: pillMap[bumpedLabel] || cls.pill };
            document.getElementById("bpLbarNote").textContent += " | Boost applied (county share > 5%).";
          }

          setPill("bpLbarPill", cls.label, cls.pill);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      App.setStatus("Ready");
    }
  }

  // ---- Expose on App.fta namespace for app.js wiring ----

  App.fta = {
    // State accessors (for event handlers in app.js)
    getCRE_MAP: function () { return CRE_MAP; },
    setCRE: function (headers, rows, map) { CRE_HEADERS = headers; CRE_ROWS = rows; CRE_MAP = map; },
    getESS: function () { return { points: ESS_POINTS, headers: ESS_HEADERS, rows: ESS_ROWS }; },
    setESS: function (headers, rows, points) { ESS_HEADERS = headers; ESS_ROWS = rows; ESS_POINTS = points; },
    getLBAR: function () { return { sites: LBAR_SITES, headers: LBAR_HEADERS, rows: LBAR_ROWS }; },
    setLBAR: function (headers, rows, sites) { LBAR_HEADERS = headers; LBAR_ROWS = rows; LBAR_SITES = sites; },

    // Functions needed by event handlers
    buildCreMapFromRows: buildCreMapFromRows,
    computeCommunityRiskFromCre: computeCommunityRiskFromCre,
    extractPointsFromGeoJSON: extractPointsFromGeoJSON,
    buildPointsFromCsvRows: buildPointsFromCsvRows,
    computeEssentialServicesAvg: computeEssentialServicesAvg,
    buildLbarSitesFromGeoJSON: buildLbarSitesFromGeoJSON,
    buildLbarSitesFromCsvRows: buildLbarSitesFromCsvRows,
    parseCountyListInput: parseCountyListInput,
    computeLbarRatio: computeLbarRatio,
    refreshLbarLayerVisibility: refreshLbarLayerVisibility,
    updateBreakpointRatings: updateBreakpointRatings,
    classify: classify,
    BP: BP,
    RATING_ORDER: RATING_ORDER,
    setPill: setPill
  };
})();
