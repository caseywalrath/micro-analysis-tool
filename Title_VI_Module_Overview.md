Title VI Module — Agent Build Brief
1. Objective
Implement a new browser-only analysis module that helps users complete Title VI service equity analysis workflows that are currently done manually in GIS.
The module must support three capabilities:
1.	determine whether a proposed service or fare action qualifies as a user-defined Major Service Change
2.	evaluate minority and low-income equity impacts for affected corridors, routes, or system-wide changes
3.	compare alternative scenarios for mitigation or redesign
All thresholds, variable definitions, and comparison rules must be user-defined so the tool can support different agency policies.
2. Architectural fit
Implement this as a new popup-based analysis module, not as a core app rewrite.
That matches the current architecture:
•	the app already supports multiple analysis modules via App.registerModule()
•	module popups are loaded through the generic popup manager
•	modules receive a core object with access to routes, route buffers, union geometry, TIGERweb fetches, ACS fetches, LODES data, and helper utilities
•	TPI already demonstrates cached recompute, stale-state handling, choropleth rendering, and export workflows that can be reused here 
CHANGELOG

CLAUDE

transit-propensity

3. Current-code assumptions the agent should honor
•	No backend, no build tools, no npm; use plain <script> tags and window.App conventions. 
CLAUDE

•	Keep module-local state private inside the module IIFE unless a public engine namespace is clearly needed. TPI uses this pattern already.
•	Prefer core.* access inside new modules instead of reaching into App.* directly where practical. 
CLAUDE

•	Preserve the popup pattern already used by TPI and intended for future analysis tools. 
CHANGELOG

•	Reuse existing session JSON import/export patterns rather than inventing a separate persistence system. The app already exports/imports analysis sessions as JSON.
4. Scope of v1
In scope
•	policy-driven Major Service Change rule evaluation
•	spatially defined impacted-area analysis using route/segment buffers or whole-route buffers
•	minority and low-income demographic comparison using ACS-based population methods
•	scenario duplication and side-by-side comparison
•	JSON save/load of Title VI-specific state
•	CSV/GeoJSON exports of findings and impacted areas
Deferred to later phases
•	GTFS-native stop change inference
•	fare elasticity or ridership forecasting
•	automated parsing of service changes from schedules/GTFS
•	public notice workflow
•	automated narrative report generation beyond structured summary tables
•	mixed-geography analysis in the same run unless already unavoidable
The repo already identifies mixed-geography support as future work, so do not make v1 depend on that. 
TPI_plan

