// Golden cases for the shared module-owned analysis buffer helper
// (js/core/module-buffers.js). App.readAnalysisBufferMiles is the only pure,
// DOM-optional helper there — buildAnalysisBuffer/buildAnalysisBufferSet/
// foldAnalysisUnion all call turf and read App.points/lines/routes/polygons,
// so they're out of harness scope by design (same rationale as every other
// turf-dependent module in this suite).
//
// The sandbox has no `document`, so readAnalysisBufferMiles must accept a
// plain object exposing `.value` (not just an element id string) to be
// testable headless — confirmed safe: passing a string id here resolves
// through `typeof document !== "undefined"` and falls back cleanly.

export default {
  scripts: ["js/core/module-buffers.js"],
  cases: [
    { id: "readBuffer/valid-value", call: "App.readAnalysisBufferMiles", args: [{ value: "1.5" }] },
    { id: "readBuffer/below-min", call: "App.readAnalysisBufferMiles", args: [{ value: "0.01" }] },
    { id: "readBuffer/above-max", call: "App.readAnalysisBufferMiles", args: [{ value: "99" }] },
    { id: "readBuffer/non-numeric", call: "App.readAnalysisBufferMiles", args: [{ value: "abc" }] },
    { id: "readBuffer/blank", call: "App.readAnalysisBufferMiles", args: [{ value: "" }] },
    { id: "readBuffer/missing-element-string-id", call: "App.readAnalysisBufferMiles", args: ["nonexistent-id"] },
    { id: "readBuffer/null-element", call: "App.readAnalysisBufferMiles", args: [null] },
    { id: "readBuffer/explicit-fallback-honored", call: "App.readAnalysisBufferMiles", args: [{ value: "" }, 0.75] },
    { id: "readBuffer/at-min-boundary", call: "App.readAnalysisBufferMiles", args: [{ value: "0.05" }] },
    { id: "readBuffer/at-max-boundary", call: "App.readAnalysisBufferMiles", args: [{ value: "5" }] },
  ],
};
