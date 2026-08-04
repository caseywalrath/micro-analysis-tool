// Golden cases for the Ridership Forecasting math engine (window.RidershipModel,
// js/projects/ridership-scoring.js). These are the PURE functions — they take
// plain arguments and return plain numbers/objects, with no map, DOM, Census
// API, or turf involved — which is exactly what golden-value testing pins.
//
// `scripts` lists the app files to load into the sandbox, in dependency order.
// ridership-scoring.js only needs the App/TPI globals to exist (it reads them
// lazily inside functions we don't call here), so loading it alone is enough
// for these cases.
//
// Each case: { id, call: "<Namespace>.<fn>", args: [...] }. Add cases freely;
// run `node test/run-golden.mjs --update` once to record their known-good output.

export default {
  scripts: ["js/projects/ridership-scoring.js"],
  cases: [
    // --- classifyCDI: bucket a Corridor Demand Index score -----------------
    { id: "classify/high", call: "RidershipModel.classifyCDI", args: [4.5] },
    { id: "classify/medium-boundary", call: "RidershipModel.classifyCDI", args: [3.0] },
    { id: "classify/lowmed-boundary", call: "RidershipModel.classifyCDI", args: [2.0] },
    { id: "classify/low", call: "RidershipModel.classifyCDI", args: [1.2] },
    { id: "classify/object-form", call: "RidershipModel.classifyCDI", args: [{ value: 4.1 }] },
    { id: "classify/nan", call: "RidershipModel.classifyCDI", args: [Number.NaN] },

    // --- computeFrequencyEffect: (newFreq/oldFreq)^elasticity --------------
    { id: "freq/double-service", call: "RidershipModel.computeFrequencyEffect", args: [30, 15, 0.6] },
    { id: "freq/no-change", call: "RidershipModel.computeFrequencyEffect", args: [30, 30, 0.6] },
    { id: "freq/guard-zero", call: "RidershipModel.computeFrequencyEffect", args: [0, 15, 0.6] },
    { id: "freq/cut-to-10", call: "RidershipModel.computeFrequencyEffect", args: [30, 10, 0.5] },

    // --- computeSpanEffect: (newSpan/oldSpan)^elasticity ------------------
    { id: "span/extend", call: "RidershipModel.computeSpanEffect", args: [14, 18, 0.7] },
    { id: "span/no-change", call: "RidershipModel.computeSpanEffect", args: [14, 14, 0.7] },
    { id: "span/shrink", call: "RidershipModel.computeSpanEffect", args: [14, 10, 0.7] },

    // --- applyElasticity: frequency + service-type premium multipliers -----
    {
      id: "elasticity/brt-frequent",
      call: "RidershipModel.applyElasticity",
      args: [1.0, { serviceTypeId: "brt", baseHeadway: 30, newHeadway: 10, freqElasticity: 0.6 }],
    },
    {
      id: "elasticity/local-nochange",
      call: "RidershipModel.applyElasticity",
      args: [1.0, { serviceTypeId: "local_bus", baseHeadway: 30, newHeadway: 30 }],
    },
    {
      id: "elasticity/custom-premium",
      call: "RidershipModel.applyElasticity",
      args: [250, { serviceTypeId: "enhanced_bus", baseHeadway: 20, newHeadway: 15, customServicePremium: { low: 0.1, high: 0.4 } }],
    },

    // --- applyBaselineUncertainty: symmetric band around a projection ------
    { id: "uncertainty/quarter", call: "RidershipModel.applyBaselineUncertainty", args: [1000, 0.25] },
    { id: "uncertainty/zero-base", call: "RidershipModel.applyBaselineUncertainty", args: [0, 0.25] },
    { id: "uncertainty/default-pct", call: "RidershipModel.applyBaselineUncertainty", args: [500] },

    // --- buildScenario: full operating-metrics rollup ---------------------
    {
      id: "scenario/with-elasticity",
      call: "RidershipModel.buildScenario",
      args: [{
        name: "BRT corridor",
        serviceTypeId: "brt",
        routeLengthMiles: 8,
        headway: 10,
        span: 18,
        avgSpeed: 22,
        costPerRevenueHour: 165,
        serviceDaysPerYear: 312,
        elasticityResult: { low: 900, mid: 1200, high: 1600 },
        calibrationFactor: 1.1,
      }],
    },
    {
      id: "scenario/from-cdi",
      call: "RidershipModel.buildScenario",
      args: [{
        name: "Local baseline",
        serviceTypeId: "local_bus",
        routeLengthMiles: 5,
        headway: 30,
        span: 14,
        avgSpeed: 12,
        costPerRevenueHour: 150,
        serviceDaysPerYear: 260,
        baseDemandCDI: 800,
      }],
    },

    // --- calibrateRatio / calibrateRegression: fit observed ridership ------
    {
      id: "calibrate/ratio",
      call: "RidershipModel.calibrateRatio",
      args: [[
        { ridership: 1000, demandIndex: 4 },
        { ridership: 500, demandIndex: 2 },
        { ridership: 780, demandIndex: 3 },
      ]],
    },
    { id: "calibrate/ratio-empty", call: "RidershipModel.calibrateRatio", args: [[]] },
    {
      id: "calibrate/regression",
      call: "RidershipModel.calibrateRegression",
      args: [[
        { ridership: 1000, demandIndex: 4 },
        { ridership: 520, demandIndex: 2 },
        { ridership: 800, demandIndex: 3 },
        { ridership: 260, demandIndex: 1 },
      ]],
    },
    {
      id: "calibrate/regression-too-few",
      call: "RidershipModel.calibrateRegression",
      args: [[{ ridership: 1000, demandIndex: 4 }, { ridership: 500, demandIndex: 2 }]],
    },
  ],
};
