# FLM Walkshed Web App — Hosting & Architecture Options (Internal)

**Purpose:** Align internally before we meet DOT IT and finalize the Scope of Work. Covers how we can build a statewide, user-facing walkshed tool *without* an ongoing Mapbox dependency, while keeping the front-end light and matching our skillset.

---

### The one fact that drives everything
- The goal is **on-demand walksheds around any point a user uploads or clicks.** A network walkshed can't be pre-baked for unknown points — it must be *computed live*.
- Computing it requires a **routable street network + a routing calculation**. That capability has to live in exactly one of three places: **(a) a third-party API** (Mapbox — what we want to drop), **(b) a DOT-hosted service**, or **(c) the user's browser**.
- "Mapbox" is really 4 separable pieces we can swap independently: map rendering, basemap tiles, the **routing/isochrone engine**, and the street-network data. Only the engine + data are the hard part.

### What stays the same in every option (matches our prototype & skillset)
- **Front-end:** static site built on **MapLibre GL JS** (open-source, no token, no billing — already used in our other app).
- **All the light work stays client-side JS:** station upload, scoring, demographic joins, tables, CSV/PDF export.
- **Data is DOT-owned** (Census layers + street network we publish), not rented from a vendor.
- Only the **routing engine** placement changes between options below.

---

### Option 1 — Static app + one small DOT-hosted routing service *(recommended pragmatic path)*
- **Routing lives in:** a single open-source engine — **Valhalla** or **OpenRouteService** — running as one **Docker container** on DOT infrastructure.
- **IT footprint:** one stateless container, no database, behind their gateway. *Far* smaller ask than a full Esri online app.
- **Front-end calls it** exactly like it calls Mapbox today — one request in, a GeoJSON polygon out.
- **Best fit:** keeps ~95% of the app in our wheelhouse; isolates the one server-side piece into a standard, boring component. **Needs:** DOT able to host a container.

### Option 2 — Fully client-side walksheds on a pre-published state network *(lightest hosting, most novel code)*
- **Routing lives in:** the browser. We pre-publish Colorado's walk network as **static tiled files** (PMTiles on S3/OTIS); the browser fetches only the ~2 mi around the point and computes the walkshed on-device.
- **IT footprint:** **static hosting only** — no running service at all. Walking is the easy routing case (no one-ways/turn rules), so this is feasible.
- **Trade-offs:** the client-side isochrone code is the most custom piece (**pilot before committing**); the network is a snapshot that needs **periodic re-publishing** (see below).
- **Best fit:** DOT can only do static hosting, or wants zero live services.

### Option 3 — Non-Mapbox routing API with a self-hosting escape hatch
- **Routing lives in:** **OpenRouteService's** hosted API now, with the option for DOT to **self-host the identical service** later — same code either way.
- **Best fit:** only if DOT's objection is specifically *Mapbox/commercial cost*, not *external services in general*. Turns lock-in into a deployment-timing choice.

### Why not Esri/ArcGIS
- The walkshed math worked on a workstation before, but **publishing it as an online service in the client's stack failed** — the risk is the *deployment layer*, which any server-side option shares.
- Esri server-publishing is GUI/enterprise-config work that **agentic coding does not help with**; our OSS/REST options are squarely AI-codeable. (Still worth *asking* what blocked the prior attempt — it informs Options 1 & 3 too.)

---

### How "we host it" can work (code ownership vs. running site)
- **We maintain the codebase** in our GitHub repo — our dev + agent-coding workflow. Keep this.
- **Production runs in DOT's environment.** A **CI/CD pipeline** auto-deploys the static site (and container) from our repo into DOT hosting. Firm maintains; DOT owns/hosts — satisfies the SOW's "DOT-hosted" + handoff language.
- **GitHub Pages + a client-owned URL** (DNS CNAME alias) is real and great for the **staging/testing** site during development — but it serves **static files only** (can't run Option 1's engine) and firm-hosted infra likely won't fly for a public *production* gov service.

### The statewide network data (only if Option 2), and the refresh reality
- **Inputs:** Colorado OSM extract (or CDOT's network) → filter to walkable ways → build topology → tile as PMTiles → publish to S3/OTIS. Scriptable, offline, AI-codeable.
- **Scale is fine:** the browser only ever loads a local slice, never the whole state.
- **Yes — it's a snapshot that needs periodic rebuild** (new construction, trails, closures). *But:* this is inherent to **owning** the network — a self-hosted engine (Option 1) rebuilds its graph on the same cadence. Only third-party APIs get "always current" for free. Walk networks change slowly; annual/semi-annual refresh is plenty; automate it and version-stamp outputs.

---

### The single most important SOW move
- Redefine Task 2's "hello world" proof-of-deployment as: **"stand up on-demand isochrone compute in DOT's environment and return one walkshed."** That's the mandatory, previously-failed piece — prove it **before** the contract locks scope.

### Questions to settle with DOT IT
- Can you host a **single container / small VM**, or is it **static hosting only**? (Decides Option 1 vs. 2.)
- Is the concern **external services in general**, or specifically **Mapbox/commercial cost**? (Opens Option 3.)
- Do you have an **authoritative statewide pedestrian/road network**, or should we route on OSM?
- **What specifically blocked** the prior ArcGIS online deployment — licensing, permissions, server, or network?
- Will the production app run in **your environment**, with us maintaining the code and deploying via pipeline?
