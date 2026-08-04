# Golden-value tests

A tiny, zero-dependency safety net for the app's **calculation engines**. It pins
the numeric output of the pure math functions so a future edit that silently
changes a formula fails loudly instead of shipping.

There is **no build step and no npm install**. It uses only Node's built-ins
(`node:vm`, `node:fs`) and loads the app's real `.js` files exactly as written.
It runs in the Claude Code cloud environment (Node is already present) with one
command.

## Run it

```bash
node test/run-golden.mjs            # check every case file (this is the "CI" run)
node test/run-golden.mjs ridership  # only case files matching "ridership"
node test/run-golden.mjs --update   # re-record golden values from current code
```

`--update` is the only command that writes anything. Use it **only** when you have
deliberately changed a formula, then review the golden diff before committing —
the diff *is* the record of what numbers moved.

## What it can test

The functions exposed on the browser globals (`window.App`, `window.TPI`,
`window.RidershipModel`) that are **pure** — output depends only on the arguments,
with no map, DOM, Census/LODES API, or turf geometry involved. That covers the
fragile, literature-derived math (elasticities, scenario metrics, calibration,
classification) — exactly the code where a silent numeric drift is most dangerous
and hardest to notice by eye.

It intentionally does **not** test map interaction, API fetches, or geometry
(turf) — those aren't deterministic pure math and belong in a different kind of
test.

## Add a module

1. Create `test/cases/<name>.mjs` that default-exports:

   ```js
   export default {
     scripts: ["js/projects/<module>.js"], // app files to load, in dep order
     cases: [
       { id: "short-label", call: "Namespace.fnName", args: [/* ... */] },
     ],
   };
   ```

2. Seed its golden file once: `node test/run-golden.mjs --update`.
3. Commit `test/cases/<name>.mjs` **and** `test/golden/<name>.json` together.

`scripts` are loaded in order into one sandbox, so if a module needs a helper
module loaded first (e.g. a scoring engine that reads `window.TPI` at call time),
list that file first.

## Layout

```
test/
  run-golden.mjs        the runner (sandbox loader + tolerant comparator + CLI)
  cases/                one file per module: the inputs you choose to pin
  golden/               the recorded known-good outputs (committed; regenerated with --update)
  README.md
```
