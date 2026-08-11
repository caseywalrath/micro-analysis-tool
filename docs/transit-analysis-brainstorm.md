# Transit Analysis Improvements — Brainstorm & Prioritization

*Working document, August 2026. Evaluates six proposed capabilities against the
existing architecture: what we can build with data we already have, what needs
new data or new engines, known shortcomings, and a recommended build order.*

---

## What we already have to build on

Before evaluating each idea, an inventory of the relevant existing machinery —
because most of these ideas are closer than they look:

| Existing capability | Where it lives | Why it matters here |
|---|---|---|
| Per-band **headway** (`frequency`, minutes) per day type on every route/line | Time Bands editor, `feature.properties.attributes.service` | Frequency tiers ("15-min or better") are already derivable — no new data entry needed |
| **Direction** attribute (Both / NB / SB / Loop / CW / CCW …) | `feature-attributes.js` | Directionality is already captured per feature |
| Service assembly (`buildTransitServices`, `getEffectiveServiceBands`) | `js/core/service-assembly.js` | Shared way to turn drawn features into Services with validated patterns |
| Area-weighted census aggregation (`aggregateWithinUnion`) | `js/core/census.js` | The core of any "population within X of transit" calculation |
| Block-level LODES jobs + `fetchBlocksInternalPointsInUnion` | `js/core/lodes.js` | "Jobs within X of transit" is nearly the same computation |
| Offline street network + budget-limited Dijkstra flood (`computeWalkshed`) | `js/core/road-network.js` | The engine a transit travelshed would be layered on |
| Per-point walkshed substitution (`serviceAreaType: "walkshed"`) | `walkshed.js` + `points.js` | Pattern for swapping crow-fly buffers for network-accurate ones |
| Points with `stopId` + `associatedRoutes` | `feature-attributes.js` | Stop↔route linkage — the boarding/alighting model for transit routing |
| Session export/import (`cache.exportToFile` / `importFromFile`), per-module `registerModule(collect/apply)` persistence | `js/core/cache.js` | The natural substrate for scenario-as-saved-state |
| Service type presets incl. `defaultStopSpacing` | `ridership-scoring.js` | Lets us synthesize stops along a drawn route that has none |
| Segmenting engine (`computeSegments`) | `ridership-scoring.js` | Per-segment analysis pattern, relevant to hybrid trunk/loop routes |

---

## Idea 1 — % of residents near [x]-minute-frequency transit

**Concept:** "79% of service-area residents are within ¼ mile of transit; 24%
are within ¼ mile of 15-minute-or-better service."

### Fit with existing architecture: excellent

This is essentially Buffer-Area Summary generalized along two axes — a
*frequency classification* of routes and a *denominator area* — and both axes
are already supported by data we collect.

**Numerator (population near tier-T transit):**
1. Classify each route/line into frequency tiers from its time bands. The data
   is already there; the design question is the *definition* (see below).
2. Union the buffers of all features in tier T (existing buffer machinery;
   per-module buffer distance input, e.g. ¼ mi vs the drawing default ½ mi).
3. `fetchTigerwebGeos` + `fetchACSValues(B01003_001E)` +
   `aggregateWithinUnion` — exactly the Buffer-Area Summary pipeline.

**Denominator (service-area population):** options, roughly in build order:
- **User-drawn/imported polygon(s)** — v1. Zero new data dependencies; the
  consultant draws or imports the service area, and we area-weight population
  within it with the same pipeline.
- **Municipal boundary polygons** — we already render municipal boundaries as
  a reference *line* overlay; fetching the underlying *polygon* from TIGERweb
  (Places / County Subdivisions layers) is the same query pattern census.js
  already uses. A "use municipal boundary as service area" picker is a natural
  v2.
- **Union of all fetched geographies** — cheapest fallback but fuzzy at edges;
  fine as a convenience option, not the default.

**The frequency-definition problem (the real design work):** a route that runs
every 15 minutes for one peak hour is not "high-frequency transit," and
consultants get challenged on exactly this. Because our bands carry both time
ranges and headways, we can do better than "best headway of the day":

- Default metric: **headway sustained over a qualifying span** — e.g. "≤15 min
  for at least H hours on weekdays" (H user-set, default ~12). Computable
  directly from bands: sum the duration of weekday bands with `frequency ≤ x`.
- Secondary options: headway at a probe time (e.g. weekday noon), or best
  weekday headway (labeled as such).
- Tiers user-configurable (e.g. ≤15 / ≤30 / any service), rendered as a small
  tier editor in the Settings column.

**Output:** tier table (tier, buffered population, % of service area), a
map layer showing covered vs. uncovered area per tier, CSV export, floating
legend. Stat lines formatted exactly like the consulting-slide sentence.