5. Recommended file plan
Create:
•	js/projects/title-vi.js
main module registration, popup wiring, state management, scenario manager, exports
•	js/projects/title-vi-engine.js
pure calculation engine for:
o	major-change rule checks
o	impacted-area construction
o	ACS-based share calculations
o	policy threshold evaluation
o	scenario comparison
•	projects/title-vi-popup.html
popup body with 3 main tabs or columns:
o	Policies & Inputs
o	Analysis
o	Scenarios
•	projects/title-vi-help.html
optional small methodology/help fragment if needed
Modify:
•	index.html to add the new script tags
•	css/style.css for popup-specific Title VI styles only if reuse of existing module styles is insufficient
This follows the existing popup module and TPI file layout patterns already documented in the repo.
6. Reuse map from current codebase
The agent should explicitly reuse these existing capabilities rather than rebuilding them:
•	popup module lifecycle and HTML loading
•	route drawing and route buffers
•	polygon drawing
•	union geometry access
•	TIGERweb geography fetch
•	ACS variable fetch
•	area-weighted aggregation
•	LODES availability for optional future extensions
•	session import/export patterns
•	stale-result notification patterns
•	CSV/GeoJSON export patterns from TPI
7. Data model
Implement three top-level persisted objects inside Title VI state.
A. policyProfile
Represents one agency’s adopted rules.
Suggested shape:
{
  id: "uuid-or-slug",
  name: "Agency Default Policy",
  version: 1,
  majorChangeRules: [
    {
      id: "route_miles_pct",
      label: "Route miles changed",
      metric: "routeMilesPctChange",
      operator: ">=",
      threshold: 25,
      appliesTo: "singleRoute",   // singleRoute | system | either
      cumulative: false,
      enabled: true
    }
  ],
  adverseEffectRules: {
    serviceDecrease: true,
    serviceMilesDecrease: true,
    frequencyDecrease: true,
    spanDecrease: true,
    stopRemoval: false,
    fareIncrease: false
  },
  protectedPopulationDefs: {
    minority: {
      mode: "acs",
      method: "nonHispanicWhiteInverse", // minority share = 1 - NH white non-Hispanic share
      acsTable: "B03002"
    },
    lowIncome: {
      mode: "acs",
      method: "povertyPersons",          // configurable
      numerator: ["B17001_002E"],
      denominator: ["B01003_001E"]
    }
  },
  comparisonMethod: {
    baselineType: "system_population",   // system_population | system_ridership
    geographyLevel: "block-group",
    bufferDistanceMiles: 0.5
  },
  disparateImpactPolicy: {
    thresholdPpt: 15
  },
  disproportionateBurdenPolicy: {
    thresholdPpt: 15
  }
}
B. scenario
Represents one proposed action or alternative.
Suggested shape:
{
  id: "scenario-1",
  name: "Proposed Fall 2026 Reduction",
  type: "service_change", // service_change | fare_change | mixed
  affectedRoutes: [
    {
      routeId: "10",
      routeName: "Route 10",
      changeType: "reduction", // reduction | increase | elimination | reroute | fare
      before: {
        routeMiles: 12.4,
        revenueHours: 18.0,
        spanHours: 14,
        stops: 42,
        fare: 2.00
      },
      after: {
        routeMiles: 8.7,
        revenueHours: 12.5,
        spanHours: 10,
        stops: 31,
        fare: 2.00
      }
    }
  ],
  spatialInputs: {
    useExistingRouteGeometry: true,
    existingRouteFeatureIds: [],
    proposedRouteFeatureIds: [],
    impactMethod: "changed_segments_buffer", // changed_segments_buffer | full_route_buffer | polygon
    customPolygonIds: [],
    bufferDistanceMiles: 0.5
  },
  riderSurveyFile: null,
  notes: ""
}
C. baseline
Represents the comparison benchmark.
Suggested shape:
{
  id: "baseline-1",
  type: "system_population", // system_population | system_ridership
  geographyLevel: "block-group",
  year: "2024",
  values: {
    minorityShare: 0.43,
    lowIncomeShare: 0.28
  },
  sourceMeta: {
    method: "ACS area-apportioned system union",
    generatedAt: "ISO timestamp"
  }
}
8. Input modes
The module must support both spatial and non-spatial inputs.
Spatial inputs
Use existing map features:
•	routes
•	route buffers
•	polygons
Primary use cases:
•	changed route alignment
•	eliminated segment
•	corridor buffer analysis
•	custom mitigation polygons
Non-spatial inputs
Add CSV import for route/service metrics.
Required for reliable Major Change checks on:
•	revenue hours
•	span of service
•	stop counts
•	fare changes
Do not try to infer those from geometry.
Recommended CSV schema:
scenario,route_id,route_name,change_type,before_route_miles,after_route_miles,before_revenue_hours,after_revenue_hours,before_span_hours,after_span_hours,before_stops,after_stops,before_fare,after_fare
base,10,Route 10,reduction,12.4,8.7,18,12.5,14,10,42,31,2.00,2.00
9. Functional design
9.1 Major Service Change engine
Create a pure function in title-vi-engine.js:
evaluateMajorChange(policyProfile, scenario)
Return:
{
  triggered: true,
  triggeredRules: [
    {
      ruleId: "route_miles_pct",
      label: "Route miles changed",
      metricValue: 29.8,
      threshold: 25,
      operator: ">=",
      passed: true
    }
  ],
  routeSummaries: [...],
  cumulativeSummary: {...}
}
Rules to support in v1:
•	percent route miles changed
•	percent revenue hours changed
•	percent span changed
•	route added
•	route removed
•	all service removed on a day
•	stop count changed
•	fare changed
•	cumulative multi-route threshold crossed
The engine should support both single-route and cumulative system changes.
9.2 Impacted-area engine
Create:
buildImpactedArea(core, scenario, policyProfile)
Support these methods:
•	changed_segments_buffer
•	full_route_buffer
•	custom_polygon
•	union_of_routes
For v1, if changed-segment geometry is hard to infer precisely, allow fallback to:
•	user-selected route geometry buffer
•	user-drawn polygon override
Do not block the feature on perfect segment differencing.
9.3 Demographic engine
Create:
computeProtectedPopulationShares(core, impactedArea, policyProfile, options)
Flow:
1.	fetch intersecting tracts or block groups with TIGERweb
2.	fetch required ACS variables
3.	area-apportion counts into impacted area
4.	compute minority and low-income shares
5.	return counts, denominators, and percentages
Minority default:
•	use B03002
•	compute minority share as total population minus non-Hispanic White alone, divided by total population
Low-income default:
•	user-configurable
•	initial default can be persons below poverty divided by total population
This is directly analogous to the ACS fetch and per-geography calculation patterns already used for TPI.
9.4 Findings engine
Create:
evaluateEquityFindings(policyProfile, impactedShares, baseline)
Return separate findings for:
•	minority / disparate impact
•	low-income / disproportionate burden
Example:
{
  minority: {
    impactedShare: 0.45,
    baselineShare: 0.30,
    diffPpt: 15.0,
    thresholdPpt: 15.0,
    exceedsThreshold: true,
    finding: "Potential Disparate Impact"
  },
  lowIncome: {
    impactedShare: 0.39,
    baselineShare: 0.28,
    diffPpt: 11.0,
    thresholdPpt: 15.0,
    exceedsThreshold: false,
    finding: "No Potential Disproportionate Burden"
  }
}
9.5 Scenario comparison engine
Create:
compareScenarios(policyProfile, scenarios, baseline)
Output a compact table-ready structure for:
•	trigger results
•	impacted population totals
•	minority share
•	low-income share
•	threshold deltas
•	finding labels
•	affected route metrics
10. UI design
Use a popup structure similar in complexity to TPI.
Tab 1: Policies & Inputs
•	select/create/edit policy profile
•	upload route metrics CSV
•	choose affected routes or custom polygons
•	select geography level and ACS year
•	choose baseline method
•	set buffer distance
•	optional upload of ridership baseline CSV placeholder for future phase
Tab 2: Analysis
•	run Major Change evaluation
•	show which policy rules triggered
•	compute impacted demographics
•	show minority and low-income findings
•	show export buttons
•	show stale-data warning if inputs changed
Tab 3: Scenarios
•	duplicate scenario
•	rename scenario
•	compare proposed and mitigation alternatives
•	show side-by-side metric and finding table
Copy the TPI behavior where cached raw data is reused for fast recomputation when only policy thresholds or comparison settings change, instead of re-fetching everything every time. TPI already supports cached instant rescore from raw values, and Title VI should use the same idea.
11. Persistence and export
Persist Title VI module state inside the existing session export/import model.
At minimum, persist:
•	policy profiles
•	scenarios
•	last selected baseline
•	last analysis result
•	stale flags
•	export metadata
Exports to add:
•	title-vi-findings-YYYY-MM-DD.csv
•	title-vi-impacted-area-YYYY-MM-DD.geojson
•	title-vi-session-YYYY-MM-DD.json
CSV export should include:
•	scenario name
•	route IDs
•	major change trigger status
•	impacted population totals
•	minority share
•	low-income share
•	baseline shares
•	threshold deltas
•	finding labels
•	policy profile name/version
12. Implementation sequence
Phase 1
Build the popup shell, module registration, local Title VI state, and policy profile editor.
Done when:
•	module button appears in Analysis panel
•	popup opens/closes correctly
•	policy profile can be created and saved in module state
Phase 2
Build Major Service Change rule engine and route metrics CSV import.
Done when:
•	imported route metrics are parsed and validated
•	scenario can be evaluated against multiple user-defined rules
•	UI clearly shows whether a Major Service Change occurred and why
Phase 3
Build impacted-area selection and ACS-based minority/low-income analysis.
Done when:
•	user can run equity analysis from route or polygon inputs
•	ACS/TIGERweb results are computed inside impacted geography
•	minority and low-income shares are shown against baseline
Phase 4
Build scenario duplication and mitigation comparison.
Done when:
•	user can clone a scenario
•	alternative scenarios can be compared side by side
•	finding deltas are visible across alternatives
Phase 5
Add exports, session persistence, and polish.
Done when:
•	CSV/GeoJSON/JSON exports work
•	stale-state handling is clear
•	closing and reopening popup preserves module-local state
13. Acceptance criteria
A build is acceptable when all of the following are true:
1.	a user can define a policy where Major Service Change is triggered by custom thresholds
2.	a user can import route/service metrics and evaluate one or more routes
3.	a user can select affected route geometry or draw a custom impacted polygon
4.	the module computes minority and low-income shares for the impacted area using ACS data
5.	the module compares those shares to a user-defined or computed system baseline
6.	the module returns separate minority and low-income findings
7.	the module supports at least one mitigation alternative scenario
8.	a user can export findings and impacted geometries
9.	state survives popup close/reopen and can be saved/restored through session export/import
10.	no backend or build tooling is introduced
14. Testing checklist
Unit-ish engine tests
Test pure calculation helpers with fixed objects:
•	percentage change math
•	rule operator handling
•	cumulative threshold handling
•	finding threshold comparison
•	scenario comparison sorting/formatting
Manual browser tests
•	open popup, close popup, reopen popup
•	import valid CSV
•	reject malformed CSV
•	draw route, buffer route, run analysis
•	duplicate scenario and modify threshold
•	change geometry after analysis and verify stale warning appears
•	export CSV/GeoJSON/JSON and verify contents
•	restore exported session and verify Title VI state loads correctly
Edge-case tests
•	no route geometry but CSV-only fare change
•	multiple affected routes with overlap
•	route removal scenario
•	service increase scenario
•	custom low-income definition
•	no ACS data returned for part of area
•	block group vs tract run
•	zero denominator handling
15. Known design risks
•	Major Change rules are not purely spatial, so CSV/manual service metrics are necessary.
•	Fare-only analyses may not have a spatial impacted area; the UI should allow non-spatial baseline comparison and mark spatial outputs as not applicable.
•	Precise changed-segment detection may be harder than full-route buffering; use a fallback path rather than overengineering v1.
•	Mixed geography support should not be required for first release.
•	Ridership-survey baseline support is feasible but should be phase 2+ of the equity baseline subsystem, not a blocker for ACS-based v1.
16. Default implementation choices if human feedback is absent
Use these defaults unless the user explicitly changes them:
•	popup width roughly similar to or slightly wider than TPI
•	geography default: block groups
•	ACS year default: current app default year selector if available
•	buffer default: 0.5 miles
•	minority definition: 1 - non-Hispanic White share
•	low-income definition: persons below poverty / total population
•	DI threshold: 15 percentage points
•	DB threshold: 15 percentage points
•	baseline: system population, not ridership
17. Deliverable expectation for the coding agent
The agent should produce:
•	working module code
•	concise notes on which files were added or modified
•	a short explanation of any compromises made for v1
•	a list of remaining follow-up items for later phases
The agent should not refactor unrelated core modules unless required to expose a missing hook. The repo’s existing TPI plan explicitly treated the analysis module system as the right place for new functionality, and that same principle should hold here.
If you want, I’ll turn this into a tighter “implementation ticket stack” version next.

