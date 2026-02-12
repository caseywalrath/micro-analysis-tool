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

  // Breakpoint tables sorted high-to-low. classify() checks value >= min,
  // returning the first (highest) match. No max needed — contiguous by design.
  var BP = {
    popDensity: [
      { label: "High",        pill: "high", min: 15000 },
      { label: "Medium-High", pill: "mh",   min: 9600 },
      { label: "Medium",      pill: "med",  min: 5760 },
      { label: "Medium-Low",  pill: "ml",   min: 2560 },
      { label: "Low",         pill: "low",  min: -Infinity }
    ],
    employment: [
      { label: "High",        pill: "high", min: 220000 },
      { label: "Medium-High", pill: "mh",   min: 140000 },
      { label: "Medium",      pill: "med",  min: 70000 },
      { label: "Medium-Low",  pill: "ml",   min: 40000 },
      { label: "Low",         pill: "low",  min: -Infinity }
    ],
    lbarRatio: [
      { label: "High",        pill: "high", min: 2.50 },
      { label: "Medium-High", pill: "mh",   min: 2.25 },
      { label: "Medium",      pill: "med",  min: 1.50 },
      { label: "Medium-Low",  pill: "ml",   min: 1.10 },
      { label: "Low",         pill: "low",  min: -Infinity }
    ],
    communityRiskPct: [
      { label: "High",        pill: "high", min: 50.0 },
      { label: "Medium-High", pill: "mh",   min: 40.0 },
      { label: "Medium",      pill: "med",  min: 18.0 },
      { label: "Medium-Low",  pill: "ml",   min: 5.0 },
      { label: "Low",         pill: "low",  min: -Infinity }
    ],
    essentialAvg: [
      { label: "High",        pill: "high", min: 7.0 },
      { label: "Medium-High", pill: "mh",   min: 5.0 },
      { label: "Medium",      pill: "med",  min: 3.0 },
      { label: "Medium-Low",  pill: "ml",   min: 1.0 },
      { label: "Low",         pill: "low",  min: -Infinity }
    ]
  };

  var RATING_ORDER = ["Low", "Medium-Low", "Medium", "Medium-High", "High"];

  function classify(value, breakpoints) {
    if (!Number.isFinite(value)) return { label: "N/A", pill: "na" };
    for (var i = 0; i < breakpoints.length; i++) {
      if (value >= breakpoints[i].min) return { label: breakpoints[i].label, pill: breakpoints[i].pill };
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

  // ---- FTA event handler init (called by app.js after panel HTML is loaded) ----

  function init() {
    // LBAR layer toggle
    var toggleLbar = document.getElementById("toggleLbarLayer");
    if (toggleLbar) {
      toggleLbar.addEventListener("change", function () {
        refreshLbarLayerVisibility();
      });
    }

    // County FIPS input
    var lbarCountiesInput = document.getElementById("lbarCounties");
    if (lbarCountiesInput) {
      lbarCountiesInput.addEventListener("input", function () {
        updateBreakpointRatings();
      });
    }

    // CRE upload
    var creFileInput = document.getElementById("creFile");
    if (creFileInput) {
      creFileInput.addEventListener("change", async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          App.setStatus("Loading CRE CSV\u2026");
          var text = await file.text();
          var parsed = App.parseCSV(text);

          CRE_HEADERS = parsed.headers;
          CRE_ROWS = parsed.rows;

          var sG = document.getElementById("creColGEOID");
          var sT = document.getElementById("creColTotal");
          var sH = document.getElementById("creColHigh");

          App.fillSelect(sG, CRE_HEADERS, "Select GEOID column\u2026");
          App.fillSelect(sT, CRE_HEADERS, "Select total population column\u2026");
          App.fillSelect(sH, CRE_HEADERS, "Select high-risk population column\u2026");

          App.enableSelect(sG, true);
          App.enableSelect(sT, true);
          App.enableSelect(sH, true);

          sG.value = App.guessHeader(CRE_HEADERS, ["GEO_ID", "geoid", "GEOID"]);
          sT.value = App.guessHeader(CRE_HEADERS, ["POPUNI", "total", "TOT_POP", "population"]);
          sH.value = App.guessHeader(CRE_HEADERS, ["PRED3_E", "HIGH_RISK", "high_risk", "risk3plus"]);

          function rebuildCre() {
            if (!sG.value || !sT.value || !sH.value) {
              CRE_MAP = null;
              document.getElementById("creInfo").textContent = "Select required columns to enable CRE computations.";
              updateBreakpointRatings();
              return;
            }
            CRE_MAP = buildCreMapFromRows(sG.value, sT.value, sH.value);

            var sampleRaw = CRE_ROWS.length ? CRE_ROWS[0][sG.value] : "";
            var sampleNorm = App.normalizeTractGEOID(sampleRaw);

            document.getElementById("creInfo").textContent =
              "Loaded " + file.name + ": " + CRE_MAP.size.toLocaleString() + " tracts mapped. " +
              (sampleRaw ? 'Sample GEOID: "' + sampleRaw + '" -> "' + sampleNorm + '"' : "");

            if (CRE_MAP.size === 0 && CRE_ROWS.length > 0) {
              document.getElementById("creInfo").textContent +=
                " | If this remains 0, confirm GEO_ID contains tract IDs ending in 11 digits and selected columns are numeric.";
            }

            updateBreakpointRatings();
          }

          sG.onchange = rebuildCre;
          sT.onchange = rebuildCre;
          sH.onchange = rebuildCre;

          rebuildCre();
          App.setStatus("Ready");
        } catch (err) {
          CRE_MAP = null;
          CRE_HEADERS = [];
          CRE_ROWS = [];
          document.getElementById("creInfo").textContent = "Error: " + String(err && err.message ? err.message : err);
          App.setStatus("Error");
          updateBreakpointRatings();
        }
      });
    }

    // Essential services upload
    var essFileInput = document.getElementById("essFile");
    if (essFileInput) {
      essFileInput.addEventListener("change", async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          App.setStatus("Loading essential services\u2026");
          var name = file.name.toLowerCase();

          ESS_POINTS = null;
          ESS_HEADERS = [];
          ESS_ROWS = [];

          var latSel = document.getElementById("essColLat");
          var lonSel = document.getElementById("essColLon");

          if (name.endsWith(".json") || name.endsWith(".geojson")) {
            var text = await file.text();
            var obj = JSON.parse(text);
            ESS_POINTS = extractPointsFromGeoJSON(obj);

            App.fillSelect(latSel, [], "N/A (GeoJSON)");
            App.fillSelect(lonSel, [], "N/A (GeoJSON)");
            App.enableSelect(latSel, false);
            App.enableSelect(lonSel, false);

            document.getElementById("essInfo").textContent =
              "Loaded " + file.name + ": " + ESS_POINTS.length.toLocaleString() + " points.";
          } else if (name.endsWith(".csv")) {
            var csvText = await file.text();
            var parsed = App.parseCSV(csvText);
            ESS_HEADERS = parsed.headers;
            ESS_ROWS = parsed.rows;

            App.fillSelect(latSel, ESS_HEADERS, "Select latitude column\u2026");
            App.fillSelect(lonSel, ESS_HEADERS, "Select longitude column\u2026");
            App.enableSelect(latSel, true);
            App.enableSelect(lonSel, true);

            latSel.value = App.guessHeader(ESS_HEADERS, ["lat", "latitude", "y", "LAT", "Latitude"]);
            lonSel.value = App.guessHeader(ESS_HEADERS, ["lon", "lng", "longitude", "x", "LON", "Longitude"]);

            function rebuildEss() {
              if (!latSel.value || !lonSel.value) {
                ESS_POINTS = null;
                document.getElementById("essInfo").textContent = "Select lat/lon columns to enable essential services computations.";
                updateBreakpointRatings();
                return;
              }
              ESS_POINTS = buildPointsFromCsvRows(ESS_ROWS, latSel.value, lonSel.value);
              document.getElementById("essInfo").textContent =
                "Loaded " + file.name + ": " + ESS_POINTS.length.toLocaleString() + " points from CSV.";
              updateBreakpointRatings();
            }

            latSel.onchange = rebuildEss;
            lonSel.onchange = rebuildEss;

            rebuildEss();
          } else {
            throw new Error("Unsupported file type. Upload .geojson/.json or .csv.");
          }

          App.setStatus("Ready");
          updateBreakpointRatings();
        } catch (err) {
          ESS_POINTS = null;
          document.getElementById("essInfo").textContent = "Error: " + String(err && err.message ? err.message : err);
          App.setStatus("Error");
          updateBreakpointRatings();
        }
      });
    }

    // LBAR upload
    var lbarFileInput = document.getElementById("lbarFile");
    if (lbarFileInput) {
      lbarFileInput.addEventListener("change", async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          App.setStatus("Loading LBAR inventory\u2026");
          var name = file.name.toLowerCase();

          LBAR_SITES = null;
          LBAR_HEADERS = [];
          LBAR_ROWS = [];

          var latSel = document.getElementById("lbarColLat");
          var lonSel = document.getElementById("lbarColLon");
          var uniSel = document.getElementById("lbarColUnits");
          var ctySel = document.getElementById("lbarColCounty");

          if (name.endsWith(".json") || name.endsWith(".geojson")) {
            var text = await file.text();
            var obj = JSON.parse(text);
            LBAR_SITES = buildLbarSitesFromGeoJSON(obj);

            App.fillSelect(latSel, [], "N/A (GeoJSON)");
            App.fillSelect(lonSel, [], "N/A (GeoJSON)");
            App.fillSelect(uniSel, [], "N/A (GeoJSON)");
            App.fillSelect(ctySel, [], "N/A (GeoJSON)");
            App.enableSelect(latSel, false);
            App.enableSelect(lonSel, false);
            App.enableSelect(uniSel, false);
            App.enableSelect(ctySel, false);

            document.getElementById("lbarInfo").textContent =
              "Loaded " + file.name + ": " + LBAR_SITES.length.toLocaleString() + " sites (expects properties.units and optional properties.county).";

            refreshLbarLayerVisibility();
            updateBreakpointRatings();
          } else if (name.endsWith(".csv")) {
            var csvText = await file.text();
            var parsed = App.parseCSV(csvText);
            LBAR_HEADERS = parsed.headers;
            LBAR_ROWS = parsed.rows;

            App.fillSelect(latSel, LBAR_HEADERS, "Select latitude column\u2026");
            App.fillSelect(lonSel, LBAR_HEADERS, "Select longitude column\u2026");
            App.fillSelect(uniSel, LBAR_HEADERS, "Select units column\u2026");
            App.fillSelect(ctySel, LBAR_HEADERS, "(Optional) Select county FIPS column\u2026");

            App.enableSelect(latSel, true);
            App.enableSelect(lonSel, true);
            App.enableSelect(uniSel, true);
            App.enableSelect(ctySel, true);

            latSel.value = App.guessHeader(LBAR_HEADERS, ["lat", "latitude", "y", "LAT", "Latitude"]);
            lonSel.value = App.guessHeader(LBAR_HEADERS, ["lon", "lng", "longitude", "x", "LON", "Longitude"]);
            uniSel.value = App.guessHeader(LBAR_HEADERS, ["units", "lbar_units", "LBAR_UNITS", "UNITS", "Total Low-Income Units"]);
            ctySel.value = App.guessHeader(LBAR_HEADERS, ["county_fips", "county", "COUNTY", "COUNTY_FIPS", "FIPS"]);

            function rebuildLbar() {
              if (!latSel.value || !lonSel.value || !uniSel.value) {
                LBAR_SITES = null;
                document.getElementById("lbarInfo").textContent =
                  "Select required columns (lat/lon/units) to enable LBAR computations.";
                refreshLbarLayerVisibility();
                updateBreakpointRatings();
                return;
              }
              var countyCol = ctySel.value || null;
              LBAR_SITES = buildLbarSitesFromCsvRows(LBAR_ROWS, latSel.value, lonSel.value, uniSel.value, countyCol);

              var hasCounty = LBAR_SITES.some(function (s) { return s.county5 && s.county5.length === 5; });
              document.getElementById("lbarInfo").textContent =
                "Loaded " + file.name + ": " + LBAR_SITES.length.toLocaleString() + " sites. County FIPS present: " + (hasCounty ? "Yes" : "No") + ".";

              refreshLbarLayerVisibility();
              updateBreakpointRatings();
            }

            latSel.onchange = rebuildLbar;
            lonSel.onchange = rebuildLbar;
            uniSel.onchange = rebuildLbar;
            ctySel.onchange = rebuildLbar;

            rebuildLbar();
          } else {
            throw new Error("Unsupported file type. Upload .geojson/.json or .csv.");
          }

          App.setStatus("Ready");
        } catch (err) {
          LBAR_SITES = null;
          document.getElementById("lbarInfo").textContent = "Error: " + String(err && err.message ? err.message : err);
          App.setStatus("Error");
          refreshLbarLayerVisibility();
          updateBreakpointRatings();
        }
      });
    }

    // Initialize ratings
    updateBreakpointRatings();
  }

  // ---- Register with App as a project ----

  App.registerProject({
    id: "fta-small-starts",
    name: "FTA Small Starts (Land Use)",
    panelHTML: "projects/fta-small-starts.html",

    init: function (_core) {
      init();
    },

    update: async function (_core) {
      await updateBreakpointRatings();
      refreshLbarLayerVisibility();
    }
  });
})();
