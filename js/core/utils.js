// js/core/utils.js
// Shared utility functions, variable metadata, and helpers.
// No dependencies beyond PapaParse (loaded via CDN).
// Exports: setStatus, parseCSV, fillSelect, enableSelect, toNumberSafe,
//          normalizeTractGEOID, guessHeader, VAR_META, getMeta, setAggUI, formatValue

(function () {
  var App = window.App = window.App || {};

  // --- Census API key (removes ~500 req/day rate limit) ---
  App.CENSUS_API_KEY = "84dd46873ff2d6d2d41d42c6e9cebfa41214fd14";

  // --- Status ---

  function setStatus(s) { var el = document.getElementById("status"); if (el) el.textContent = s; }

  // --- CSV parsing + helpers ---

  function parseCSV(text) {
    var res = Papa.parse(text, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true
    });
    if (res.errors && res.errors.length) {
      console.warn("CSV parse warnings:", res.errors.slice(0, 10));
    }
    var headers = res.meta && res.meta.fields ? res.meta.fields : [];
    var rows = res.data || [];
    return { headers: headers, rows: rows };
  }

  function fillSelect(selectEl, options, placeholder) {
    if (placeholder === undefined) placeholder = "Select\u2026";
    selectEl.innerHTML = "";
    var opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholder;
    selectEl.appendChild(opt0);
    for (var i = 0; i < options.length; i++) {
      var opt = document.createElement("option");
      opt.value = options[i];
      opt.textContent = options[i];
      selectEl.appendChild(opt);
    }
  }

  function enableSelect(selectEl, enabled) { selectEl.disabled = !enabled; }

  function toNumberSafe(v) {
    if (v == null) return NaN;
    var s = String(v).replace(/,/g, "").trim();
    if (s === "") return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function normalizeTractGEOID(raw) {
    // CRE GEO_ID is like 1400000US01001020100 -> want trailing 11 digits
    var s = String(raw || "").trim();
    var m = s.match(/(\d{11})$/);
    return m ? m[1] : "";
  }

  function guessHeader(headers, candidates) {
    var lower = new Map(headers.map(function (h) { return [h.toLowerCase(), h]; }));
    for (var i = 0; i < candidates.length; i++) {
      var v = lower.get(candidates[i].toLowerCase());
      if (v) return v;
    }
    return "";
  }

  // --- Variable metadata ---
  // Entries may have a `codes` array for multi-code ACS variables (values are summed per GEOID).
  // Entries without `codes` use their key directly as the ACS variable code.

  var VAR_META = {
    // ---- Demographics ----
    "B01003_001E": { source: "ACS", agg: "sum", fmt: "int",     label: "Total population",            category: "Demographics" },
    "B11001_001E": { source: "ACS", agg: "sum", fmt: "int",     label: "Total households",             category: "Demographics" },
    "DERIVED_PPH":  { source: "ACS", agg: "ratio", fmt: "decimal", label: "Average persons per household", category: "Demographics",
                      numerator: "B01003_001E", denominator: "B11001_001E",
                      ratioLabel: "Calculated: Total Population / Total Households" },
    "B19013_001E": { source: "ACS", agg: "avg", fmt: "usd",     label: "Median household income",      category: "Demographics", tractOnly: true },
    "B01002_001E": { source: "ACS", agg: "avg", fmt: "decimal", label: "Median age",                   category: "Demographics" },
    "B01001_002E": { source: "ACS", agg: "sum", fmt: "int",     label: "Male population",              category: "Demographics" },
    "B01001_026E": { source: "ACS", agg: "sum", fmt: "int",     label: "Female population",            category: "Demographics" },
    "B02001_002E": { source: "ACS", agg: "sum", fmt: "int",     label: "White alone",                  category: "Demographics" },
    "B02001_003E": { source: "ACS", agg: "sum", fmt: "int",     label: "Black or African American alone", category: "Demographics" },
    "B02001_004E": { source: "ACS", agg: "sum", fmt: "int",     label: "American Indian and Alaska Native alone", category: "Demographics" },
    "B02001_005E": { source: "ACS", agg: "sum", fmt: "int",     label: "Asian alone",                  category: "Demographics" },
    "B02001_006E": { source: "ACS", agg: "sum", fmt: "int",     label: "Native Hawaiian and Other Pacific Islander alone", category: "Demographics" },
    "B02001_007E": { source: "ACS", agg: "sum", fmt: "int",     label: "Some other race alone",        category: "Demographics" },
    "B02001_008E": { source: "ACS", agg: "sum", fmt: "int",     label: "Two or more races",            category: "Demographics" },
    "B03003_003E": { source: "ACS", agg: "sum", fmt: "int",     label: "Hispanic or Latino",           category: "Demographics" },
    "B03003_002E": { source: "ACS", agg: "sum", fmt: "int",     label: "Not Hispanic or Latino",       category: "Demographics" },

    // ---- Equity ----
    "C18108_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "With a disability",                                        category: "Equity" },
    "B17001_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "Persons below poverty level",                              category: "Equity" },
    "DERIVED_EDU_LT_HS":      { source: "ACS", agg: "sum", fmt: "int", label: "Less than high school diploma",                            category: "Equity",
      codes: ["B15003_002E","B15003_003E","B15003_004E","B15003_005E","B15003_006E","B15003_007E","B15003_008E",
              "B15003_009E","B15003_010E","B15003_011E","B15003_012E","B15003_013E","B15003_014E","B15003_015E","B15003_016E"] },
    "DERIVED_EDU_HS":         { source: "ACS", agg: "sum", fmt: "int", label: "High school diploma or GED",                              category: "Equity",
      codes: ["B15003_017E","B15003_018E"] },
    "DERIVED_EDU_SOME_COLLEGE":{ source: "ACS", agg: "sum", fmt: "int", label: "Some college or associate's degree",                     category: "Equity",
      codes: ["B15003_019E","B15003_020E","B15003_021E"] },
    "DERIVED_EDU_BA_PLUS":    { source: "ACS", agg: "sum", fmt: "int", label: "Bachelor's degree or higher",                             category: "Equity",
      codes: ["B15003_022E","B15003_023E","B15003_024E","B15003_025E"] },
    "DERIVED_LEP":            { source: "ACS", agg: "sum", fmt: "int", label: "Limited English proficient",                              category: "Equity", tractOnly: true,
      codes: ["C16001_005E","C16001_008E","C16001_011E","C16001_014E","C16001_017E","C16001_020E",
              "C16001_023E","C16001_026E","C16001_029E","C16001_032E","C16001_035E","C16001_038E"] },
    "B05001_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "Born in US, citizen",                                     category: "Equity" },
    "B05001_005E":            { source: "ACS", agg: "sum", fmt: "int", label: "Naturalized US citizen",                                  category: "Equity" },
    "B05001_006E":            { source: "ACS", agg: "sum", fmt: "int", label: "Not a US citizen",                                        category: "Equity" },
    "B11016_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "1-person household",                                      category: "Equity" },
    "B11016_003E":            { source: "ACS", agg: "sum", fmt: "int", label: "2-person household",                                      category: "Equity" },
    "B11016_004E":            { source: "ACS", agg: "sum", fmt: "int", label: "3-person household",                                      category: "Equity" },
    "B11016_005E":            { source: "ACS", agg: "sum", fmt: "int", label: "4-person household",                                      category: "Equity" },
    "B11016_006E":            { source: "ACS", agg: "sum", fmt: "int", label: "5-person household",                                      category: "Equity" },
    "B11016_007E":            { source: "ACS", agg: "sum", fmt: "int", label: "6-person household",                                      category: "Equity" },
    "B11016_008E":            { source: "ACS", agg: "sum", fmt: "int", label: "7+-person household",                                     category: "Equity" },
    "B08201_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "Zero-car households",                                     category: "Equity", tractOnly: true },
    "B23025_004E":            { source: "ACS", agg: "sum", fmt: "int", label: "Employed (civilian labor force)",                         category: "Equity" },
    "B23025_005E":            { source: "ACS", agg: "sum", fmt: "int", label: "Unemployed (civilian labor force)",                       category: "Equity" },
    "B23025_007E":            { source: "ACS", agg: "sum", fmt: "int", label: "Not in labor force",                                      category: "Equity" },

    // ---- Travel ----
    "DERIVED_VEH_0":          { source: "ACS", agg: "sum", fmt: "int", label: "0 vehicles available",          category: "Travel", tractOnly: true, codes: ["B08201_002E"] },
    "B08201_003E":            { source: "ACS", agg: "sum", fmt: "int", label: "1 vehicle available",            category: "Travel", tractOnly: true },
    "B08201_004E":            { source: "ACS", agg: "sum", fmt: "int", label: "2 vehicles available",           category: "Travel", tractOnly: true },
    "B08201_005E":            { source: "ACS", agg: "sum", fmt: "int", label: "3 vehicles available",           category: "Travel", tractOnly: true },
    "B08201_006E":            { source: "ACS", agg: "sum", fmt: "int", label: "4+ vehicles available",          category: "Travel", tractOnly: true },
    "B08301_002E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: drove alone",            category: "Travel" },
    "B08301_003E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: carpooled",              category: "Travel" },
    "B08301_010E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: public transit",         category: "Travel" },
    "B08301_019E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: walked",                 category: "Travel" },
    "B08301_018E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: biked",                  category: "Travel" },
    "B08301_021E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute: worked from home",       category: "Travel" },
    "DERIVED_COMMTIME_LT15":  { source: "ACS", agg: "sum", fmt: "int", label: "Commute time: under 15 min",     category: "Travel",
      codes: ["B08303_002E","B08303_003E","B08303_004E"] },
    "DERIVED_COMMTIME_15_29": { source: "ACS", agg: "sum", fmt: "int", label: "Commute time: 15\u201329 min",   category: "Travel",
      codes: ["B08303_005E","B08303_006E","B08303_007E"] },
    "DERIVED_COMMTIME_30_44": { source: "ACS", agg: "sum", fmt: "int", label: "Commute time: 30\u201344 min",   category: "Travel",
      codes: ["B08303_008E","B08303_009E","B08303_010E"] },
    "B08303_011E":            { source: "ACS", agg: "sum", fmt: "int", label: "Commute time: 45\u201359 min",   category: "Travel" },
    "DERIVED_COMMTIME_60PLUS":{ source: "ACS", agg: "sum", fmt: "int", label: "Commute time: 60+ min",          category: "Travel",
      codes: ["B08303_012E","B08303_013E"] },

    // ---- Housing ----
    "B25001_001E": { source: "ACS", agg: "sum", fmt: "int", label: "Total housing units",  category: "Housing" },
    "B25003_002E": { source: "ACS", agg: "sum", fmt: "int", label: "Owner-occupied units", category: "Housing" },
    "B25003_003E": { source: "ACS", agg: "sum", fmt: "int", label: "Renter-occupied units", category: "Housing" },
    "DERIVED_RENT_NOT_BURDENED": { source: "ACS", agg: "sum", fmt: "int", label: "Gross rent < 30% of income",              category: "Housing",
      codes: ["B25070_002E","B25070_003E","B25070_004E","B25070_005E","B25070_006E"] },
    "DERIVED_RENT_BURDENED":     { source: "ACS", agg: "sum", fmt: "int", label: "Gross rent 30\u201349.9% of income (cost burdened)", category: "Housing",
      codes: ["B25070_007E","B25070_008E","B25070_009E"] },
    "B25070_010E": { source: "ACS", agg: "sum", fmt: "int", label: "Gross rent 50%+ of income (severely cost burdened)", category: "Housing" },
    "B25064_001E": { source: "ACS", agg: "avg", fmt: "usd", label: "Median gross rent",   category: "Housing" },
    "B25077_001E": { source: "ACS", agg: "avg", fmt: "usd", label: "Median home value",   category: "Housing" },

    // ---- Employment ----
    "LODES_WAC_C000": { source: "LODES", agg: "sum", fmt: "int", label: "Total existing employment (LODES)", category: "Employment" }
  };

  function getMeta(code) { return VAR_META[code] || { source: "ACS", agg: "sum", fmt: "int" }; }
  function isTractOnly(code) { var m = VAR_META[code]; return !!(m && m.tractOnly); }

  function setAggUI(meta) {
    var aggMethodEl = document.getElementById("aggMethod");
    var warnEl = document.getElementById("aggWarning");

    if (!aggMethodEl || !warnEl) return;

    if (meta.source === "LODES") {
      aggMethodEl.textContent = "Sum (LODES jobs for blocks whose internal point is inside union)";
      warnEl.style.display = "block";
      warnEl.innerHTML =
        "<b>LODES method:</b> Sums LODES WAC jobs (C000) for blocks whose TIGERweb internal point " +
        "falls within the dissolved 0.5-mile buffer union. Screening-grade approach.";
      return;
    }

    if (meta.agg === "sum") {
      aggMethodEl.textContent = "Sum (area-apportioned counts)";
      warnEl.style.display = "none";
      warnEl.textContent = "";
    } else {
      aggMethodEl.textContent = "Area-weighted average (approximation)";
      warnEl.style.display = "block";
      warnEl.textContent =
        "Selected ACS variable is non-additive (e.g., median). This tool reports an area-weighted average estimate, not a true median.";
    }
  }

  function formatValue(val, meta) {
    if (!Number.isFinite(val)) return "\u2014";
    if (meta.fmt === "usd") {
      return val.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
    if (meta.fmt === "decimal") {
      return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }
    return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function getSelectedVars() {
    var boxes = document.querySelectorAll('#varSelect input[type="checkbox"]:checked');
    var codes = [];
    for (var i = 0; i < boxes.length; i++) {
      codes.push(boxes[i].value);
    }
    return codes;
  }

  // --- Map serialization helpers (for saving/restoring TPI/RF results) ---

  // Convert Map<k, v> → plain Object { k: v } (for JSON serialization)
  function mapToObj(map) {
    if (!map) return null;
    var obj = {};
    map.forEach(function (v, k) { obj[k] = v; });
    return obj;
  }

  // Convert plain Object { k: v } → Map<k, v>
  function objToMap(obj) {
    var m = new Map();
    if (!obj) return m;
    Object.keys(obj).forEach(function (k) { m.set(k, obj[k]); });
    return m;
  }

  // Convert Map<k, Map<k2, v>> → nested Object { k: { k2: v } }
  function nestedMapToObj(outerMap) {
    if (!outerMap) return null;
    var obj = {};
    outerMap.forEach(function (innerMap, key) { obj[key] = mapToObj(innerMap); });
    return obj;
  }

  // Convert nested Object { k: { k2: v } } → Map<k, Map<k2, v>>
  function nestedObjToMap(obj) {
    var m = new Map();
    if (!obj) return m;
    Object.keys(obj).forEach(function (k) { m.set(k, objToMap(obj[k])); });
    return m;
  }

  // --- Expose on App namespace ---

  App.setStatus = setStatus;
  App.parseCSV = parseCSV;
  App.fillSelect = fillSelect;
  App.enableSelect = enableSelect;
  App.toNumberSafe = toNumberSafe;
  App.normalizeTractGEOID = normalizeTractGEOID;
  App.guessHeader = guessHeader;
  App.VAR_META = VAR_META;
  App.getMeta = getMeta;
  App.isTractOnly = isTractOnly;
  App.setAggUI = setAggUI;
  App.formatValue = formatValue;
  App.getSelectedVars = getSelectedVars;
  App.mapToObj = mapToObj;
  App.objToMap = objToMap;
  App.nestedMapToObj = nestedMapToObj;
  App.nestedObjToMap = nestedObjToMap;
})();
