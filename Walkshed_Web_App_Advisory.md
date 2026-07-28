# FLM Walkshed Index Web App — Technical Findings & Scope Review

**Prepared for:** Internal project team (firm principal + SME developers)
**Purpose:** Internal advisory to drive the Task 3.1 methodology memo, the Task 1.3 risk/decision logs, and final negotiation of the Scope of Work (SOW) with DOT.
**Status:** Draft for internal use. Not for client distribution as-is.

> This document is **internal**. It records *how* the product will be built and the decisions that bound our work. The SOW itself remains the non-technical, client-facing instrument. Keep the two separate: this memo feeds the SOW's methodology memo, risk log, and acceptance criteria, but the implementation detail here stays in-house.

---

## 0. What this review is based on

- **Reference implementations reviewed:**
  - The firm's existing walkshed prototype: `github.com/scheibws/walkshed-index` — two single-file HTML apps (`index.html` ~1,350 lines; `index_5.12.26.html` ~2,750 lines, the more complete version). Same methodology in both.
  - The broader transit-analysis codebase (this repo) as a pattern library for architecture, module structure, and documentation discipline.
- **Client document reviewed:** Draft Scope of Work (Tasks 1–5).

The existing prototype is a genuinely capable tool and a strong starting point. The findings below are not criticism of a prototype doing its job — they are the specific things that must change when a prototype becomes a **publicly hosted, DOT-owned, multi-user, accessibility- and security-reviewed application**.

---

# PART A — Technical Findings (Decision Items)

Each finding is written as a **decision we need DOT (or ourselves) to make**, because each one bounds scope, cost, or schedule. These map directly to the Task 3.1 methodology memo and the Task 1.3 decision log.

## A1. 🔴 Exposed credentials in the prototype (immediate + architectural)

**Finding.** Both prototype files contain working secrets hardcoded in client-side source, committed to a **public** GitHub repository:
- A Mapbox access token (`pk.eyJ1Ijoid2FsdGVyc2NoZWli…`, redacted).
- A U.S. Census API key (`6476…`, redacted).

**Two distinct problems:**

1. **Immediate hygiene (do now, independent of this project):**
   - Rotate the Census API key (free to reissue; treat any committed key as burned).
   - In the Mapbox account, restrict the token to approved URLs and set a hard billing cap. An unrestricted public token in a public repo can be lifted and run up charges against our account.

2. **Architectural (the real point).** *Any* browser app exposes its keys — that is unavoidable client-side. A **public, multi-user DOT app cannot ship a key that bills our or DOT's account to anonymous users.** The fix is a **server-side proxy / backend** that holds credentials, enforces rate limits, and meters usage. This is the clearest single piece of evidence that the front-end-only model does not survive public deployment.

**Decision needed.** Confirm that Task 2 hosting requirements explicitly include **secrets management and an API-proxy/backend** for any keyed or paid service.

**SOW linkage.** Task 2.2 (security/data-access requirements); Task 4.4 (DOT OIT security review). *DOT OIT will find committed keys and unproxied external calls in their security review — get ahead of it.*

## A2. 🟠 Scoring is batch-relative — a validity problem for a statewide tool

**Finding.** The index normalizes each variable 0–100 **relative to the other walksheds in the current run** (min–max), averages them, then re-normalizes so best = 100 / worst = 0 *within that batch*.

**Why it matters.** A station's score depends on **what else happened to be loaded with it.** The same station scores differently in a 5-station run vs. a 50-station run. For a tool DOT will use statewide — for prioritization, grant scoring, and cross-agency comparison — relative-only scoring is a serious problem:
- Scores are not comparable across sessions, users, or regions.
- "Validate app results against a benchmark" (Task 4.3) is nearly impossible against a moving target.

**Decision needed (highest-value methodology decision in the engagement).** Choose **absolute vs. relative normalization**:
- *Absolute* — score against a fixed statewide reference distribution or fixed thresholds, so a station's score is stable and comparable. **Recommended** for a statewide prioritization tool.
- *Relative* — keep batch-relative, but only if DOT explicitly wants within-batch ranking and accepts non-comparability. If so, label scores in the UI as "relative to current set."

**Related decisions (also value judgments embedded in code today):** directionality choices such as "population reached: higher = worse" and income inversion. These are policy positions, not defaults — DOT must sign off in the methodology memo.

**SOW linkage.** Task 3.1 (methodology), Task 4.3 (validation). This must be resolved **before** any scoring code is written.

## A3. 🟠 Isochrone engine: Mapbox vs. ArcGIS vs. self-hosted

