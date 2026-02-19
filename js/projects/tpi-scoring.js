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
      defaultWeight: 20,
      description: "Total population per square mile (ACS B01003_001E / geography area)"
    },
    {
      id: "hu_density",
      label: "Housing Unit Density",
      category: "Demographics",
      acsVars: ["B25001_001E"],
      source: "ACS",
      compute: function (vals, geoFeat) {
        var hu = vals.get("B25001_001E");
        if (!Number.isFinite(hu)) return NaN;
        var areaSqMi = turf.area(geoFeat) / SQM_PER_SQMI;
        return areaSqMi > 0 ? hu / areaSqMi : NaN;
      },
      higherIsBetter: true,
      defaultWeight: 15,
      description: "Total housing units per square mile (ACS B25001_001E / geography area)"
    },
    {
      id: "employment",
      label: "Employment Density",
      category: "Employment",
      acsVars: null,
      source: "LODES",
      compute: null, // computed separately via LODES block aggregation
      higherIsBetter: true,
      defaultWeight: 20,
      description: "LODES WAC C000 jobs aggregated to geography, divided by area"
    },
    {
      id: "zero_car",
      label: "Zero-Vehicle Households",
      category: "Transit Dependence",
      acsVars: ["B08201_002E", "B11001_001E"],
      source: "ACS",
      compute: function (vals) {
        var zeroCar = vals.get("B08201_002E");
        var totalHH = vals.get("B11001_001E");
        if (!Number.isFinite(zeroCar) || !Number.isFinite(totalHH) || totalHH <= 0) return NaN;
        return (zeroCar / totalHH) * 100;
      },
      higherIsBetter: true,
      defaultWeight: 15,
      description: "Percent of households with zero vehicles (ACS B08201_002E / B11001_001E)"
    },
    {
      id: "poverty",
      label: "Poverty Rate",
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
      defaultWeight: 15,
      description: "Percent of persons below poverty level (ACS B17001_002E / B01003_001E)"
    },
    {
      id: "median_income_inv",
      label: "Low Income (inverse)",
      category: "Transit Dependence",
      acsVars: ["B19013_001E"],
      source: "ACS",
      compute: function (vals) {
        var income = vals.get("B19013_001E");
        return Number.isFinite(income) ? income : NaN;
      },
      higherIsBetter: false, // lower income => higher transit propensity
      defaultWeight: 15,
      description: "Median household income — lower values score higher (ACS B19013_001E)"
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

    // Fetch all variables in a single API call per state-county group
    var varList = varCodes.join(",");

    for (var entry of groups.values()) {
      var forClause, inClause;
      if (geoLevel === "tract") {
        forClause = "tract:*";
        inClause = "state:" + entry.state + "%20county:" + entry.county;
      } else {
        forClause = "block%20group:*";
        inClause = "state:" + entry.state + "%20county:" + entry.county + "%20tract:*";
      }

      var url = base + "?get=NAME," + encodeURIComponent(varList) + "&for=" + forClause + "&in=" + inClause;
      var resp = await fetch(url);
      if (!resp.ok) throw new Error("ACS batch error " + resp.status + " for state " + entry.state + " county " + entry.county);
      var rows = await resp.json();

      var header = rows[0];
      // Find indices for each variable code
      var varIndices = {};
      for (var vi = 0; vi < varCodes.length; vi++) {
        var idx = header.indexOf(varCodes[vi]);
        if (idx !== -1) varIndices[varCodes[vi]] = idx;
      }

      for (var ri = 1; ri < rows.length; ri++) {
        var r = rows[ri];
        var gid;
        if (geoLevel === "tract") {
          gid = r[header.indexOf("state")] + r[header.indexOf("county")] + r[header.indexOf("tract")];
        } else {
          gid = r[header.indexOf("state")] + r[header.indexOf("county")] + r[header.indexOf("tract")] + r[header.indexOf("block group")];
        }

        var valMap = new Map();
        for (var vc in varIndices) {
          var raw = r[varIndices[vc]];
          if (raw === null || raw === undefined || raw === "") continue;
          var val = Number(raw);
          if (Number.isFinite(val)) valMap.set(vc, val);
        }
        result.set(gid, valMap);
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

    // 3. Batch fetch all required ACS variables
    var acsVars = getRequiredAcsVars(effectiveWeights);
    onProgress("Fetching ACS data (" + acsVars.length + " variables)...");
    var acsData = await batchFetchACS(geoLevel, year, geoids, acsVars);

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
      effectiveWeights: effectiveWeights
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
