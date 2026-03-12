# Client-Readiness Assessment: TPI & Ridership Forecasting Models

## Context

We're approaching a development freeze in favor of client deliverables. This document is a systematic audit of the Transit Propensity Index (TPI) and Ridership Forecasting (RF) models — covering mathematical soundness, data validity, transparency, missing outputs, and documentation. Each finding is flagged:

- **RED** — Must fix before client use. Risk of incorrect results, misleading outputs, or professional embarrassment.
- **YELLOW** — Should fix. Workaround exists, but creates risk of confusion or edge-case failures.
- **GREEN** — Solid. No concerns.

---

## 1. Mathematical Soundness

### 1.1 Quintile Normalization (TPI) — ✅ FIXED

The original formula `Math.floor((qi / n) * 5) + 1` had an IEEE 754 floating-point bug: for any N that is a multiple of 5, position qi=3N/5 produced the wrong quintile because `3/5` rounds **down** in double precision (`0.5999…`), causing `0.5999… × 5 = 2.999…` → `floor = 2` instead of `3`. For N=5 this meant quintile 4 was never assigned (output was `[1, 2, 3, 3, 5]`). The same error occurred at N=10 (qi=6), N=15 (qi=9), etc.

**Fix**: Changed to `Math.floor(qi * 5 / n) + 1` — multiplying before dividing keeps intermediate values as exact integers (e.g. `3×5=15`, `15/5=3.0` exactly), eliminating the rounding error. N<5 continues to use the equal-interval fallback (no change needed).

### 1.2 Composite Score — GREEN

Weighted average with missing-factor redistribution (`tpi-scoring.js:426-453`) is mathematically correct and defensible. Missing factors have their weight spread across remaining active factors.

### 1.3 CDI Population Weighting Fallback — YELLOW

At `ridership-scoring.js:169`, when population density is unavailable, the code uses fallback weight=1:
```js
var pop = (popDens && Number.isFinite(popDens)) ? popDens * areaSqMi : 1;
```
Unpopulated areas (parks, industrial zones) still contribute to the weighted average. Usually negligible, but could bias CDI in areas with many non-residential geographies.

### 1.4 Calibration with N=2 — ✅ FIXED

The minimum matched-route threshold has been raised from 2 to 3 at all three gate locations (`ridership-forecasting.js`): `onMatchRoutes()`, `onOpen()` restore path, and the initial restore check. Step 3 (Run Calibration) remains locked at `opacity:0.5; pointer-events:none` until ≥3 routes are matched. Warning text updated to "3 or more required to run calibration."

### 1.5 Elasticity Formulas — GREEN

Constant-elasticity power curves `(new/base)^elasticity` are standard in transit planning. Defaults (frequency 0.5, span 0.7) are within published TCRP ranges. Span elasticity backed by Currie & Loader (2009).

### 1.6 Service Premiums & Scenario Builder — GREEN

Multiplicative premium application and vehicle/cost formulas are standard transit planning math. No issues found.

### 1.7 costPerBoarding Infinity — YELLOW

At `ridership-scoring.js:706`, zero ridership produces `costPerBoarding = Infinity`. Displays as the string "Infinity" in the UI. Not a crash, but looks unprofessional.

---

## 2. Data Validity

### 2.1 TIGERweb Pagination — GREEN

The TIGERweb fetch at `js/core/census.js:50-71` correctly uses `exceededTransferLimit` with offset-based pagination (page size 1000). The loop continues fetching until the server reports no more data. This is the standard ArcGIS REST API pagination mechanism and handles large study areas correctly.

### 2.2 Census API Key — YELLOW

No API key is configured. The Census API allows ~500 requests/day without one. A TPI analysis makes multiple requests per run; intensive use sessions could hit rate limits mid-analysis with cryptic errors.

### 2.3 LODES Vintage Mismatch — YELLOW

No check that the LODES file year matches the selected ACS year. A user could combine 2019 LODES with 2024 ACS without any warning.

### 2.4 ACS Data & Area Apportionment — GREEN

ACS year selection, missing variable handling, and `turf.intersect`/`turf.area` apportionment calculations are all correct. No concerns.

---

## 3. Circularity & Independence

### 3.1 Study Area Sensitivity — YELLOW

This is the most subtle issue. Quintile normalization is performed within the corridor only, so:

- Adding/removing a station changes the buffer union
- This changes which geographies are included
- Which changes ALL quintile rankings (not just affected areas)
- CDI scores are **not comparable** across different study area configurations

This isn't technically circular (the math is correct for given inputs), but two analysts drawing slightly different routes could get meaningfully different CDI scores for the same corridor. Users need to understand scores are **relative**, not absolute.

