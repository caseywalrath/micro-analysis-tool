// Golden cases for the Route Costing cost-math helpers. These live in the
// module's private closure, so route-costing.js exposes them under
// App._rcTest when window.__MAT_TEST__ is set (the harness sets it). See the
// test-only hook near computeLayoverHrs in js/projects/route-costing.js.
//
// Route Costing is a registered module: at load it calls App.registerModule,
// which the harness stubs as a no-op. Its pure helpers touch no map/API/turf.

export default {
  scripts: ["js/projects/route-costing.js"],
  cases: [
    // --- parseBandTime: "H:MM" -> hours (NaN on bad input) ----------------
    { id: "parseBandTime/valid", call: "App._rcTest.parseBandTime", args: ["6:30"] },
    { id: "parseBandTime/midnight-end", call: "App._rcTest.parseBandTime", args: ["24:00"] },
    { id: "parseBandTime/out-of-range", call: "App._rcTest.parseBandTime", args: ["25:00"] },
    { id: "parseBandTime/garbage", call: "App._rcTest.parseBandTime", args: ["nope"] },

    // --- oneWayRuntimeHrs: length / speed (0 when speed missing) -----------
    { id: "oneWay/speed", call: "App._rcTest.oneWayRuntimeHrs", args: [{ avgSpeed: 12, lengthMiles: 6 }] },
    { id: "oneWay/no-speed", call: "App._rcTest.oneWayRuntimeHrs", args: [{ avgSpeed: 0, lengthMiles: 6 }] },

    // --- oneWayRuntimeHrsFromSettings: honors runtimeMode -----------------
    {
      id: "oneWaySettings/runTime-mode",
      call: "App._rcTest.oneWayRuntimeHrsFromSettings",
      args: [{ runTime: 45, lengthMiles: 6, avgSpeed: 12 }, { runtimeMode: "runTime" }],
    },
    {
      id: "oneWaySettings/speed-mode",
      call: "App._rcTest.oneWayRuntimeHrsFromSettings",
      args: [{ runTime: 45, lengthMiles: 5, avgSpeed: 15 }, { runtimeMode: "speed" }],
    },

    // --- computeRoundTrip: paired / Both / Loop -------------------------
    {
      id: "roundTrip/two-pattern",
      call: "App._rcTest.computeRoundTrip",
      args: [
        { patterns: [
          { avgSpeed: 12, lengthMiles: 6, direction: "NB" },
          { avgSpeed: 12, lengthMiles: 6, direction: "SB" },
        ] },
        { runtimeMode: "speed" },
      ],
    },
    {
      id: "roundTrip/one-pattern-both",
      call: "App._rcTest.computeRoundTrip",
      args: [
        { patterns: [{ avgSpeed: 10, lengthMiles: 5, direction: "Both" }] },
        { runtimeMode: "speed" },
      ],
    },
    {
      id: "roundTrip/one-pattern-loop",
      call: "App._rcTest.computeRoundTrip",
      args: [
        { patterns: [{ avgSpeed: 10, lengthMiles: 5, direction: "Loop" }] },
        { runtimeMode: "speed" },
      ],
    },

    // --- computeLayoverHrs: percent vs minutes ---------------------------
    { id: "layover/percent", call: "App._rcTest.computeLayoverHrs", args: [1.0, { layoverMode: "percent", layoverValue: 10 }] },
    { id: "layover/minutes", call: "App._rcTest.computeLayoverHrs", args: [1.0, { layoverMode: "minutes", layoverValue: 12 }] },
  ],
};