### Shortcomings & mitigations
- **Area-weighting assumes uniform population within a block group.** Already
  an accepted limitation across the app; footnote it (we do this elsewhere).
- **Crow-fly buffers overstate access** where the street grid is poor. Offer a
  per-run toggle: geometric buffer (fast, always available) vs. **network
  walkshed along the route** (requires a loaded road network; computable by
  flooding from points sampled along the route geometry — slower but far more
  defensible). Ship buffers in v1, walkshed option in v2.
- **Route-line buffers vs stop buffers:** for stop-sparse service (BRT, rail),
  access should be measured from *stops*, not the line. Since points already
  carry `associatedRoutes`, offer "buffer the line" vs "buffer its associated
  stops" per run.

### Effort: **moderate-low.** New module (`transit-coverage`), no new data, no
new engine. The frequency-tier classifier is a pure function → gets a
golden-value test case per the testing policy.

---

## Idea 2 — Jobs near / reachable by transit (LODES)

Two distinct metrics hide in this idea:

**(a) Jobs *near* transit** — "X% of service-area jobs are within ¼ mile of
frequent transit." This is Idea 1 with a LODES numerator instead of ACS
population, and `computeEmploymentServedOnly` /
`fetchBlocksInternalPointsInUnion` already do the inner computation (block
internal points within a union polygon). **Recommendation: don't build this as
a separate module — make it a second metric row in the Idea 1 coverage module**
("Residents" and "Jobs" columns per tier). Marginal cost is small.

**(b) Jobs *reachable* by transit within a travel-time budget** — that is an
accessibility metric and belongs to Ideas 4/6 (it needs the travelshed engine,
not buffers). Covered there.

### Shortcomings
- LODES covers payroll employment (misses most self-employment, some federal/
  military categories) and lags ~2 years. Standard practice; disclose in the
  module footnotes like the existing LODES caveats.
- LODES requires the user to have loaded the state file (existing ⚠ warning
  pattern handles this).

### Effort: **small**, *if* folded into Idea 1's module. Do them together.

---

## Idea 3 — Scenarios as independently saved states

The instinct here is right, and it's also the architecturally cheap answer: we
already have whole-session export/import with per-module `collect/apply`
persistence, and per-module scenario managers (RF Scenarios tab, Title VI
Scenarios) have proven to be the *expensive* pattern — each one is bespoke UI.

Recommended ladder:

1. **Named session slots (build soon, low effort).** Today localStorage holds
   exactly one session (`"mat-session"`), and file export/import is the only
   way to keep alternatives. Add "Save as scenario…" / "Switch scenario"
   backed by multiple named localStorage keys (same schema, plus a name and
   timestamp). For a non-technical user this converts a fiddly
   export-file-then-reimport dance into a dropdown. Watch localStorage quota
   (~5MB) — sessions are small since LODES isn't cached, but cap slot count
   or fall back to file export gracefully.

2. **Scenario Comparison module (the real payoff).** A system module (like
   Attribute Summary) that loads 2+ scenario states **read-only** and renders
   a side-by-side table of *persisted module results* — not live recomputes.
   This is the key design decision: several modules already persist their last
   summary (`route-costing` lastSummary, `corridor-scoring` lastSummary, RF
   calibration + demand). Comparing those requires **zero Census/LODES calls**
   and no map juggling. Requirements it imposes on new modules: Idea 1's
   coverage module should persist its results table in `collect()` from day
   one, specifically so scenarios can be compared. Each compared column shows
   the run timestamp and a stale flag (results in a saved state may predate
   the features in it — surface that honestly rather than recomputing
   silently).

3. **Side-by-side maps** — defer. High UI cost, and the comparison table plus
   switching scenarios covers most of the consulting need.

### Shortcomings
- Comparing persisted results means comparing *what was last run*, not a
  guaranteed-fresh computation. Mitigation: prominent timestamps/stale badges,
  and a per-scenario "open & re-run" affordance.
- Cross-scenario normalization: scores like TPI/CDI are normalized within
  their own run's pool, so comparing raw composite scores across scenarios is
  not apples-to-apples (this is the same problem shared-pool mode solves in
  RF). Coverage %, costs, rev-hours, and ridership are absolute and compare
  cleanly — lead with those in the comparison table; badge normalized scores
  with a warning.

### Effort: slots = **small**; comparison module = **moderate**.

---

## Idea 4 — Travel-time analysis ("39% more jobs within 45 minutes") — conceptual

