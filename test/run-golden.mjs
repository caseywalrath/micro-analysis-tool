#!/usr/bin/env node
// Golden-value test harness for the micro-analysis-tool calculation engines.
//
// WHY THIS EXISTS
//   The app has no build step: modules are plain <script> files that attach
//   their public API to browser globals (window.App, window.TPI,
//   window.RidershipModel). This harness pins the *numeric output* of the pure
//   calculation functions so a future edit (yours or an agent's) that silently
//   changes a formula fails loudly instead of shipping.
//
// HOW IT WORKS
//   1. It loads the real app .js files into a Node sandbox (node:vm) with a
//      stub `window`. No browser, no DOM, no npm install — the pure math
//      functions never touch turf/the map/the Census API, so they run as-is.
//   2. Each "case" names a function (e.g. "RidershipModel.classifyCDI") and its
//      arguments. The harness calls it and records the result.
//   3. In check mode it compares the result to the stored golden value with a
//      tiny float tolerance; a mismatch is a failure and exits non-zero.
//   4. `--update` regenerates the golden files from the current code (do this
//      ONLY when you have deliberately changed a formula and reviewed the diff).
//
// USAGE
//   node test/run-golden.mjs                 # check all case files (CI mode)
//   node test/run-golden.mjs --update        # (re)write golden files
//   node test/run-golden.mjs ridership       # only case files matching "ridership"
//
// ADD A MODULE: drop a file in test/cases/ that default-exports
//   { scripts: [<app js paths, repo-relative>], cases: [{ id, call, args }] }
// and run with --update once to seed its golden file. That's the whole workflow.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const CASES_DIR = join(HERE, "cases");
const GOLDEN_DIR = join(HERE, "golden");

// ---- float-tolerant deep comparison -------------------------------------
// Pure JS math is deterministic, so this could be exact equality; a small
// relative tolerance keeps it from being brittle if a formula is rewritten in
// an algebraically-equal but differently-rounded order.
const RTOL = 1e-9;
const ATOL = 1e-12;

function numbersEqual(a, b) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true; // covers Infinity === Infinity, exact ints, +/-0
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(ATOL, RTOL * Math.abs(b));
}

// Walk two values, collecting human-readable diffs. Path is a dotted trail.
function diff(actual, expected, path, out) {
  if (typeof expected === "number" || typeof actual === "number") {
    if (typeof actual !== "number" || typeof expected !== "number" || !numbersEqual(actual, expected)) {
      out.push(`${path || "(root)"}: expected ${fmt(expected)}, got ${fmt(actual)}`);
    }
    return;
  }
  if (expected === null || actual === null || typeof expected !== "object") {
    if (actual !== expected) out.push(`${path || "(root)"}: expected ${fmt(expected)}, got ${fmt(actual)}`);
    return;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    out.push(`${path || "(root)"}: type mismatch (array vs object)`);
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual || {})]);
  for (const k of keys) diff(actual?.[k], expected?.[k], path ? `${path}.${k}` : k, out);
}

function fmt(v) {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

// ---- JSON with non-finite number support --------------------------------
// JSON can't hold Infinity/NaN (buildScenario's cost/boarding can be Infinity),
// so encode them as sentinel strings on write and decode on read.
const encode = (_k, v) =>
  typeof v === "number" && !Number.isFinite(v)
    ? { __num__: Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity" }
    : v;
const decode = (_k, v) =>
  v && typeof v === "object" && typeof v.__num__ === "string"
    ? { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity }[v.__num__]
    : v;

// ---- sandbox loader -----------------------------------------------------
// Build one browser-ish global, run each app script into it in order, and hand
// back the populated `window`. `window` IS the sandbox global (as in a browser),
// so `window.RidershipModel = {}` and bare `Math`/`Number` both resolve.
function loadScripts(scriptPaths) {
  const sandbox = { console };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const rel of scriptPaths) {
    const abs = resolve(REPO_ROOT, rel);
    const code = readFileSync(abs, "utf8");
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox;
}

function resolveFn(win, dottedPath) {
  const parts = dottedPath.split(".");
  let obj = win;
  for (const p of parts) {
    if (obj == null) return null;
    obj = obj[p];
  }
  return typeof obj === "function" ? obj : null;
}

// ---- run one case file --------------------------------------------------
async function runCaseFile(file, { update }) {
  const mod = (await import(pathToFileURL(join(CASES_DIR, file)).href)).default;
  const name = basename(file, ".mjs");
  const goldenPath = join(GOLDEN_DIR, `${name}.json`);
  const win = loadScripts(mod.scripts);

  const results = {};
  const failures = [];
  for (const c of mod.cases) {
    const fn = resolveFn(win, c.call);
    if (!fn) {
      failures.push({ id: c.id, msgs: [`function not found: ${c.call} (script not loaded or renamed?)`] });
      continue;
    }
    try {
      results[c.id] = fn(...(c.args || []));
    } catch (e) {
      failures.push({ id: c.id, msgs: [`threw: ${e.message}`] });
    }
  }

  if (update) {
    if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, JSON.stringify(results, encode, 2) + "\n");
    return { name, updated: Object.keys(results).length, failures: [] };
  }

  if (!existsSync(goldenPath)) {
    return { name, failures: [{ id: "(golden)", msgs: [`no golden file — run: node test/run-golden.mjs --update`] }] };
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"), decode);
  for (const c of mod.cases) {
    if (!(c.id in results)) continue; // already recorded as a failure (threw / missing)
    if (!(c.id in golden)) {
      failures.push({ id: c.id, msgs: [`new case, not in golden — run --update to add it`] });
      continue;
    }
    const msgs = [];
    diff(results[c.id], golden[c.id], "", msgs);
    if (msgs.length) failures.push({ id: c.id, msgs });
  }
  const passed = mod.cases.length - failures.length;
  return { name, passed, total: mod.cases.length, failures };
}

// ---- CLI ----------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const filter = args.find((a) => !a.startsWith("-"));

  if (!existsSync(CASES_DIR)) {
    console.error(`No cases directory at ${CASES_DIR}`);
    process.exit(1);
  }
  let files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".mjs"));
  if (filter) files = files.filter((f) => f.includes(filter));
  if (files.length === 0) {
    console.error(filter ? `No case files match "${filter}".` : "No case files found.");
    process.exit(1);
  }

  let anyFail = false;
  for (const file of files) {
    const r = await runCaseFile(file, { update });
    if (update) {
      console.log(`  ~ ${r.name}: wrote ${r.updated} golden value(s)`);
      continue;
    }
    if (r.failures.length === 0) {
      console.log(`✓ ${r.name}: ${r.passed}/${r.total} passed`);
    } else {
      anyFail = true;
      console.log(`✗ ${r.name}: ${r.passed ?? 0}/${r.total ?? "?"} passed, ${r.failures.length} failed`);
      for (const f of r.failures) {
        console.log(`    ✗ ${f.id}`);
        for (const m of f.msgs) console.log(`        ${m}`);
      }
    }
  }
  if (update) {
    console.log("\nGolden files updated. Review the diff before committing.");
    return;
  }
  console.log(anyFail ? "\nFAIL" : "\nPASS");
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
