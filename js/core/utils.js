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

  var VAR_META = {
    "B01003_001E": { source: "ACS", agg: "sum", fmt: "int", label: "Total population", category: "Land Use" },
    "B11001_001E": { source: "ACS", agg: "sum", fmt: "int", label: "Total households", category: "Land Use" },
    "B25001_001E": { source: "ACS", agg: "sum", fmt: "int", label: "Total housing units", category: "Land Use" },
    "B25002_001E": { source: "ACS", agg: "sum", fmt: "int", label: "Occupied housing units", category: "Land Use" },
    "B25002_003E": { source: "ACS", agg: "sum", fmt: "int", label: "Vacant housing units", category: "Land Use" },
    "B08201_002E": { source: "ACS", agg: "sum", fmt: "int", label: "Zero-car households", category: "Mobility", tractOnly: true },
    "B17001_002E": { source: "ACS", agg: "sum", fmt: "int", label: "Persons below poverty level", category: "Mobility" },

    "B19013_001E": { source: "ACS", agg: "avg", fmt: "usd", label: "Median household income", category: "Non-additive Medians", tractOnly: true },
    "B25064_001E": { source: "ACS", agg: "avg", fmt: "usd", label: "Median gross rent", category: "Non-additive Medians" },
    "B25077_001E": { source: "ACS", agg: "avg", fmt: "usd", label: "Median home value", category: "Non-additive Medians" },

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
