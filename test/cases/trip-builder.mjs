// Golden cases for the Trip Builder schedule helpers. These live in the
// module's private closure, so trip-builder.js exposes them under App._tbTest
// when window.__MAT_TEST__ is set (the harness sets it). See the test-only hook
// near mergeIntervals in js/projects/trip-builder.js.
//
// Trip Builder is a registered module: at load it calls App.registerModule,
// which the harness stubs as a no-op.

export default {
  scripts: ["js/projects/trip-builder.js"],
  cases: [
    // --- parseHHMMtoMin: "H:MM" -> minutes-from-midnight (NaN on bad) ------
    { id: "parseHHMM/valid", call: "App._tbTest.parseHHMMtoMin", args: ["6:30"] },
    { id: "parseHHMM/midnight-end", call: "App._tbTest.parseHHMMtoMin", args: ["24:00"] },
    { id: "parseHHMM/garbage", call: "App._tbTest.parseHHMMtoMin", args: ["nope"] },

    // --- formatMin: minutes -> "H:MM" (mod 1440, wraps cleanly) -----------
    { id: "formatMin/morning", call: "App._tbTest.formatMin", args: [390] },
    { id: "formatMin/wrap-past-midnight", call: "App._tbTest.formatMin", args: [1500] },
    { id: "formatMin/negative-wrap", call: "App._tbTest.formatMin", args: [-30] },

    // --- mergeIntervals: merge touching/overlapping spans ----------------
    {
      id: "merge/overlap-and-gap",
      call: "App._tbTest.mergeIntervals",
      args: [[
        { from: 360, to: 600 },
        { from: 540, to: 660 },
        { from: 800, to: 900 },
      ]],
    },
    { id: "merge/single", call: "App._tbTest.mergeIntervals", args: [[{ from: 100, to: 200 }]] },
    { id: "merge/empty", call: "App._tbTest.mergeIntervals", args: [[]] },
  ],
};