What the agencies are showing is **cumulative-opportunity accessibility**,
usually computed with schedule-based multimodal routing (Conveyal/R5: GTFS +
street network, departure-time sampling). We can't and shouldn't replicate
that fidelity client-side — but there is a legitimate, well-established
lighter-weight variant that our data model happens to support almost exactly:
**frequency-based (headway-based) accessibility**, where expected wait =
headway/2 instead of consulting a timetable. Conveyal itself offers this mode
for sketch networks that don't have schedules yet — which is precisely what a
drawn scenario network is.

Conceptual pipeline (all pieces named in Idea 6):
1. Transit travelshed from an origin with budget T (walk → wait → ride →
   walk, ≤1 transfer).
2. "Jobs within T" = LODES jobs within the travelshed polygon (existing
   union-based LODES computation).
3. The headline stat ("the *average resident* reaches 39% more jobs") is the
   population-weighted mean of (2) across many origins — one travelshed per
   populated block-group centroid in the service area. That's the expensive
   part: N origins × multi-flood routing. Tractable as a batch run with a
   progress bar *if* per-stop walk floods are cached and reused across origins
   (design note in Idea 6), or by sampling origins.
4. The "% more" framing is a before/after comparison → falls straight out of
   Idea 3's scenario states.

**Data we'd want eventually but don't need for v1:** real GTFS-derived
headways for the *existing* network (we already parse GTFS; deriving headways
from `stop_times.txt` is a bounded follow-up), giving an honest "existing
(GTFS) vs proposed (drawn)" comparison.

**Verdict:** don't build this directly. It is the *composition* of Idea 6
(travelshed engine) + existing LODES machinery + Idea 3 (scenario states).
Methodology disclosure matters for consulting use: frequency-based not
schedule-based, average-wait assumption, transfer cap, no reliability/crowding.

---

## Idea 5 — Directionality in ridership projections

Agreed that full granularity (trunk-with-one-way-loop-ends) exceeds the model's
current fidelity — and importantly, it also exceeds the fidelity of the
*calibration data* (route-level observed ridership), so a segment-level
directionality model would be precision we can't validate.

**What's defensible now — a route-level "directionality factor":**
- We already have the pattern for exactly this kind of adjustment: service
  type premiums (user-adjustable sliders, documented defaults, flow through
  `applyElasticity`). Add a **direction multiplier** derived from the existing
  `direction` attribute / Service pairing: bidirectional (paired patterns or
  "Both") = 1.0; one-way loop (Loop/CW/CCW solo) = default ~0.7,
  user-adjustable with a stated basis. The rationale to document: a one-way
  loop imposes out-of-direction travel for roughly half of trip pairs,
  degrading effective in-vehicle time even at identical headways; empirical
  literature is thin, so the default is a judgment value the user can tune —
  same epistemic status as our service premiums, presented the same way.
- **Calibration-consistency guard (cheap, valuable):** if calibration routes
  are predominantly bidirectional and a scenario is a one-way loop (or vice
  versa), show a warning note — the calibration factor silently embeds the
  direction profile of the routes it was fit on. This costs almost nothing
  (direction attributes are on the features already) and prevents the most
  likely real-world misuse.
- **Hybrid trunk+loops:** representable today as a Service (paired trunk
  patterns) plus loop features, and `computeSegments` shows how per-segment
  treatment *could* work — but defer. A length-weighted blend of per-pattern
  multipliers within a Service is the eventual v2 if demand materializes.
- **Longer-term principled path:** once the travelshed engine (Idea 6) exists,
  directionality stops being a fudge factor — a one-way loop's travelshed is
  visibly smaller/asymmetric, and accessibility-based demand adjustment
  becomes possible. Another reason Idea 6 is strategically central.

**Testing note:** any change to `applyElasticity` or a new multiplier function
is calculation-engine math → golden-value test cases and a
`Verified: node test/run-golden.mjs` line in the commit, per the testing policy.

### Effort: multiplier + warning = **small**. Methodology write-up (in
`TPI_Ridership_Forecast_Methodology.md` + the user-facing readme) is the real
deliverable; without it the number is indefensible in front of a client.

---

## Idea 6 — Transit travelshed from a user-selected point

The strategic centerpiece. Reuses the walkshed engine's bones and unlocks
Idea 4.

### Architecture sketch (extends `road-network.js` + `walkshed.js` patterns)

**Inputs:** origin (clicked point or existing Point feature), total time
budget T (e.g. 45 min), walk speed, day type + time period (to select the
active band per route via `getEffectiveServiceBands`), boarding penalty
(default ~1–2 min), transfer cap (v1: 1).

**Algorithm — layered floods rather than a true multimodal graph:**
1. **Initial walk flood** from the origin using the existing budget-limited
   Dijkstra, but keeping per-node *arrival times* (the engine already settles
   nodes with costs; we expose them instead of only polygonizing).
