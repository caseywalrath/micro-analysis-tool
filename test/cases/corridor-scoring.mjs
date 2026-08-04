// Golden cases for Corridor Scoring's pure helpers. Corridor Scoring delegates
// the heavy demand math to RidershipModel (covered by ridership-scoring cases);
// what's unique here is the system-factor averaging, the classification→pill
// mapping, and the export formatters. These live in the module's private
// closure, exposed under App._csTest when window.__MAT_TEST__ is set (see the
// hook near formatScore in js/projects/corridor-scoring.js).
//
// Registered module: at load it calls App.registerModule (stubbed no-op) and
// guards _weights on TPI being present, so loading the file alone is enough.

export default {
  scripts: ["js/projects/corridor-scoring.js"],
  cases: [
    // --- computeSystemFactorAverages: mean quintile per factor ------------
    // tpiResult.factorScores: Map(factorId -> Map(geoid -> quintile)).
    {
      id: "factorAvgs/two-factors",
      call: "App._csTest.computeSystemFactorAverages",
      args: [{
        factorScores: new Map([
          ["pop_density", new Map([["A", 5], ["B", 3], ["C", 4]])],
          ["employment", new Map([["A", 2], ["B", 4]])],
        ]),
      }],
    },
    {
      id: "factorAvgs/skips-nonfinite",
      call: "App._csTest.computeSystemFactorAverages",
      args: [{
        factorScores: new Map([
          ["poverty", new Map([["A", Number.NaN], ["B", 4], ["C", 2]])],
        ]),
      }],
    },
    {
      id: "factorAvgs/empty-scoremap",
      call: "App._csTest.computeSystemFactorAverages",
      args: [{ factorScores: new Map([["senior", new Map()]]) }],
    },
    { id: "factorAvgs/no-result", call: "App._csTest.computeSystemFactorAverages", args: [null] },

    // --- pillClassFor: classification label -> CSS class ------------------
    { id: "pill/high", call: "App._csTest.pillClassFor", args: ["High"] },
    { id: "pill/medium", call: "App._csTest.pillClassFor", args: ["Medium"] },
    { id: "pill/low-medium", call: "App._csTest.pillClassFor", args: ["Low-Medium"] },
    { id: "pill/low", call: "App._csTest.pillClassFor", args: ["Low"] },
    { id: "pill/unknown", call: "App._csTest.pillClassFor", args: ["Whatever"] },

    // --- formatScore: 2-decimal CDI, em dash when non-finite --------------
    { id: "formatScore/value", call: "App._csTest.formatScore", args: [3.14159] },
    { id: "formatScore/zero", call: "App._csTest.formatScore", args: [0] },
    { id: "formatScore/nan", call: "App._csTest.formatScore", args: [Number.NaN] },

    // --- escapeHTML ------------------------------------------------------
    { id: "escapeHTML/markup", call: "App._csTest.escapeHTML", args: ["<b>a & \"b\" 'c'</b>"] },
    { id: "escapeHTML/null", call: "App._csTest.escapeHTML", args: [null] },

    // --- _csvField: RFC-4180-style quoting -------------------------------
    { id: "csv/plain", call: "App._csTest._csvField", args: ["plain"] },
    { id: "csv/has-comma", call: "App._csTest._csvField", args: ["a,b"] },
    { id: "csv/has-quote", call: "App._csTest._csvField", args: ['quote"here'] },
    { id: "csv/has-newline", call: "App._csTest._csvField", args: ["line\nbreak"] },
    { id: "csv/null", call: "App._csTest._csvField", args: [null] },
  ],
};
