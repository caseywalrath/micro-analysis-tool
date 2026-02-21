// js/projects/tpi-scoring.js
// Transit Propensity Index (TPI) scoring engine.
// Computes per-geography factor scores via corridor-only quintile normalization,
// then combines into a weighted composite index.
// No dependencies beyond App namespace (utils, census) and turf (CDN).
// Exports: TPI namespace on window.TPI

(function () {
  "use strict";

  var TPI = window.TPI = {};

  // =========================================================================
  // Factor definitions
  // =========================================================================
  // Each factor has:
  //   id            – unique key
  //   label         – human-readable name
  //   category      – grouping for UI
  //   acsVars       – array of ACS variable codes needed (null for LODES)
  //   source        – "ACS" | "LODES"
  //   compute       – function(geoValues, geoFeature, unionFeat) => raw numeric value
  //                    geoValues is a Map(varCode -> number) for this geography
  //   higherIsBetter – if true, higher raw values get higher quintile scores
  //   defaultWeight – default weight (0-100); weights sum to 100
  //   description   – tooltip/help text

  var SQM_PER_SQMI = 2589988.110336;

  var FACTORS = [
    {
      id: "pop_density",
      label: "Population Density",
      category: "Demographics",
      acsVars: ["B01003_001E"],
      source: "ACS",
      compute: function (vals, geoFeat) {
        var pop = vals.get("B01003_001E");
        if (!Number.isFinite(pop)) return NaN;
        var areaSqMi = turf.area(geoFeat) / SQM_PER_SQMI;
        return areaSqMi > 0 ? pop / areaSqMi : NaN;
      },
      higherIsBetter: true,
      defaultWeight: 15,
      description: "Total population per square mile (ACS B01003_001E / geography area)"
    },
    {
      id: "employment",
      label: "Employment Density",
      category: "Employment",
      acsVars: null,
      source: "LODES",
      compute: null, // computed separately via LODES block aggregation
      higherIsBetter: true,
      defaultWeight: 15,
      description: "LODES WAC C000 jobs aggregated to geography, divided by area"
    },
    {
      id: "zero_car",
      label: "Zero-Vehicle Households",
      category: "Transit Dependence",
      acsVars: ["B08201_002E", "B11001_001E"],
      tractOnly: true,
      source: "ACS",
      compute: function (vals) {
        var zeroCar = vals.get("B08201_002E");
        var totalHH = vals.get("B11001_001E");
        if (!Number.isFinite(zeroCar) || !Number.isFinite(totalHH) || totalHH <= 0) return NaN;
        return (zeroCar / totalHH) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 12,
      description: "Percent of households with zero vehicles (ACS B08201_002E / B11001_001E)"
    },
    {
      id: "poverty",
      label: "Low-Income % (Poverty)",
      category: "Transit Dependence",
      acsVars: ["B17001_002E", "B01003_001E"],
      source: "ACS",
      compute: function (vals) {
        var povPop = vals.get("B17001_002E");
        var totalPop = vals.get("B01003_001E");
        if (!Number.isFinite(povPop) || !Number.isFinite(totalPop) || totalPop <= 0) return NaN;
        return (povPop / totalPop) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 12,
      description: "Percent of persons below poverty level (ACS B17001_002E / B01003_001E)"
    },
    {
      id: "senior",
      label: "Senior 65+ %",
      category: "Equity",
      acsVars: [
        "B01001_020E","B01001_021E","B01001_022E","B01001_023E","B01001_024E","B01001_025E",
        "B01001_044E","B01001_045E","B01001_046E","B01001_047E","B01001_048E","B01001_049E",
        "B01003_001E"
      ],
      source: "ACS",
      compute: function (vals) {
        var totalPop = vals.get("B01003_001E");
        if (!Number.isFinite(totalPop) || totalPop <= 0) return NaN;
        var seniorCodes = [
          "B01001_020E","B01001_021E","B01001_022E","B01001_023E","B01001_024E","B01001_025E",
          "B01001_044E","B01001_045E","B01001_046E","B01001_047E","B01001_048E","B01001_049E"
        ];
        var seniorSum = 0;
        for (var si = 0; si < seniorCodes.length; si++) {
          var sv = vals.get(seniorCodes[si]);
          if (Number.isFinite(sv)) seniorSum += sv;
        }
        return (seniorSum / totalPop) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 10,
      description: "Percent of population age 65 and over (ACS B01001 males + females 65+ / B01003_001E)"
    },
    {
      id: "disability",
      label: "Disability %",
      category: "Equity",
      acsVars: [
        "B18101_004E","B18101_007E","B18101_010E","B18101_013E","B18101_016E","B18101_019E",
        "B18101_023E","B18101_026E","B18101_029E","B18101_032E","B18101_035E","B18101_038E",
        "B18101_001E"
      ],
      source: "ACS",
      compute: function (vals) {
        var denom = vals.get("B18101_001E");
        if (!Number.isFinite(denom) || denom <= 0) return NaN;
        var disabCodes = [
          "B18101_004E","B18101_007E","B18101_010E","B18101_013E","B18101_016E","B18101_019E",
          "B18101_023E","B18101_026E","B18101_029E","B18101_032E","B18101_035E","B18101_038E"
        ];
        var disabSum = 0;
        for (var di = 0; di < disabCodes.length; di++) {
          var dv = vals.get(disabCodes[di]);
          if (Number.isFinite(dv)) disabSum += dv;
        }
        return (disabSum / denom) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 10,
      description: "Percent of civilian noninstitutionalized population with a disability (ACS B18101)"
    },
    {
      id: "poc",
      label: "People of Color %",
      category: "Equity",
      acsVars: ["B03002_001E", "B03002_003E"],
      source: "ACS",
      compute: function (vals) {
        var total   = vals.get("B03002_001E");
        var nhWhite = vals.get("B03002_003E");
        if (!Number.isFinite(total) || !Number.isFinite(nhWhite) || total <= 0) return NaN;
        return ((total - nhWhite) / total) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 10,
      description: "Percent of population who are people of color (ACS B03002: total minus NH White alone)"
    },
    {
      id: "youth",
      label: "Youth <18 %",
      category: "Equity",
      acsVars: [
        "B01001_003E","B01001_004E","B01001_005E","B01001_006E",
        "B01001_027E","B01001_028E","B01001_029E","B01001_030E",
        "B01003_001E"
      ],
      source: "ACS",
      compute: function (vals) {
        var totalPop = vals.get("B01003_001E");
        if (!Number.isFinite(totalPop) || totalPop <= 0) return NaN;
        var youthCodes = [
          "B01001_003E","B01001_004E","B01001_005E","B01001_006E",
          "B01001_027E","B01001_028E","B01001_029E","B01001_030E"
        ];
        var youthSum = 0;
        for (var yi = 0; yi < youthCodes.length; yi++) {
          var yv = vals.get(youthCodes[yi]);
          if (Number.isFinite(yv)) youthSum += yv;
        }
        return (youthSum / totalPop) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 8,
      description: "Percent of population under 18 years old (ACS B01001 males + females under 18 / B01003_001E)"
    },
    {
      id: "lep",
      label: "LEP %",
      category: "Equity",
      acsVars: [
        "C16001_005E","C16001_008E","C16001_011E","C16001_014E","C16001_017E","C16001_020E",
        "C16001_023E","C16001_026E","C16001_029E","C16001_032E","C16001_035E","C16001_038E",
        "C16001_001E"
      ],
      tractOnly: true,
      source: "ACS",
      compute: function (vals) {
        var denom = vals.get("C16001_001E");
        if (!Number.isFinite(denom) || denom <= 0) return NaN;
        var lepCodes = [
          "C16001_005E","C16001_008E","C16001_011E","C16001_014E","C16001_017E","C16001_020E",
          "C16001_023E","C16001_026E","C16001_029E","C16001_032E","C16001_035E","C16001_038E"
        ];
        var lepSum = 0;
        for (var li = 0; li < lepCodes.length; li++) {
          var lv = vals.get(lepCodes[li]);
          if (Number.isFinite(lv)) lepSum += lv;
        }
        return (lepSum / denom) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 8,
      description: "Percent of population age 5+ who speak English less than very well (ACS C16001)"
    }
  ];

  TPI.FACTORS = FACTORS;

  // =========================================================================
  // Collect unique ACS variable codes needed across all active factors
  // =========================================================================

  function getRequiredAcsVars(weights) {
    var codes = new Set();
    for (var i = 0; i < FACTORS.length; i++) {
      var f = FACTORS[i];
      if (weights && weights[f.id] === 0) continue; // skip disabled factors
      if (f.acsVars) {
        for (var j = 0; j < f.acsVars.length; j++) codes.add(f.acsVars[j]);
      }
    }
    return Array.from(codes);
  }
  TPI.getRequiredAcsVars = getRequiredAcsVars;

  // =========================================================================
  // Batch ACS fetch: fetches all required variables in one pass per county group
  // Returns Map(geoid -> Map(varCode -> value))
  // =========================================================================

  async function batchFetchACS(geoLevel, year, geoids, varCodes) {
    if (varCodes.length === 0 || geoids.length === 0) return new Map();

    // Census API allows max 50 columns per request; NAME always uses one slot.
    var CHUNK_SIZE = 49;
    var chunks = [];
    for (var ci = 0; ci < varCodes.length; ci += CHUNK_SIZE) {
      chunks.push(varCodes.slice(ci, ci + CHUNK_SIZE));
    }

    // Group geoids by state-county
    var groups = new Map();
    for (var gi = 0; gi < geoids.length; gi++) {
      var geoid = geoids[gi];
      var state = geoid.slice(0, 2);
      var county = geoid.slice(2, 5);
      var key = state + "-" + county;
      if (!groups.has(key)) groups.set(key, { state: state, county: county });
    }

    // Per-geography results: Map(geoid -> Map(varCode -> value))
    var result = new Map();
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

      // Fetch each chunk sequentially; merge into the same Map per GEOID
      for (var chi = 0; chi < chunks.length; chi++) {
        var chunk = chunks[chi];
        var url = base + "?get=NAME," + encodeURIComponent(chunk.join(",")) + "&for=" + forClause + "&in=" + inClause;
        var resp = await fetch(url);
        if (!resp.ok) throw new Error("ACS batch error " + resp.status + " for state " + entry.state + " county " + entry.county + " (chunk " + (chi + 1) + ")");
        var rows = await resp.json();

        var header = rows[0];
        var varIndices = {};
        for (var vi = 0; vi < chunk.length; vi++) {
          var idx = header.indexOf(chunk[vi]);
          if (idx !== -1) varIndices[chunk[vi]] = idx;
        }

        for (var ri = 1; ri < rows.length; ri++) {
          var r = rows[ri];
          var gid;
          if (geoLevel === "tract") {
            gid = r[header.indexOf("state")] + r[header.indexOf("county")] + r[header.indexOf("tract")];
          } else {
            gid = r[header.indexOf("state")] + r[header.indexOf("county")] + r[header.indexOf("tract")] + r[header.indexOf("block group")];
          }

          // Create Map for this GEOID on first chunk; reuse on subsequent chunks (merge)
          if (!result.has(gid)) result.set(gid, new Map());
          var valMap = result.get(gid);
          for (var vc in varIndices) {
            var raw = r[varIndices[vc]];
            if (raw === null || raw === undefined || raw === "") continue;
            var val = Number(raw);
            if (Number.isFinite(val)) valMap.set(vc, val);
          }
        }
      }
    }
    return result;
  }
  TPI.batchFetchACS = batchFetchACS;

  // =========================================================================
  // Aggregate LODES data to tract/BG level
  // Returns Map(geoid -> jobCount)
  // =========================================================================

  function aggregateLodesToGeo(lodesData, geoids, geoLevel) {
    if (!lodesData) return new Map();
    // LODES w_geocode is a 15-digit block GEOID
    // Tract GEOID = first 11 digits, BG GEOID = first 12 digits
    var prefixLen = (geoLevel === "tract") ? 11 : 12;
    var geoidSet = new Set(geoids);
    var result = new Map();

    for (var entry of lodesData.entries()) {
      var blockGeoid = entry[0];
      var jobs = entry[1];
      var prefix = String(blockGeoid).slice(0, prefixLen);
      if (!geoidSet.has(prefix)) continue;
      result.set(prefix, (result.get(prefix) || 0) + jobs);
    }
    return result;
  }
  TPI.aggregateLodesToGeo = aggregateLodesToGeo;

  // =========================================================================
  // Quintile normalization (corridor-only)
  // Assigns each geography a score 1-5 based on its rank within the corridor.
  // For small N (<5), uses equal-interval breaks.
  // =========================================================================

  function computeQuintiles(values) {
    // values: array of { geoid, rawValue }
    // Returns Map(geoid -> quintile 1-5)
    var result = new Map();

    // Filter to finite values
    var valid = values.filter(function (v) { return Number.isFinite(v.rawValue); });
    if (valid.length === 0) return result;

    if (valid.length < 5) {
      // Too few for meaningful quintiles — use equal-interval
      var sorted = valid.slice().sort(function (a, b) { return a.rawValue - b.rawValue; });
      var minVal = sorted[0].rawValue;
      var maxVal = sorted[sorted.length - 1].rawValue;
      var range = maxVal - minVal;

      for (var ei = 0; ei < sorted.length; ei++) {
        var score;
        if (range === 0) {
          score = 3; // all equal -> middle
        } else {
          score = Math.min(5, Math.max(1, Math.ceil(((sorted[ei].rawValue - minVal) / range) * 5)));
        }
        result.set(sorted[ei].geoid, score);
      }
      return result;
    }

    // Standard quintile: sort and divide into 5 equal groups
    var sorted2 = valid.slice().sort(function (a, b) { return a.rawValue - b.rawValue; });
    var n = sorted2.length;

    for (var qi = 0; qi < n; qi++) {
      // Position 0..n-1 maps to quintile 1..5
      var quintile = Math.min(5, Math.floor((qi / n) * 5) + 1);
      result.set(sorted2[qi].geoid, quintile);
    }
    return result;
  }
  TPI.computeQuintiles = computeQuintiles;

  // =========================================================================
  // Normalize a factor: flip direction if higherIsBetter is false
  // =========================================================================

  function normalizeQuintiles(quintileMap, higherIsBetter) {
    if (higherIsBetter) return quintileMap;
    // Invert: 1->5, 2->4, 3->3, 4->2, 5->1
    var inverted = new Map();
    for (var entry of quintileMap.entries()) {
      inverted.set(entry[0], 6 - entry[1]);
    }
    return inverted;
  }

  // =========================================================================
  // Compute composite TPI score for each geography
  // =========================================================================
  // factorScores: Map(factorId -> Map(geoid -> quintile 1-5))
  // weights: { factorId -> weight (0-100) }
  // Returns Map(geoid -> { composite, factors: { factorId: score } })

  function computeComposite(factorScores, weights, allGeoids) {
    var result = new Map();

    // Normalize weights to sum to 1 (excluding factors with weight 0)
    var activeFactors = [];
    var totalWeight = 0;
    for (var i = 0; i < FACTORS.length; i++) {
      var fid = FACTORS[i].id;
      var w = (weights && weights[fid] != null) ? weights[fid] : FACTORS[i].defaultWeight;
      if (w > 0 && factorScores.has(fid)) {
        activeFactors.push({ id: fid, weight: w });
        totalWeight += w;
      }
    }

    for (var gi = 0; gi < allGeoids.length; gi++) {
      var geoid = allGeoids[gi];
      var factorDetail = {};
      var weightedSum = 0;
      var availableWeight = 0;

      for (var ai = 0; ai < activeFactors.length; ai++) {
        var af = activeFactors[ai];
        var scoreMap = factorScores.get(af.id);
        var score = scoreMap ? scoreMap.get(geoid) : undefined;
        factorDetail[af.id] = score || null;

        if (score != null) {
          weightedSum += score * (af.weight / totalWeight);
          availableWeight += af.weight / totalWeight;
        }
      }

      // Redistribute weight from missing factors
      var composite = availableWeight > 0 ? (weightedSum / availableWeight) : NaN;

      result.set(geoid, {
        composite: composite,
        factors: factorDetail
      });
    }
    return result;
  }
  TPI.computeComposite = computeComposite;

  // =========================================================================
  // Re-score from cached rawValues (no API calls)
  // =========================================================================
  // rawValues: Map(factorId -> Map(geoid -> rawValue))  — from a prior computeTPI result
  // weights:   { factorId -> weight }
  // geoids:    string[]
  // Returns:   { scores, factorScores, effectiveWeights }  (same shape as computeTPI return)

  function rescoreFromRaw(rawValues, weights, geoids) {
    var effectiveWeights = {};
    for (var wi = 0; wi < FACTORS.length; wi++) {
      var fid = FACTORS[wi].id;
      effectiveWeights[fid] = (weights[fid] != null) ? weights[fid] : FACTORS[wi].defaultWeight;
    }

    var factorScores = new Map();
    for (var ni = 0; ni < FACTORS.length; ni++) {
      var nf = FACTORS[ni];
      if (effectiveWeights[nf.id] === 0) continue;
      var rawMap = rawValues.get(nf.id);
      if (!rawMap || rawMap.size === 0) continue;
      var valArray = [];
      for (var entry of rawMap.entries()) {
        valArray.push({ geoid: entry[0], rawValue: entry[1] });
      }
      factorScores.set(nf.id, normalizeQuintiles(computeQuintiles(valArray), nf.higherIsBetter));
    }

    return {
      scores: computeComposite(factorScores, effectiveWeights, geoids),
      factorScores: factorScores,
      effectiveWeights: effectiveWeights
    };
  }
  TPI.rescoreFromRaw = rescoreFromRaw;

  // =========================================================================
  // Main orchestrator: run full TPI computation
  // =========================================================================
  // options: { geoLevel, year, weights, lodesData, onProgress }
  // Returns { geos, geoids, scores, factorScores, rawValues }

  async function computeTPI(options) {
    var geoLevel = options.geoLevel || "bg";
    var year = options.year || "2023";
    var weights = options.weights || {};
    var lodesData = options.lodesData || null;
    var onProgress = options.onProgress || function () {};

    // Build effective weights: use defaults where not overridden
    var effectiveWeights = {};
    for (var wi = 0; wi < FACTORS.length; wi++) {
      var fid = FACTORS[wi].id;
      effectiveWeights[fid] = (weights[fid] != null) ? weights[fid] : FACTORS[wi].defaultWeight;
    }

    // If no LODES data, redistribute employment weight to others
    if (!lodesData) {
      var empWeight = effectiveWeights.employment || 0;
      effectiveWeights.employment = 0;
      if (empWeight > 0) {
        var otherActive = FACTORS.filter(function (f) {
          return f.id !== "employment" && effectiveWeights[f.id] > 0;
        });
        var share = empWeight / (otherActive.length || 1);
        for (var oi = 0; oi < otherActive.length; oi++) {
          effectiveWeights[otherActive[oi].id] += share;
        }
      }
    }

    // 1. Get buffer union
    onProgress("Getting buffer union...");
    var unionFeat = App.bufferUnionPolygon();
    if (!unionFeat) throw new Error("No buffers set. Place stations, lines, or routes first.");

    // 2. Fetch census geographies
    onProgress("Fetching census geographies...");
    var geos = await App.fetchTigerwebGeos(geoLevel, unionFeat);
    if (geos.length === 0) throw new Error("No intersecting " + (geoLevel === "tract" ? "tracts" : "block groups") + " found.");

    var geoids = geos.map(function (f) { return f.properties.GEOID; }).filter(Boolean);

    // 3. Batch fetch all required ACS variables, with tract-level fallback for tract-only tables
    var allAcsVars = getRequiredAcsVars(effectiveWeights);
    var tractFallbackFactors = []; // factor ids that used tract-level data when BG was requested

    var acsData; // Map(geoid -> Map(varCode -> value)), keyed by the requested geoLevel GEOID

    if (geoLevel === "bg") {
      // Identify which vars belong to tract-only factors
      var tractOnlyVarSet = new Set();
      for (var tfi = 0; tfi < FACTORS.length; tfi++) {
        var tf = FACTORS[tfi];
        if (tf.tractOnly && effectiveWeights[tf.id] !== 0 && tf.acsVars) {
          for (var tvi = 0; tvi < tf.acsVars.length; tvi++) tractOnlyVarSet.add(tf.acsVars[tvi]);
          tractFallbackFactors.push(tf.id);
        }
      }

      var bgVars = allAcsVars.filter(function (v) { return !tractOnlyVarSet.has(v); });
      var tractOnlyVars = allAcsVars.filter(function (v) { return tractOnlyVarSet.has(v); });

      onProgress("Fetching ACS data (" + allAcsVars.length + " variables)...");

      // Fetch BG-level vars
      acsData = await batchFetchACS("bg", year, geoids, bgVars);

      // Fetch tract-level vars if any, then map values down to BG GEOIDs
      if (tractOnlyVars.length > 0) {
        // Derive unique tract GEOIDs from BG GEOIDs (first 11 chars)
        var tractGeoidSet = new Set();
        for (var bgi = 0; bgi < geoids.length; bgi++) tractGeoidSet.add(geoids[bgi].slice(0, 11));
        var tractGeoids = Array.from(tractGeoidSet);

        onProgress("Fetching tract-level data for " + tractFallbackFactors.join(", ") + "...");
        var tractData = await batchFetchACS("tract", year, tractGeoids, tractOnlyVars);

        // Copy tract values into each BG's entry, keyed by the BG GEOID
        for (var bgi2 = 0; bgi2 < geoids.length; bgi2++) {
          var bgGeo = geoids[bgi2];
          var parentTract = bgGeo.slice(0, 11);
          var tractVals = tractData.get(parentTract) || new Map();
          if (!acsData.has(bgGeo)) acsData.set(bgGeo, new Map());
          var bgEntry = acsData.get(bgGeo);
          for (var tractEntry of tractVals.entries()) {
            bgEntry.set(tractEntry[0], tractEntry[1]);
          }
        }
      }
    } else {
      // Tract level: no fallback needed, all vars available natively
      onProgress("Fetching ACS data (" + allAcsVars.length + " variables)...");
      acsData = await batchFetchACS("tract", year, geoids, allAcsVars);
    }

    // 4. Aggregate LODES to geo level (if available and weighted)
    var lodesAgg = null;
    if (lodesData && effectiveWeights.employment > 0) {
      onProgress("Aggregating LODES employment data...");
      lodesAgg = aggregateLodesToGeo(lodesData, geoids, geoLevel);
    }

    // 5. Compute raw values for each factor x geography
    onProgress("Computing factor values...");
    var rawValues = new Map(); // Map(factorId -> Map(geoid -> rawValue))

    for (var fi = 0; fi < FACTORS.length; fi++) {
      var factor = FACTORS[fi];
      if (effectiveWeights[factor.id] === 0) continue;

      var raw = new Map();

      if (factor.source === "LODES" && factor.id === "employment") {
        if (lodesAgg) {
          for (var gIdx = 0; gIdx < geos.length; gIdx++) {
            var gf = geos[gIdx];
            var gid = gf.properties.GEOID;
            var jobs = lodesAgg.get(gid) || 0;
            var areaSqMi = turf.area(gf) / SQM_PER_SQMI;
            raw.set(gid, areaSqMi > 0 ? jobs / areaSqMi : NaN);
          }
        }
      } else if (factor.compute) {
        for (var gIdx2 = 0; gIdx2 < geos.length; gIdx2++) {
          var gf2 = geos[gIdx2];
          var gid2 = gf2.properties.GEOID;
          var geoVals = acsData.get(gid2) || new Map();
          var val = factor.compute(geoVals, gf2, unionFeat);
          raw.set(gid2, val);
        }
      }

      rawValues.set(factor.id, raw);
    }

    // 6. Quintile normalize each factor
    onProgress("Normalizing scores...");
    var factorScores = new Map(); // Map(factorId -> Map(geoid -> 1-5))

    for (var ni = 0; ni < FACTORS.length; ni++) {
      var nf = FACTORS[ni];
      if (effectiveWeights[nf.id] === 0) continue;
      var rawMap = rawValues.get(nf.id);
      if (!rawMap || rawMap.size === 0) continue;

      // Build values array for quintile computation
      var valArray = [];
      for (var entry of rawMap.entries()) {
        valArray.push({ geoid: entry[0], rawValue: entry[1] });
      }

      var quintiles = computeQuintiles(valArray);
      var normalized = normalizeQuintiles(quintiles, nf.higherIsBetter);
      factorScores.set(nf.id, normalized);
    }

    // 7. Compute composite
    onProgress("Computing composite scores...");
    var scores = computeComposite(factorScores, effectiveWeights, geoids);

    return {
      geos: geos,
      geoids: geoids,
      scores: scores,
      factorScores: factorScores,
      rawValues: rawValues,
      effectiveWeights: effectiveWeights,
      tractFallbackFactors: tractFallbackFactors
    };
  }
  TPI.computeTPI = computeTPI;

  // =========================================================================
  // Utility: get default weights as an object
  // =========================================================================

  function getDefaultWeights() {
    var w = {};
    for (var i = 0; i < FACTORS.length; i++) {
      w[FACTORS[i].id] = FACTORS[i].defaultWeight;
    }
    return w;
  }
  TPI.getDefaultWeights = getDefaultWeights;

})();
