# FLM Walkshed Web App — Hosting & Development Options

**Purpose:** Outline the architecture and hosting paths for a statewide (Colorado), user-facing walkshed tool, so we can weigh them internally and present a clear set of choices to the client.

---

### The core technical constraint
- The tool must compute walksheds **on demand around any point a user uploads or clicks** — so the walkshed can't be pre-baked; it must be **computed live** from a routable street network.
- That routing capability has to live in exactly one of three places: **(a) a third-party API**, **(b) a service the client hosts**, or **(c) the user's browser.** Everything below is a variation on *where the routing lives.*
- What we loosely call "the mapping service" is really **four separable pieces**: map rendering, basemap tiles, the **routing/isochrone engine**, and the **street-network data**. Only the last two are the hard, ownership-sensitive part.

### The common base (true for every option below)
- **Front-end:** a lightweight static web app on **MapLibre GL JS** — open-source, no vendor token, no per-use billing.
- **Client-side logic:** point upload/draw, scoring, demographic joins, results tables, CSV/PDF export.
- **Data:** demographics (Census) and the street network published as **client-owned layers**, not rented from a vendor.
- Options differ **only in where the routing engine lives and who hosts it.**

---

### Option A — Third-party hosted routing API *(the current prototype's approach)*
- **Routing lives in:** a vendor API (Mapbox today; alternatives include OpenRouteService, HERE, or Esri's ready-to-use service-area service).
- **Hosting footprint:** none server-side — the app stays fully static.
- **Trade-offs:** fastest to build; vendor keeps the network data current automatically. But it carries **ongoing per-use cost, an external dependency, and data-ownership/governance questions** — the reasons we're evaluating alternatives.

### Option B — Esri / ArcGIS on the client's own stack
- **Routing lives in:** ArcGIS **Network Analyst "Service Area"** solver, published as a geoprocessing service in the client's ArcGIS Enterprise/Online environment.
- **Hosting footprint:** inside the client's existing Esri platform; their staff administer it.
- **Trade-offs:** leverages software the client likely already licenses; strong governance and full data ownership. But **heavier to deploy/configure, has license/credit considerations, and constrains a fully custom UI.** Requires confirming which ArcGIS capabilities/extensions and network data they actually have.

### Option C — Self-hosted open-source routing service on the client's infrastructure
- **Routing lives in:** an open-source engine (**Valhalla** or **OpenRouteService**) running as a **single Docker container** on client infrastructure, over OSM or client-supplied network data.
- **Hosting footprint:** one stateless container, no database, behind the client's gateway.
- **Trade-offs:** full data ownership, no per-use billing, no vendor lock-in, and the front-end calls it just like it calls Mapbox today. **Needs:** the client can host/patch a container, and someone owns periodic network-data refresh.

### Option D — Fully client-side walksheds on a pre-published static network
- **Routing lives in:** the **user's browser.** We pre-publish Colorado's walk network as **static tiled files** (PMTiles on S3/object storage); the browser fetches only the ~2 mi around the point and computes the walkshed on-device.
- **Hosting footprint:** **static hosting only** — no running routing service at all.
- **Trade-offs:** the lightest possible hosting and fully owned data. But the in-browser routing code is the **most custom piece (worth piloting before committing)**, and the network is a snapshot needing periodic re-publish. Walking is the simplest routing case (no one-ways/turn rules), which makes this feasible.

---

### Hosting & code-ownership (applies across all options)
- **Maintaining the code and hosting the running app are separable.** The firm can keep the **codebase in its own repo** (our dev workflow) while the **running app lives in the client's environment**, with a **CI/CD pipeline** deploying from repo → client host.
- **Static front-end** can sit on ordinary static storage (S3/object storage) or **GitHub Pages with a client-owned URL** via a DNS alias — great for a **staging/testing** site. Static hosting alone **cannot run** Option B's or C's engine.
- **Net:** Options A and D can run on **static hosting**; Options B and C require a **server/container host** in the client's environment.

### The statewide network data (Options C & D) and the refresh reality
- **Pipeline (offline, scriptable):** Colorado OSM extract (or the state's own network) → filter to walkable ways → build topology → tile as PMTiles → publish to object storage.
- **Scales fine for a whole state:** the browser/engine only ever touches a **local slice**, never all of Colorado — so statewide size affects the offline build, not per-query load.
- **Refresh is a real limitation, and you're right to flag it:** a hosted network is a **snapshot** — new construction, trails, and closures require a periodic rebuild. *But* this is inherent to **owning** the data (a self-hosted engine rebuilds its graph on the same cadence); only third-party APIs get "always current" for free. Walk networks change slowly, the rebuild is automatable, and outputs can be **version-stamped** ("network current as of …").

---

### How the choice narrows (and what to confirm with the client)
- **Can they host a container/VM, or is it static-hosting only?** → Container OK: Options B/C. Static-only: Options A/D.
- **Is the concern *any* external dependency, or specifically *commercial cost / a particular vendor*?** → Cost/vendor only: a non-commercial API or self-host. Any external dependency: Options C/D.
- **Do they want to leverage existing Esri investment and governance?** → Option B.
- **Do they have an authoritative statewide pedestrian/road network, or do we route on OSM?** → feeds Options B/C/D.
- **Who hosts production vs. who maintains the code?** → sets up the repo-vs-host / CI-CD split above.