**Finding.** The walkshed is a **real walking-network isochrone** (good — not a circular buffer), computed via the **Mapbox Isochrone API** (5/10/15/20/30-min contours). But the SOW is written in **Esri/ArcGIS language** (AGOL, GP services, "the automated ArcGIS model"). The engine in the prototype is not Esri.

**Why it matters.** Different street networks produce **different walkshed polygons**, which produce different scores. Each option carries different cost, licensing, and hosting consequences:

| Option | Pros | Cons |
|---|---|---|
| **Mapbox Isochrone** (current) | Already working; fast; good quality | Recurring per-request cost; commercial ToS (restrictions on storing/redistributing results); token exposure (see A1) |
| **ArcGIS Network Analyst / GP service** | Matches SOW's Esri framing; DOT likely already licensed; clean hosting/handoff | Esri skillset; credit/licensing cost; different output than current prototype |
| **Self-hosted (Valhalla / OpenTripPlanner / pgRouting)** | No per-request vendor cost; full control | We run/maintain a server; more setup; another thing to hand off |

**Decision needed.** Pick the engine **as a documented output of the Task 2 proof-of-deployment**, not as a SOW commitment. Whichever is chosen becomes the benchmark for Task 4 validation.

**SOW linkage.** Task 2.3 (proof-of-deployment), Task 3.1 (methodology), Task 3.3 (backend services).

## A4. 🟠 Data delivery: live API calls vs. published layers

**Finding.** The prototype fetches Census ACS + TIGERweb geometries **live at runtime**, with a hand-rolled per-tract cache and a **2-at-a-time batch queue** — meaning the prototype has already hit rate-limiting in practice.

**Why it matters.** Live, throttled, third-party calls per request will not satisfy "multiple-user use… larger datasets" (Task 4.4) and are brittle for a public app (census.gov outages become our outages).

**Decision needed.** Confirm Task 3.2's "publish required data layers" means **pre-staged, curated, versioned layers** (hosted feature layers or a backend datastore) rather than runtime API calls. Define the **data refresh cadence and owner** (ACS updates annually; crash/transit data on their own cycles).

**SOW linkage.** Task 3.2 (publish data), Task 2.4 + Task 4.7 (data update documentation, ownership).

## A5. 🟡 Architecture & maintainability for handoff

**Finding.** The prototype is a **single 2,750-line HTML file**. Fine for a prototype; a liability as a **DOT-owned, OIT-maintained** deliverable.

**Why it matters.** Task 4.7 obligates us to deliver source code, scripts, and maintenance docs for **DOT ownership**. A bespoke single-file app maintained by SMEs is a transfer risk if DOT OIT cannot maintain it either.

**Recommendation.**
- Adopt a **modular structure** with a **single declarative config** for the scoring methodology (the `VAR_META` "one entry drives metadata + UI + math" pattern from this repo). This lets non-developers add a sub-index safely and keeps the calculation testable independent of the UI.
- Set the **quality/documentation bar to DOT OIT's ability to maintain it**, not to our internal convenience.
- Keep our **own** scope lean: build **one index well**. Resist porting unrelated analysis modules from the larger toolkit.

**SOW linkage.** Task 3.6 (staged development), Task 4.7 (handoff).

## A6. 🟡 Methodology expansion (4 → many sub-indices)

**Finding.** The prototype scores **4 variables** (population reached, non-white %, zero-vehicle HH %, median income). The SOW lists many more candidate layers: sociodemographic, employment, **crash, transit, roadway, trail, pedestrian network**.

**Why it matters.** This is a **methodology expansion**, not a straight port. Each new layer needs a source, a processing step, a normalization rule, and a documented field definition.

**Recommendation.** Lock the final sub-index list in the Task 3.1 memo *before* building. Implement sub-indices as config entries so the list can grow without rewrites. Treat the **optional transit ridership/forecast subcategory** (Task 3.4) as separately scoped and priced.

**SOW linkage.** Task 3.1, Task 3.2.

## A7. 🟡 Accessibility (Section 508 / WCAG)

**Finding.** Map-canvas apps (Mapbox/MapLibre) and custom popups/checkboxes are routinely **non-conformant** without dedicated effort. The PDF export (jsPDF, image-based) is not 508-conformant on its own.

**Why it matters.** A state DOT public app must meet 508/WCAG. This is the single most underestimated line item in SOWs like this.

**Recommendation.** Budget accessibility from the start, not in Task 4. Provide a **keyboard-navigable, screen-reader-accessible tabular results path** that does not require interacting with the map canvas. Plan an accessible (tagged or HTML) report alternative to image-only PDF.

