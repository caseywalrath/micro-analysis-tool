// Golden cases for the TPI scoring engine (window.TPI, js/projects/tpi-scoring.js).
// These functions return Map objects; the harness serializes Maps to a
// { "__map__": { ... } } form in the golden file. TPI is a plain engine (not a
// registered module), so loading tpi-scoring.js alone is enough.
//
// Factor ids come from TPI.FACTORS: pop_density, employment, zero_car, poverty,
// senior, disability, poc, youth, lep.

export default {
  scripts: ["js/projects/tpi-scoring.js"],
  cases: [
    // --- computeQuintiles: rank geographies 1..5 by a raw value ------------
    {
      id: "quintiles/standard-5",
      call: "TPI.computeQuintiles",
      args: [[
        { geoid: "A", rawValue: 10 },
        { geoid: "B", rawValue: 20 },
        { geoid: "C", rawValue: 30 },
        { geoid: "D", rawValue: 40 },
        { geoid: "E", rawValue: 50 },
      ]],
    },
    {
      id: "quintiles/few-equal-interval",
      call: "TPI.computeQuintiles",
      args: [[
        { geoid: "A", rawValue: 5 },
        { geoid: "B", rawValue: 15 },
        { geoid: "C", rawValue: 25 },
      ]],
    },
    {
      id: "quintiles/all-equal",
      call: "TPI.computeQuintiles",
      args: [[
        { geoid: "A", rawValue: 7 },
        { geoid: "B", rawValue: 7 },
        { geoid: "C", rawValue: 7 },
      ]],
    },
    {
      id: "quintiles/drops-nonfinite",
      call: "TPI.computeQuintiles",
      args: [[
        { geoid: "A", rawValue: 10 },
        { geoid: "B", rawValue: Number.NaN },
        { geoid: "C", rawValue: 30 },
      ]],
    },
    { id: "quintiles/empty", call: "TPI.computeQuintiles", args: [[]] },

    // --- computeComposite: weighted blend of per-factor quintiles ----------
    // factorScores: Map(factorId -> Map(geoid -> quintile)); weights by factor id.
    {
      id: "composite/two-factors",
      call: "TPI.computeComposite",
      args: [
        new Map([
          ["pop_density", new Map([["A", 5], ["B", 2]])],
          ["employment", new Map([["A", 4], ["B", 3]])],
        ]),
        { pop_density: 35, employment: 35 },
        ["A", "B"],
      ],
    },
    {
      id: "composite/missing-factor-redistributes",
      call: "TPI.computeComposite",
      args: [
        new Map([
          ["pop_density", new Map([["A", 5], ["B", 2]])],
          ["employment", new Map([["A", 4]])], // B missing employment
        ]),
        { pop_density: 35, employment: 35 },
        ["A", "B"],
      ],
    },
  ],
};