### 3.2 Shared-Pool Normalization — GREEN

Well-designed solution to the cross-system calibration problem. Runs one TPI across both calibration and demand features, partitions results, auto-refits calibration. Sound methodology.

### 3.3 Module Weight Independence — GREEN

TPI and RF maintain separate `_weights` objects. "Copy From TPI" is an explicit user action. No hidden coupling.

### 3.4 LODES Weight Redistribution — YELLOW

When LODES is absent, Employment weight (35%) is evenly split among other active factors (`tpi-scoring.js:569-580`). The warning icon is small and easy to miss. Users may not realize a 35-point weight shift occurred.

---

## 4. Transparency & Auditability

### 4.1 Calibration Export — GREEN

Calibration JSON v3 includes: coefficients, method, R², sample size, weights, feature filter, per-route CDI with factor breakdowns, geo level, year, normalization mode, baseline uncertainty, service premiums, and headway normalization metadata. Comprehensive.

### 4.2 Scenario Export — ✅ DONE

Scenario JSON export now includes: CDI value, corridor length, calibration factor/method/intercept/N/R², weights, span elasticity, baseline uncertainty, corridor name, and full metadata block (tool name, export date, geography level, ACS year). Scenario CSV export includes a `#`-prefixed metadata comment header with the same key fields. Version bumped to v2.

### 4.3 Hardcoded Reference Values — YELLOW

Two reference values are invisible to users:
- **Reference headway: 30 minutes** (`ridership-forecasting.js:867`) — used for headway normalization during calibration
- **Base span: 14 hours** (`ridership-scoring.js:567`) — denominator for span elasticity

Both are defensible defaults, but a reviewer needs to know them to check the math.

### 4.4 Effective Weights & Tract Fallback Tracking — GREEN

TPI result includes `effectiveWeights` and `tractFallbackFactors`. Good auditability.

---

## 5. Missing Outputs

### 5.1 Methodology Metadata in Exports — ✅ DONE

All 7 exports now include methodology metadata. JSON/GeoJSON exports contain a `metadata` object with tool name, export timestamp, geography level, ACS year, and corridor name. CSV exports include a `#`-prefixed comment header block with the same fields. Covers: RF scenario CSV/JSON, RF demand GeoJSON/CSV, RF calibration JSON, TPI GeoJSON, TPI CSV.

### 5.2 Per-Segment Factor Breakdown — YELLOW

Segment analysis produces CDI per segment but not per-factor quintile breakdowns. Per-route CDI includes factor breakdowns — this inconsistency limits segment-level reporting.

### 5.3 PDF/Print Summary — YELLOW

No built-in print-formatted export. Client presentations require manual screenshot assembly.

### 5.4 Sensitivity Analysis — YELLOW

No automated way to test how results change when buffer radius, weights, or study area boundaries shift. Users must manually re-run and compare.

---

## 6. Documentation Gaps

### 6.1 User-Facing Documentation — GREEN

`Ridership_Forecast_Readme.md` (517 lines) is thorough, well-written, and appropriate for transit professionals. Includes worked examples, interpretation guides, glossary, and decision matrix. Strong asset.

### 6.2 Methodology White Paper — ✅ DONE

Draft at `TPI_Ridership_Forecast_Methodology.md`. Covers factor selection rationale, ACS/LODES data sources, quintile normalization algorithm (standard and small-N), composite scoring, CDI computation (system-wide, per-route, segment-level), calibration methods (ratio, OLS, headway normalization), elasticity models (frequency, span, service premium), scenario formulas, baseline uncertainty model, normalization pools, limitations, and literature citations (TCRP 95/118/167, Currie & Loader, Ewing & Cervero). Includes ACS variable reference table and notation appendix. User notes flag where supplemental citations should be added.

### 6.3 Default Weight Rationale — RED

Default weights (Pop Density 35, Employment 35, then mostly 5 each) are presented without published justification. The tool allows customization, but defaults carry implicit authority. A peer reviewer or FTA evaluator will ask "why these weights?"

### 6.4 Formal Limitations Section — YELLOW

The Readme says what the tool is NOT, but lacks a formal limitations section covering: study area sensitivity, small-N behavior, rate limiting, LODES vintage mismatch.

---

## 7. Recommended Actions (Prioritized)