**SOW linkage.** Task 3.4 (UI), Task 4.4 (accessibility testing).

## A8. 🟡 User inputs, formats, and coordinate systems

**Finding.** Input today is **shapefile ZIP upload or map clicks**, auto-named "Stop 1, Stop 2…".

**Why it matters.** Planners will bring CSVs, GeoJSON, and files in varied projections (State Plane, lat/lon swapped). Shapefile-only will frustrate users; unhandled CRS will silently misplace stations. Uploads are also a **security surface** for a public app.

**Recommendation.** Support CSV + GeoJSON + shapefile; **detect/validate CRS**; enforce file-type and size limits; treat all uploads as untrusted; preserve a user-supplied name field. Document supported formats and limits (Task 4.4).

**SOW linkage.** Task 3.4 (station input), Task 4.4 (input-size limits).

---

# PART B — Point-by-Point SOW Review

Legend: ✅ = sound as written · ➕ = suggested addition · ⚠️ = gap/risk to tighten.

## Task 1 — Project Management

| Item | Assessment |
|---|---|
| 1. PM Plan & Schedule | ✅ Standard. ➕ Tie the schedule to **explicit decision gates** (methodology sign-off, Task 2 stack decision) so build work can't start ahead of its prerequisites. |
| 2. Project Administration | ✅ |
| 3. Risk/Issue/Change Tracking | ✅ Good that this is named. ➕ Seed it with the items in Part D below from day one. ➕ Add a **Decision Log** (see Part E) alongside the risk log — methodology and stack decisions need a durable record for a legally binding relationship. |

**Gaps / additions:**
- ⚠️ **Acceptance criteria belong here conceptually but are missing everywhere.** Define, in writing, what "done/accepted" means (see Task 4). Without it, a fixed-fee contract has no finish line.
- ➕ **AI-use / procurement transparency.** Confirm whether DOT has any policy requiring disclosure of AI-assisted development. We need not advertise method, but we should not be surprised by a policy. (Note: Task 4.7 still obligates full source-code delivery — the artifact is not a black box even if the method is low-profile.)

## Task 2 — App Hosting Requirements & Coordination

| Item | Assessment |
|---|---|
| 1. DOT Hosting Coordination | ✅ Critical and correctly placed first. |
| 2. Hosting-Related Technical Requirements | ✅ ➕ **Add secrets management / API-proxy** explicitly (Finding A1). ➕ Add **cost ownership for paid services** (who pays the Mapbox/isochrone bill in production — see additions below). |
| 3. Proof-of-Deployment ("hello world") | ✅ Excellent — this is the natural **gate** for the stack/engine decision. ➕ State that the **architecture and isochrone-engine choice are outputs of this step**, so we are not locked into an approach before we know the environment (Findings A3, A5). |
| 4. Transfer & Maintenance Requirements | ✅ ➕ Specify **data-refresh ownership and cadence** post-handoff (Finding A4). ➕ Specify a **warranty / bug-fix window** after launch (see gaps). |

**Gaps / additions:**
- ⚠️ **Recurring production costs are unaddressed.** If the engine stays Mapbox (or any metered API), someone pays per-request at public scale. Decide and document **who owns that account and bill** (DOT vs. consultant pass-through) — this is a contract/budget item, not a technical detail.
- ⚠️ **Licensing/ToS of derived data.** Mapbox isochrone results have ToS constraints on storage/redistribution; confirm we can store/export walkshed polygons in DOT outputs. Same diligence for any third-party layer republished as a hosted layer.
- ➕ **Analytics / usage logging + privacy.** A public app usually wants basic usage metrics; for a government app this carries privacy/records considerations. Decide what is logged and disclosed.
- ➕ **Backup / disaster recovery / uptime expectation.** Even a modest SLA expectation should be named so "public availability" is bounded.

## Task 3 — Walkshed Index Web App Development