2. **Boarding points:** Point features with `associatedRoutes` (real stops);
   for routes with no stop points, synthesize stops by sampling the geometry
   at the service type's `defaultStopSpacing`. Snap to network
   (`snapToNetwork` exists, walk mode).
3. **Ride:** for each boarding point reached at time t₀ < T: wait = headway/2
   (from the selected period's band) + boarding penalty, then propagate along
   the route geometry at `avgSpeed` (or proportional `runTime`) to each
   downstream stop. **The `direction` attribute governs propagation** — "Both"
   propagates both ways; Loop/CW/CCW propagates one way around. (Note how
   this makes Idea 5's directionality *visible* rather than assumed.)
4. **Egress walk floods:** from each alighting stop with remaining budget,
   run another walk flood; the travelshed is the union of all reached nodes
   across all floods. One transfer = repeat step 3 from boarding points
   newly reached by egress floods.
5. **Polygonize** with the existing concave-hull auto-relax loop; optionally
   render banded isochrones (15/30/45) by thresholding node arrival times.

**The key performance design decision:** per-stop walk floods must be
computed **once at full budget, storing per-node distances**, then *thresholded*
per query — not re-flooded per remaining-budget value. That makes a single
travelshed cost ~(stops reached) cheap floods with heavy cache reuse, and it's
what makes Idea 4's batch mode (hundreds of origins) feasible at all. Cache
keyed like the walkshed module: settings + network epoch + feature geometry.

### What we're missing / assuming
- **Real stop locations** for drawn scenarios (mitigated by `associatedRoutes`
  points where placed, sampled spacing otherwise — disclose which was used).
- **Schedules**: frequency-based wait assumption, as discussed under Idea 4.
- **Dwell times, transfer reliability**: fold into the boarding penalty knob.
- **Speed realism**: `avgSpeed` is user-asserted; `runTime` where entered is
  better. Both already exist as attributes.

### Effort: **large** — the biggest single lift on this list (new engine
surface in `road-network.js`, a new module, careful caching) — but it's
incremental on proven code, not greenfield, and it's the prerequisite for the
highest-value consulting outputs (Idea 4's headline stats).

---

## Prioritization

Ordered for consultant value per unit of risk, not raw ease — though the top
of the list happens to be both high-value and mostly-built-already.

| # | Item | Effort | Why here |
|---|---|---|---|
| **1** | **Transit Coverage module (Ideas 1+2 merged: residents & jobs near transit, by frequency tier)** | Moderate-low | Produces slide-ready stats immediately; ~90% existing machinery (BAS pipeline + LODES + time bands); the frequency-tier definition work is the only novel part. Design its persistence for scenario comparison from day one. |
| **2** | **Named scenario slots, then Scenario Comparison module (Idea 3)** | Small, then moderate | Multiplies the value of every module including #1 ("coverage today vs. proposed"). Slots are nearly free; the comparison module compares persisted results, so no API costs. |
| **3** | **Directionality multiplier + calibration-consistency warning in RF (Idea 5, modest version)** | Small | Cheap, closes a real modeling gap, uses the established service-premium pattern. Requires golden-test updates and honest methodology docs. Segment-level hybrid modeling explicitly deferred. |
| **4** | **Transit travelshed engine + module (Idea 6)** | Large | The strategic investment. Layered on the walkshed/Dijkstra engine with the per-stop-flood caching design above. High demo value on its own (click a point, see the transit-shed). |
| **5** | **Accessibility metrics (Idea 4): jobs-within-T from a point; then batch population-weighted "average resident" version** | Small on top of #4, then moderate | Point-level metric is nearly free once #4 exists (travelshed ∩ LODES). The batch version is the headline-stat generator and depends on #4's caching + #2's scenarios for before/after. |

**Sequencing logic:** #1 and #2 ship client-ready deliverables within the
current architecture and force no methodology debates. #3 is an opportunistic
small win. #4 is the one genuinely new engine and everything after it (#5,
and eventually a principled treatment of directionality) compounds on it —
which is why it outranks its cost. GTFS-derived headways for existing-network
baselines is the natural follow-on after #5.

**Cross-cutting requirements for all of the above:**
- New pure math (tier classifier, direction multiplier, travelshed timing
  functions) gets golden-value test cases (`test/cases/`), per policy.
- Every module that produces a client-facing number carries a methodology
  footnote (area-weighting, LODES coverage, frequency-based routing
  assumptions) — consultants get cross-examined on these.
- New modules follow the standard patterns: `App.registerModule`,
  `renderModuleState` for stale/empty states, `.rf-status` shared classes,
  session persistence via `cache.registerModule`, floating legend via
  `popup.showFloatingWidget`.
