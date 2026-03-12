// js/core/projections.js
// Population projections: upload/parse/store CSV, expose population addition Map.
// The CSV provides absolute projected population counts per tract that are ADDED to
// Census ACS baseline values (pop_new = pop_census + pop_addition).
// Depends on: App namespace (utils.js — parseCSV, guessHeader, setStatus).
// Exports: App.projData, App.projFileName, App.projYear, App.projGrowthFactors(),
//          App.parseProjectionsCSV(file), App.setProjectionsData(data, fileName),
//          App.clearProjectionsData()

(function () {
  var App = window.App = window.App || {};

  var PROJ_DATA = null;     // Map<geoid(11-char), { pop_2030, pop_2040, pop_2050 }>  (raw population additions)
  var PROJ_FILE_NAME = "";
  var PROJ_YEAR = null;     // "2030", "2040", "2050", or null (= current year)

  // ---- UI update helper ----

  function updateProjectionUI() {
    var infoEl = document.getElementById("projInfo");
    var clearBtn = document.getElementById("projClear");
    var yearSel = document.getElementById("projYear");

    if (!PROJ_DATA) {
      if (infoEl) infoEl.textContent = "No projection loaded \u2014 upload a population projection CSV";
      if (clearBtn) clearBtn.style.display = "none";
      if (yearSel) yearSel.disabled = true;
    } else {
      var yearLabel = PROJ_YEAR ? PROJ_YEAR : "Current (ACS)";
      if (infoEl) infoEl.textContent = "Loaded: " + PROJ_FILE_NAME +
        " \u2014 " + PROJ_DATA.size.toLocaleString() + " tracts \u2014 Projecting to " + yearLabel;
      if (clearBtn) clearBtn.style.display = "";
      if (yearSel) yearSel.disabled = false;
    }
  }

  // ---- Parse a projection CSV file ----

  async function parseProjectionsCSV(file) {
    App.setStatus("Reading projection CSV\u2026");
    var text = await file.text();
    var parsed = App.parseCSV(text);          // { headers: [...], rows: [{...}, ...] }
    var headers = parsed.headers;
    var rows = parsed.rows;
    if (!rows || rows.length === 0) throw new Error("Projection CSV appears empty.");

    // guessHeader returns the matching header string, or "" on miss
    var colGEOID = App.guessHeader(headers, ["GEOID", "geoid", "Geoid", "GeoID", "tract", "TRACT"]);
    var col2030 = App.guessHeader(headers, ["pop_2030", "Pop_2030", "POP_2030", "population_2030"]);
    var col2040 = App.guessHeader(headers, ["pop_2040", "Pop_2040", "POP_2040", "population_2040"]);
    var col2050 = App.guessHeader(headers, ["pop_2050", "Pop_2050", "POP_2050", "population_2050"]);

    if (!colGEOID) throw new Error("Could not find GEOID column in projection CSV.");
    if (!col2030 && !col2040 && !col2050) {
      throw new Error("Could not find any population projection columns (pop_2030, pop_2040, pop_2050).");
    }

    var data = new Map();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var geoid = String(row[colGEOID] || "").replace(/['"]/g, "").trim();
      if (!geoid) continue;
      // Normalize to 11-char tract GEOID
      if (geoid.length > 11) geoid = geoid.slice(0, 11);
      while (geoid.length < 11) geoid = "0" + geoid;

      var entry = {
        pop_2030: col2030 ? parseFloat(row[col2030]) || 0 : 0,
        pop_2040: col2040 ? parseFloat(row[col2040]) || 0 : 0,
        pop_2050: col2050 ? parseFloat(row[col2050]) || 0 : 0
      };
      // Skip rows that contribute nothing
      if (entry.pop_2030 === 0 && entry.pop_2040 === 0 && entry.pop_2050 === 0) continue;
      data.set(geoid, entry);
    }

    if (data.size === 0) throw new Error("No valid rows found in projection CSV.");
    App.setStatus("Parsed " + data.size + " tract population projections");
    return data;
  }

  // ---- Build population-addition Map for the currently selected year ----
  // Returns Map<geoid, popAddition> where values are raw population counts to add
  // to Census ACS baselines. Returns null if no data or no year selected.

  function projGrowthFactors() {
    if (!PROJ_DATA || !PROJ_YEAR) return null;
    var key = "pop_" + PROJ_YEAR;
    var result = new Map();
    PROJ_DATA.forEach(function (entry, geoid) {
      var popAdd = entry[key];
      if (Number.isFinite(popAdd) && popAdd !== 0) {
        result.set(geoid, popAdd);
      }
    });
    return result.size > 0 ? result : null;
  }

  // ---- Set / clear data ----

  function setProjectionsData(data, fileName) {
    PROJ_DATA = data;
    PROJ_FILE_NAME = fileName || "";
    updateProjectionUI();
  }

  function clearProjectionsData() {
    PROJ_DATA = null;
    PROJ_FILE_NAME = "";
    PROJ_YEAR = null;
    var yearSel = document.getElementById("projYear");
    if (yearSel) yearSel.value = "";
    updateProjectionUI();
  }

  // ---- Expose on App namespace ----

  Object.defineProperty(App, "projData", {
    get: function () { return PROJ_DATA; },
    configurable: true
  });
  Object.defineProperty(App, "projFileName", {
    get: function () { return PROJ_FILE_NAME; },
    configurable: true
  });
  Object.defineProperty(App, "projYear", {
    get: function () { return PROJ_YEAR; },
    set: function (v) { PROJ_YEAR = v || null; updateProjectionUI(); },
    configurable: true
  });

  // ---- Build population-addition Map for an explicit year (does NOT change App.projYear) ----

  function projGrowthFactorsForYear(year) {
    if (!PROJ_DATA || !year) return null;
    var key = "pop_" + year;
    var result = new Map();
    PROJ_DATA.forEach(function (entry, geoid) {
      var popAdd = entry[key];
      if (Number.isFinite(popAdd) && popAdd !== 0) {
        result.set(geoid, popAdd);
      }
    });
    return result.size > 0 ? result : null;
  }

  App.projGrowthFactors = projGrowthFactors;
  App.projGrowthFactorsForYear = projGrowthFactorsForYear;
  App.parseProjectionsCSV = parseProjectionsCSV;
  App.setProjectionsData = setProjectionsData;
  App.clearProjectionsData = clearProjectionsData;
})();