| Item | Assessment |
|---|---|
| 1. Confirm & Document Methodology (memo) | ✅ The most important deliverable. ⚠️ Make it a **sign-off gate**, not just a document. ⚠️ It **must resolve** absolute-vs-relative normalization (A2) and the isochrone engine (A3) before scoring is coded. ➕ Document the embedded **value judgments** (directionality, income inversion) for DOT approval. |
| 2. Prepare & Publish Data Layers | ✅ ➕ Confirm "publish" = **pre-staged/curated/versioned** layers, not runtime calls (A4). ➕ Deliver a **data dictionary** (field definitions, sources, vintages, refresh procedure). |
| 3. Backend Geoprocessing/Calculation Services | ✅ Backend is correctly in scope by name. ⚠️ Scope hinges on the A3 engine decision. ➕ Include the **API proxy/secrets layer** here (A1). |
| 4. UI & User Workflow | ✅ ➕ Build accessibility in now (A7). ➕ Widen input formats + CRS handling (A8). The **optional transit subcategory** should be flagged as separately priced. |
| 5. Output, Export, Reporting | ✅ PDF already proven in the prototype (jsPDF) — good. ⚠️ Image-only PDF is not 508-conformant; plan an accessible report path (A7). ➕ Enumerate exact export formats (CSV raw + summary, GeoJSON and/or shapefile/FGDB, PDF). |
| 6. Dev Coordination / Iterative Refinement | ✅ ➕ Tie refinements to the **change log** (Task 1.3) so scope changes are tracked against budget. |
| 7. Draft Deployment Package for Testing | ✅ ➕ Define what "testing-ready" includes (seed data, sample stations, known-good benchmark outputs for Task 4.3). |

**Gaps / additions:**
- ⚠️ **Validation benchmark dataset.** Task 4 must validate against *something fixed*. Commit here to producing an agreed **set of sample stations + expected results** from the spreadsheet/ArcGIS model. This is the only way A2/A3 decisions become testable.
- ➕ **Methodology peer/QA review.** For a tool feeding grant prioritization, a documented internal QA of the scoring math (independent of the SME who wrote it) is cheap insurance.

## Task 4 — Web App Testing

| Item | Assessment |
|---|---|
| 1. Pilot Testing Plan | ✅ Thorough. ⚠️ "Success criteria for pilot testing and final acceptance" is named but undefined — **define numeric/explicit criteria** (below). |
| 2. Functional Testing | ✅ |
| 3. Validate Methodology & Calculation | ⚠️ Requires a **fixed benchmark** (see Task 3 additions) and a **stated tolerance** (e.g., "matches benchmark within ±X%"). Impossible to pass cleanly if A2 (relative scoring) is unresolved. |
| 4. Accessibility / Security / Performance / Browser | ✅ Correctly broad. ⚠️ Replace "approved desktop browsers" with a **named browser/version matrix**. ⚠️ Define "reasonable input sizes" with **numbers** (max stations per run, expected processing time). Accessibility and the OIT security review (A1) are the two hardest items here. |
| 5. User Acceptance Testing | ✅ ➕ Cap the **number of UAT/revision cycles** included in fee; further cycles via change order (prevents "retest until accepted" becoming unbounded). |
| 6. Issue Resolution / Retesting | ✅ ➕ Route through the change log; classify issues (blocking vs. enhancement) so post-launch wishes don't masquerade as defects. |
| 7. Final Deployment & Handoff | ✅ ➕ Define handoff acceptance: code repo, deployment runbook, data-update runbook, maintenance doc, and a **warranty window**. |

**Gaps / additions:**
- ⚠️ **Acceptance criteria (the biggest contractual gap, restated).** Write a finite, checkable acceptance list: methodology within tolerance on the benchmark set; named browsers pass; defined accessibility conformance level (e.g., WCAG 2.1 AA target with documented exceptions); performance within stated limits; UAT sign-off. Without this, the fixed-fee finish line is undefined.
- ➕ **Performance budget.** State expected processing time for, e.g., 1 / 25 / 100 stations, and the maximum supported batch.

## Task 5 — Communication & Outreach

| Item | Assessment |
|---|---|
| 1. Communication/Outreach Strategy | ✅ |
| 2. User Guidance & Training Materials | ✅ ➕ Include a short **"how to interpret the score" / methodology-in-plain-language** piece — essential given the normalization nuance (A2). Users will misread scores if comparability isn't explained. |
| 3. Training Sessions / Office Hours | ✅ ➕ Bound the **office-hours support period** (duration/hours) so it doesn't become open-ended support. |
| 4. Communication Support | ✅ |

**Gaps / additions:**
- ➕ **Support model after office hours end.** Name what ongoing support (if any) exists post-period, or state explicitly that maintenance transfers to DOT.

---

# PART C — Tasks/Topics Missing from the SOW Entirely

These are not in any task today and should be added or consciously excluded:

