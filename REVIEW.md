# Code Review: Small Starts CIG Web App

**File reviewed:** `index.html` (1865 lines, ~72KB)
**Origin:** ChatGPT-generated, single-page browser app for FTA Small Starts Land Use screening
**Date:** 2026-02-11

---

## Summary

This is a functional prototype of a geospatial analysis tool that screens FTA Small Starts Project Justification (Land Use) metrics. It runs entirely in the browser, uses live Census APIs, and implements the correct general architecture for its purpose. The code is readable and well-organized for a single-file prototype.

However, there are several bugs that will produce **silently incorrect results** in real use, plus structural issues that matter for reliability.

---

## Critical Bugs (Will Produce Wrong Results)

### 1. TIGERweb API pagination not handled (RESOLVED)

**Location:** `index.html` lines 767-789 (`fetchTigerwebGeos`), lines 1249-1283 (`fetchBlocksInternalPointsInUnion`)

The ArcGIS REST API used by TIGERweb has a default `maxRecordCount` (typically 1000-2000 features). When a query returns more features than this limit, the response is **silently truncated** — it returns partial data with no error.

Both `fetchTigerwebGeos()` and `fetchBlocksInternalPointsInUnion()` make a single query and accept whatever comes back. For station areas spanning many census blocks (the LODES workflow queries at the block level, where hundreds of blocks can exist within even a small area), this will silently undercount:

- Population, households, and all ACS-derived metrics
- Employment (LODES jobs)
- Community Risk percentages

**Fix:** Check for `exceededTransferLimit` in the response and paginate using `resultOffset`/`resultRecordCount`, or split large bounding box queries into spatial tiles.

**Impact:** All computed metrics can be silently too low for any moderately-sized station area.

**Update:**This bug has been resolved and will be incorporated into a future change log document for future reference.

### 2. Breakpoint rating gaps (floating-point boundary errors)

**Location:** `index.html` lines 689-709 (BP lookup tables)

The FTA breakpoint tables have non-contiguous ranges, meaning some valid values match **no category** and silently return "N/A":

**Essential services** (`essentialAvg`, lines 703-709):
- Medium-High: 5.0–7.0
- Medium: 3.0–4.0
- Medium-Low: 1.0–2.0

Values of 4.1–4.9 and 2.1–2.9 fall through every range and return "N/A".

**LBAR ratio** (`lbarRatio`, lines 689-695):
- High: min `2.5000000001`
- Medium-High: max `2.49`

A value of exactly 2.50 (or anything between 2.49 and 2.5000000001) returns "N/A". The same floating-point gap pattern appears for the High/Medium-High boundary in `essentialAvg`.

**Fix:** Make ranges contiguous. Use `>` comparisons instead of `>=` with epsilon offsets.

### 3. Race conditions in async rating updates

**Location:** `index.html` lines 1303-1400, 1527-1566

`updateBreakpointRatings()` is an async function that makes multiple API calls. It's called from:
- Every map click (line 1529)
- Clear/undo button clicks (lines 1540, 1551)
- Every keystroke in the county FIPS input (line 1565)
- Every file upload completion (lines 1602, 1609, 1649, 1666, etc.)

There is no locking, debouncing, or cancellation. If a user clicks three stations in quick succession, three overlapping instances run concurrently, each making independent API calls and writing to the same DOM elements. The final DOM state will reflect whichever instance finishes last, which may not correspond to the current state.

**Fix:** Add a guard flag to skip re-entry while a computation is in progress, or use an AbortController pattern to cancel stale requests.

---

## Moderate Bugs

### 4. LODES parser assumes gzip

**Location:** `index.html` lines 1215-1247

`parseLodesFromUploadedFile()` always calls `pako.ungzip()`. If a user uploads a plain CSV (the file input accepts `.gz,.csv.gz`), the decompression will throw with an unhelpful pako error.

**Fix:** Check for gzip magic bytes (`0x1f 0x8b`) and fall back to plain text.

### 5. No Census API key

**Location:** `index.html` line 811

The Census ACS API URL has no `key=` parameter. The Census API enforces lower rate limits without a key (~500 requests/day per IP). The app makes multiple ACS calls per action, and moderate use will hit rate limits.

**Fix:** Obtain a free Census API key and include it in requests.

### 6. No debouncing on county FIPS input

**Location:** `index.html` lines 1564-1566

```js
document.getElementById("lbarCounties").addEventListener("input", () => {
    updateBreakpointRatings();
});
```

Fires on every keystroke. Typing "06075" triggers 5 calls to `updateBreakpointRatings()`, each making multiple async API requests.

**Fix:** Add a 500ms debounce.

### 7. turf.intersect can throw on degenerate geometries

**Location:** `index.html` lines 901, 986

`turf.intersect()` can throw on self-intersecting polygons. A single failure aborts aggregation for all remaining geographies, producing an incomplete result.

**Fix:** Wrap individual `turf.intersect` calls in try/catch blocks.

---

## Minor Issues

### 8. Mixed event handler patterns

Lines 1669-1671 use `.onchange = fn` while line 1518 uses `addEventListener`. The `.onchange` pattern can be overwritten. Inconsistent but functional.

### 9. innerHTML usage (safe but fragile)

Line 645-647 uses `innerHTML` with a static string. Currently safe since no user data is interpolated, but risky if extended.

### 10. No subresource integrity for CDN scripts

Lines 8-19 load all four libraries from `unpkg.com` without `integrity` attributes. If unpkg were compromised, the app would execute arbitrary code. For government planning contexts, SRI hashes are recommended.

### 11. Global scope for all state

All variables (`points`, `buffers`, `CRE_MAP`, `ESS_POINTS`, `LBAR_SITES`, `LODES_UPLOADED`) and functions are global. Acceptable for a prototype but limits maintainability.

---

## What the Code Gets Right

1. **Area apportioning for additive variables** (line 890-916): Correctly computes intersection area fractions and weights census values proportionally. The `Math.min(1, Math.max(0, frac))` clamping is appropriate.

2. **Dissolved union for double-counting prevention** (lines 552-557): Correctly unions overlapping buffers before aggregation.

3. **Median variables explicitly flagged as approximations**: UI and code both warn that area-weighted averages of medians are not true medians.

4. **LODES point-in-polygon approach** (lines 1249-1298): Using census block internal points rather than area apportionment for employment is a standard screening-grade method.

5. **GEOID normalization** (lines 467-472): Correctly handles the Census "1400000US..." prefix format.

6. **LBAR boost logic** (lines 1383-1390): Correctly implements the one-level boost when county LBAR share exceeds 5%.

7. **Correct conversion constant** (line 1331): `SQM_PER_SQMI = 2589988.110336` is accurate.

8. **Defensive number parsing** (lines 459-465): Handles nulls, empty strings, commas, and non-finite values.

---

## Recommendations (Priority Order)

1. **Fix TIGERweb pagination** — Highest priority. Without it, every computed metric is potentially wrong.
2. **Fix breakpoint range gaps** — Make ranges contiguous to avoid silent N/A returns.
3. **Add concurrency control** — Guard against overlapping async computations.
4. **Debounce the county FIPS input** — Prevent API spam during typing.
5. **Add a Census API key** — Free to obtain, significantly raises rate limits.
6. **Add SRI hashes** to CDN script/link tags.
7. **Wrap turf.intersect calls** in individual try/catch blocks.