### Must Fix (RED) — Before Any Client Use

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 1 | ✅ **Calibration N=2 gate** | Block or prominently warn (red banner) against calibration with <3 routes. R² from N=2 is statistically meaningless. | 2-4 hrs |
| 2 | ✅ **Scenario export completeness** | Add CDI value, calibration factor, corridor name, weights, span elasticity, and corridor length to scenario exports (CSV and JSON). | 3-4 hrs |
| 3 | ✅ **Export metadata headers** | Add methodology metadata (tool version, date, geography level, ACS year, corridor name) to all exports. | 4-6 hrs |
| 4 | ✅ **Methodology white paper** | Write a 3-5 page document covering factor selection, normalization, CDI computation, calibration methods, elasticity models, with literature citations. | 2-3 days |
| 5 | **Default weight rationale** | Document why the defaults are what they are — cite research, stakeholder input, or expert judgment, and note they're user-adjustable. | 1 day |

### Should Fix (YELLOW) — Before Formal Deliverable

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 6 | ✅ **Quintile formula (small N)** | Fixed IEEE 754 floating-point rounding bug (`qi*5/n` instead of `(qi/n)*5`). All quintile values now reachable for any N≥5. | 2-3 hrs |
| 7 | **CDI pop fallback** | Change fallback from weight=1 to weight=0 (exclude from average) or use area as fallback. | 1 hr |
| 8 | **costPerBoarding clamping** | Display "N/A" or ">$999" instead of "Infinity" when ridership is zero. | 30 min |
| 9 | **Census API key** | Add key support and document how to obtain one. | 1-2 hrs |
| 10 | **LODES vintage warning** | Show warning when LODES filename year doesn't match ACS year. | 1-2 hrs |
| 11 | **Study area sensitivity note** | Add UI note explaining that CDI scores are relative to the study area, not absolute. Show geography count prominently. | 1-2 hrs |
| 12 | **LODES redistribution banner** | Make the weight redistribution more prominent when Employment is excluded. Show effective weights. | 1-2 hrs |
| 13 | **Show reference values** | Display reference headway (30 min) and base span (14 hrs) in the UI, even if not editable. | 1-2 hrs |
| 14 | **Limitations section in Readme** | Add formal limitations section covering all known edge cases. | 2-3 hrs |

### Nice to Have — Future Improvement

| # | Item | Description | Effort |
|---|------|-------------|--------|
| 15 | Per-segment factor breakdowns in exports | 4-6 hrs |
| 16 | Print-friendly summary / PDF export | 1-2 days |
| 17 | One-click sensitivity analysis | 1-2 days |
| 18 | Per-route GeoJSON export | 3-4 hrs |

---

## Summary Scorecard

| Category | TPI | RF | Key Concern |
|----------|-----|-----|-------------|
| Math Soundness | GREEN | GREEN | ~~Small-N quintile~~ ✅ fixed; ~~N=2 calibration~~ ✅ gated at N≥3 |
| Data Validity | YELLOW | YELLOW | No Census API key; LODES vintage mismatch possible |
| Circularity | YELLOW | GREEN | Study-area sensitivity inherent to method |
| Transparency | GREEN | YELLOW | ~~Scenario exports~~ ✅ fixed; hardcoded reference values remain |
| Missing Outputs | YELLOW | YELLOW | No PDF; ~~no methodology metadata~~ ✅ fixed |
| Documentation | YELLOW | YELLOW | ~~No methodology white paper~~ ✅ drafted; default weight rationale still needed |

**Status: 4 of 5 RED items resolved.** Remaining RED item: Default weight rationale (#5).

**Estimated remaining effort for RED items**: ~1 day (weight rationale documentation).

---

## Critical Files

| File | What Needs to Change | Status |
|------|---------------------|--------|
| `js/projects/tpi-scoring.js` | ~~Quintile formula fix (line 383)~~ | ✅ Done |
| `js/projects/ridership-scoring.js` | ~~Calibration N-gate~~; costPerBoarding clamping, CDI fallback | Partially done |
| `js/projects/ridership-forecasting.js` | ~~Scenario exports, export metadata, calibration N-gate~~ | ✅ Done |
| `js/core/census.js` | Census API key support (optional) | Pending |
| `Ridership_Forecast_Readme.md` | Limitations section, methodology references | Pending |
| `TPI_Ridership_Forecast_Methodology.md` | ~~Methodology white paper~~ | ✅ Done (draft) |

## Verification Plan

After fixes are implemented:
1. ✅ ~~Run TPI with a corridor that has exactly 5 block groups — verify all quintile values (1-5) appear~~ (formula fix verified by IEEE 754 arithmetic analysis)
2. ✅ ~~Attempt calibration with 2 routes — verify gate/warning prevents misleading R²~~ (threshold raised to ≥3 at all gate locations)
3. ✅ ~~Export scenarios — verify CDI, calibration factor, weights are present in the file~~
4. ✅ ~~Open any exported CSV/JSON — verify metadata header is present~~
5. ✅ ~~Review methodology white paper against code to confirm all stated formulas match implementation~~