1. **Secrets management / API proxy / production credential handling** (A1) — currently nowhere; belongs in Task 2/3.
2. **Recurring cost ownership for metered services** (Mapbox or equivalent) — budget/contract item.
3. **Third-party data licensing & ToS** for storing/exporting derived isochrones and republished layers.
4. **Acceptance criteria & validation tolerance** — referenced but undefined; the central contractual gap.
5. **Warranty / defect-fix window** post-launch (e.g., 30–90 days).
6. **Versioning of methodology and data** — when scoring or ACS vintage changes, prior outputs change; define how versions are stamped on exports/PDFs for reproducibility (important for grant applications submitted using a given version).
7. **Privacy / records / analytics** posture for a public government app.
8. **Backup/DR and uptime expectation.**
9. **Decommission / transition plan** if DOT later replaces the tool.
10. **AI-use disclosure** check against DOT procurement policy.

---

# PART D — Risk Register Seed (for Task 1.3)

| # | Risk | Impact | Likelihood | Mitigation / Owner |
|---|---|---|---|---|
| R1 | Hosting/stack decision (Task 2) slips → build can't responsibly start | Schedule | Med | Make Task 2 proof-of-deployment a hard gate before Task 3 scoring work; principal owns DOT coordination |
| R2 | Methodology not locked (absolute vs. relative scoring) before coding | Rework, failed validation | High | Methodology memo sign-off gate (Task 3.1) precedes scoring build |
| R3 | Exposed/unproxied credentials fail OIT security review | Deployment block | High | API proxy/secrets layer in Task 2/3; rotate & restrict existing keys now |
| R4 | Accessibility (508/WCAG) underestimated | Acceptance failure, rework | High | Budget accessibility from Task 3; accessible tabular results path; early audit |
| R5 | Live Census/TIGERweb calls don't scale to multi-user/public | Performance failure | Med-High | Pre-publish curated layers (Task 3.2); backend datastore |
| R6 | Recurring API (Mapbox) cost at public scale unowned | Budget overrun / billing surprise | Med | Decide engine + account/bill owner in Task 2; consider self-hosted engine |
| R7 | Acceptance criteria undefined → unbounded UAT/revisions | Budget/schedule | High | Define numeric acceptance + cap revision cycles in SOW |
| R8 | Handoff codebase unmaintainable by DOT OIT | Post-launch failure, reputation | Med | Modular + config-driven build; runbooks; documentation to OIT's bar |
| R9 | Input CRS/format errors silently misplace stations | Wrong results, user distrust | Med | CRS detection/validation; format whitelist; upload validation |
| R10 | Scope creep (extra modules, optional transit subcategory) | Budget/schedule | Med | Keep to one index; price options separately; enforce change log |

---

# PART E — Decision Log Seed (for Task 1.3)

| # | Decision needed | Options | Recommended | Gate |
|---|---|---|---|---|
| D1 | Hosting environment | DOT OTIS / AWS S3 / AGOL / other | TBD with DOT | Task 2.1 |
| D2 | Isochrone engine | Mapbox / ArcGIS Network Analyst / self-hosted | Decide at proof-of-deployment | Task 2.3 |
| D3 | Architecture | Esri-native (Experience Builder + GP) vs. custom web app + backend | Driven by D1/D2 | Task 2.3 |
| D4 | Normalization | Absolute (statewide reference) vs. batch-relative | **Absolute** for a statewide prioritization tool | Task 3.1 |
| D5 | Final sub-index list | 4 (current) → expanded set | Lock in methodology memo | Task 3.1 |
| D6 | Data delivery | Live API vs. published/versioned layers | **Published layers** | Task 3.2 |
| D7 | Credential handling | Client-side (current) vs. server proxy | **Server proxy/backend** | Task 2.2 |
| D8 | Acceptance tolerance | e.g., ±X% vs. benchmark | Define with DOT | Task 4.3 |
| D9 | Browser/device matrix | Named list | Define with DOT OIT | Task 4.4 |
| D10 | Optional transit subcategory | In / out / separately priced | Separately priced option | Task 3.4 |

---

## One-paragraph bottom line

The existing prototype already does the hard part — real walking-network isochrones with area-weighted ACS enrichment and PDF export — so feasibility is not in doubt. The work that actually defines this engagement is everything a prototype skips: **a stable, comparable scoring methodology (absolute, not batch-relative); a chosen and documented isochrone engine; curated/published data instead of live throttled API calls; credentials behind a backend proxy; real accessibility; and a defined acceptance finish line.** Make the **Task 2 proof-of-deployment** the gate for the stack/engine decisions and the **Task 3.1 methodology memo** a sign-off gate for the scoring decisions, lock numeric acceptance criteria into the SOW, and keep our own build scope to **one index, done well, on a config-driven structure DOT OIT can maintain.**
