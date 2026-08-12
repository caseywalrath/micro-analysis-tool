// Golden cases for Transit Coverage's pure helpers. The module delegates all
// geometry/Census/LODES work to turf and the shared census.js/lodes.js
// pipeline (not pure — out of scope for this harness); what's covered here is
// the peak-headway reducer and the formatting/sentence-building helpers that
// live in the module's private closure, exposed under App._tcTest when
// window.__MAT_TEST__ is set (see the hook near _dateStamp in
// js/projects/transit-coverage.js).
//
// service-assembly.js is loaded first so App.getEffectiveServiceBands exists
// before transit-coverage.js's computePeakHeadway calls it — verified safe:
// its top level only assigns functions onto App, no turf/DOM calls at load
// time. Registered module: at load transit-coverage.js calls
// App.registerModule (stubbed no-op) and guards App.cache with an `if`, so
// loading the files alone is enough.

export default {
  scripts: ["js/core/service-assembly.js", "js/projects/transit-coverage.js"],
  cases: [
    // --- computePeakHeadway: min positive frequency across effective bands ---
    {
      id: "peakHeadway/basic-min",
      call: "App._tcTest.computePeakHeadway",
      args: [{ weekday: [{ frequency: 30 }, { frequency: 15 }, { frequency: 60 }] }, "weekday"],
    },
    {
      id: "peakHeadway/skips-zero-negative-nonnumeric",
      call: "App._tcTest.computePeakHeadway",
      args: [{ weekday: [{ frequency: 0 }, { frequency: -5 }, { frequency: "abc" }, { frequency: 20 }] }, "weekday"],
    },
    {
      id: "peakHeadway/sunday-mirrors-saturday",
      call: "App._tcTest.computePeakHeadway",
      args: [{ saturday: [{ frequency: 45 }, { frequency: 60 }], sunday: [], sundayMirrorsSaturday: true }, "sunday"],
    },
    {
      id: "peakHeadway/empty-day",
      call: "App._tcTest.computePeakHeadway",
      args: [{ weekday: [] }, "weekday"],
    },
    {
      id: "peakHeadway/null-service",
      call: "App._tcTest.computePeakHeadway",
      args: [null, "weekday"],
    },

    // --- formatPct: 1-decimal percent, em dash on invalid/zero denominator ---
    { id: "formatPct/normal", call: "App._tcTest.formatPct", args: [50, 200] },
    { id: "formatPct/zero-denominator", call: "App._tcTest.formatPct", args: [50, 0] },
    { id: "formatPct/nan-numerator", call: "App._tcTest.formatPct", args: [Number.NaN, 100] },

    // --- formatCount: rounded + locale-grouped, em dash on non-finite -------
    { id: "formatCount/value", call: "App._tcTest.formatCount", args: [12345.6] },
    { id: "formatCount/nan", call: "App._tcTest.formatCount", args: [Number.NaN] },

    // --- buildStatSentence ---------------------------------------------------
    {
      id: "statSentence/with-threshold",
      call: "App._tcTest.buildStatSentence",
      args: [{
        bufferMiles: 0.25, headwayThreshold: 15,
        popTotal: 1000, popCovered: 600, popThreshold: 300, hasThreshold: true,
      }],
    },
    {
      id: "statSentence/without-threshold",
      call: "App._tcTest.buildStatSentence",
      args: [{ bufferMiles: 0.5, popTotal: 1000, popCovered: 250, hasThreshold: false }],
    },
    {
      id: "statSentence/zero-population",
      call: "App._tcTest.buildStatSentence",
      args: [{ bufferMiles: 0.25, popTotal: 0, popCovered: 0, hasThreshold: false }],
    },

    // --- _csvField: RFC-4180-style quoting -----------------------------------
    { id: "csv/plain", call: "App._tcTest._csvField", args: ["plain"] },
    { id: "csv/has-comma", call: "App._tcTest._csvField", args: ["a,b"] },
    { id: "csv/has-quote", call: "App._tcTest._csvField", args: ['quote"here'] },
  ],
};
