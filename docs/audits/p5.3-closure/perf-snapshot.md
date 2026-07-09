# Transit web — Performance Snapshot

Build: `cd apps/web && bun run build` → **exit 0** (clean). vite v7.3.5, SvelteKit adapter-cloudflare, 2557 client modules transformed. Analysis is from `.svelte-kit/output/client/_app/immutable`, the vite manifest (`.svelte-kit/output/client/.vite/manifest.json`), the SvelteKit server node→route map, and real edge payload sizes from `https://transit.yesid.dev/data/v1/stm/*`.

Build config that matters:
- `apps/web/vite.config.ts:10-15` — `mapRuntimeManualChunks` forces `maplibre-gl`+`pmtiles` into a single `vendor-maplibre` manual chunk.
- `apps/web/vite.config.ts:84-90` — `rollup-plugin-visualizer` emits `dist/stats.html` (treemap, gzip+brotli). Note: it writes to `dist/`, but the SvelteKit adapter output is `.svelte-kit/output` — `dist/stats.html` is still produced by the client build for manual inspection.
- `apps/web/svelte.config.js:25` — adapter-cloudflare, no prerender dir emitted → every page is SSR'd at the edge (confirmed: no `.svelte-kit/output/prerendered`).

Two build warnings (non-blocking):
1. layerchart imports unused `curveLinear` from d3-shape (upstream lib noise).
2. `src/lib/features/metrics/easterWordHover.ts` is BOTH statically imported (by `EasterProse.svelte`) and dynamically imported (by `MetricsExplainer.svelte:409`) → the dynamic import cannot split it out; it collapses into the static chunk. Minor; metrics-only.

---

## 1. Bundle stats (client)

### Totals
- **Total client JS: 2.86 MB raw / ~915 KB gzip** across 123 `.js` files.
- **Total client CSS: 384.4 KB raw** across 37 `.css` files (~62 KB gzip summed).
- No single page loads all of it — code is route-split. See §3 for the honest per-route transfer.

### Top 15 JS chunks by raw size (raw / gzip)
| # | raw B | gzip B | file | contents |
|---|------|--------|------|----------|
| 1 | 1,073,808 | 290,862 | `chunks/GT7eMBaw.js` | **maplibre-gl + pmtiles** (`vendor-maplibre`) — 141 "maplibre" hits |
| 2 | 390,712 | 115,498 | `chunks/CznogO9v.js` | **LayerChart + d3** (Voronoi/delaunay) — the chart library core |
| 3 | 122,809 | 35,730 | `chunks/CfO-v7S_.js` | **Zod** runtime validator — 334 "zod" hits (see §2, biggest baseline item) |
| 4 | 117,890 | 35,242 | `nodes/9.CaQeZPa1.js` | **/map** route node |
| 5 | 115,520 | 35,973 | `nodes/8.B81BzoMq.js` | **/lines/[id]** (line detail) route node |
| 6 | 109,543 | 35,568 | `chunks/DE4cQw7p.js` | shared feature/selector chunk |
| 7 | 81,467 | 23,097 | `chunks/CTZZMxSz.js` | **Svelte 5 runtime + bits-ui** — 73 "svelte" hits, Dialog |
| 8 | 77,260 | 30,443 | `chunks/Mf-Sd6cp.js` | **gsap** core — 32 "gsap" hits |
| 9 | 67,322 | 19,654 | `chunks/8i4lS7xa.js` | shared chunk |
| 10 | 57,218 | 18,337 | `nodes/4.PewREsje.js` | **/_kit** debug/kitchen-sink route node |
| 11 | 48,832 | 18,186 | `chunks/C5j7gyMq.js` | **d3-delaunay** (Voronoi, chart dep) — 29 "delaunay" |
| 12 | 45,454 | 18,822 | `chunks/Cc-3Emss.js` | **gsap SplitText** plugin — 26 "gsap", 2 "SplitText" |
| 13 | 44,965 | 14,304 | `nodes/16.BdVrUW3w.js` | **/stop/[id]** route node |
| 14 | 36,352 | 12,381 | `chunks/DnVz4FYY.js` | baseline shared chunk |
| 15 | 35,184 | 13,471 | `chunks/NR1es0Rh.js` | baseline shared chunk (svelte) |

### Node → route map (from `.svelte-kit/output/server/nodes/N.js`)
| node | route |
|------|-------|
| 0 | root `+layout.svelte` (always loaded) |
| 1 | error/fallback | 2 | error/fallback |
| 3 | **home** `/` |
| 4 | `/_kit` (dev kitchen-sink — should not ship to prod nav) |
| 5 | `/alerts` | 6 | `/hotspots` |
| 7 | **/lines** index | 8 | **/lines/[id]** detail |
| 9 | **/map** | 10 | **/metrics** |
| 11 | **/network** | 12 | `/receipt` |
| 13 | `/repeat-offenders` | 14 | `/search` |
| 15 | `/status` | 16 | **/stop/[id]** |
| 17 | `/stops` | 18 | `/trip/[id]` |

---

## 2. Where the heavy libraries land

### maplibre-gl + pmtiles → `chunks/GT7eMBaw.js` (1.07 MB / 291 KB gz)
- **Only referenced by `nodes/9.CaQeZPa1.js` (the /map route)** — verified with `grep -rl GT7eMBaw` across all immutable output: exactly one hit.
- Even on /map the reference is **dynamic**: `nodes/9` contains `await import("../chunks/GT7eMBaw.js").then(...)`. Source: `src/lib/components/map/MapStage.svelte:178` `const maplibregl = (await import('maplibre-gl')).default;` and `:39` `const { Protocol } = await import('pmtiles');`. Every other file references maplibre **type-only** (`import type { Map as MapLibreMap }`), which is erased at compile time.
- maplibre-gl CSS (`assets/maplibre-gl.DNVN2dqC.css`, 70 KB / 10 KB gz) is likewise attached only to `nodes/9`.
- **Verdict: NO map leak.** maplibre/pmtiles never enter the baseline nor any non-map route, and are not even eagerly loaded on /map until the map component mounts client-side.

### LayerChart + d3 → `chunks/CznogO9v.js` (391 KB / 115 KB gz)
- Statically imported by the chart-bearing route nodes: **nodes 4 (_kit), 6 (hotspots), 8 (line detail), 11 (network), 13 (repeat-offenders), 16 (stop detail)** plus intermediate feature chunks (`C5j7gyMq` delaunay, `C0Kn8cjU`, `DlgdKEb3`, `DWFBFgVP`, `CTWe1tTb`, `Cun-bBhn`, `DJfIZKl4`, `BApUpLZz`).
- It appears in `entry/app.BnF1c-qb.js` **only inside the `__vite__mapDeps` string array** (a dependency lookup table for lazy chunks), NOT as a top-level `import` — confirmed `head -c 4000 entry/app | grep 'import...CznogO9v'` returns nothing. So the chart core is **NOT in the baseline**; it is pulled per-route by the chart routes.
- The chart mark components under `src/lib/components/dataviz/chart/marks/*.svelte` all statically `import { Chart as LcChart, ... } from 'layerchart'` and `from 'd3-scale' / 'd3-shape'`. Because feature *sections* (e.g. `src/lib/features/network/reliability/sections/SectionTrend.svelte`) statically import these marks, the whole chart core loads as part of those routes' closures — it is not lazy within a chart route, but it IS cleanly excluded from non-chart routes.
- Chart routes therefore pay ~115 KB gz for the chart engine on top of baseline (visible in §3 as the +190-230 KB gz jump on lineDetail/network/stopDetail — chart core + that route's own chart marks + selectors).

### Zod → `chunks/CfO-v7S_.js` (123 KB / 36 KB gz) — **IN THE BASELINE, every page**
- This is the single largest fixable win. The runtime Zod schemas (`src/lib/v1/schemas/*.ts`, 3247 total lines) compile into a 123 KB chunk that is part of the root-layout closure, so it downloads on the home page, the map, everywhere.
- The only *manifest*-boot parse is `src/lib/v1/repositories/manifest.ts:47` `ManifestSchema.parse(...)` (a 1.6 KB doc). Yet the full schema barrel (network, stop, route, alert_history, hotspots, receipts, stop_daily, etc.) is tree-linked into the baseline. Opportunity: lazy-load per-tier schemas with their repositories, or drop client-side re-validation of the SSR-embedded manifest (it was already validated server-side in `+layout.server.ts`).

### gsap + SplitText → `chunks/Mf-Sd6cp.js` (77 KB) + `chunks/Cc-3Emss.js` (45 KB)
- **Only referenced by `nodes/10` (/metrics)** — verified via `grep -rl 'Mf-Sd6cp\|Cc-3Emss' nodes/`.
- Loaded via `await import('$lib/motion/utils/gsap')` in `src/lib/features/metrics/easterWordHover.ts:84` (a metrics easter-egg hover effect). Not in baseline, not on home. Well contained.

### Svelte 5 runtime + bits-ui → `chunks/CTZZMxSz.js` (81 KB / 23 KB gz)
- In the baseline (unavoidable framework runtime + the UI primitives used in the shell/nav).

---

## 3. Honest per-route transfer (static import closure incl. root layout + entry)

Computed from the vite manifest by walking each node's `imports` closure ∪ the layout closure ∪ the app entry. Sizes are the summed `.js` files (raw / gzip). "+over base" is gzip cost above the shared baseline.

**BASELINE (root layout + entry, downloaded on EVERY page): 411 KB raw / 138 KB gz.**
Baseline is dominated by: Zod 36 KB gz, Svelte+bits-ui 23 KB gz, plus shared selector/format chunks. Global CSS `assets/0.DUjp3qHF.css` (86 KB / 14.6 KB gz) rides along on every page too.

| route | static JS files | raw KB | gzip KB | +over base gz | chart core | maplibre |
|-------|-----------------|--------|---------|---------------|-----------|----------|
| **home** `/` | 55 | 587 | **202** | +63 | no | no |
| **map** | 53 | 558 | **186** | +48 | no | dynamic-only (not counted; +291 KB gz on map mount) |
| **lines** index | 60 | 466 | **161** | +23 | no | no |
| **line detail** `/lines/[id]` | 79 | 1131 | **370** | +231 | yes | no |
| **metrics** | 55 | 608 | **208** | +70 | no | no (gsap is dynamic, +30 KB gz on hover) |
| **network** | 75 | 1015 | **331** | +193 | yes | no |
| **stop detail** `/stop/[id]` | 79 | 1045 | **343** | +204 | yes | no |

Reading:
- **home ships 202 KB gz of JS** before any data — heavy for a landing page whose hero is largely static. The +63 KB over baseline is home-specific feature code (KPI tiles, hero motion). Baseline Zod (36 KB gz) is the biggest slice of it.
- **chart routes (line detail 370, stopDetail 343, network 331 KB gz)** are the heaviest — the +190-230 KB gz is chart core (115 gz) + that route's marks + reliability selectors. These are the pages to watch for TBT/hydration.
- **map is deceptively light at 186 KB gz static** — but on mount it *dynamically* pulls maplibre JS (291 KB gz) + maplibre CSS (10 KB gz) + live/trips + stops_index data (see §4). Real map TTI transfer is ~500 KB+ gz once the canvas boots. It is correctly deferred so it does not block the shell paint.

---

## 4. Data payload sizes (real edge, `transit.yesid.dev/data/v1/stm/`)

The v1 manifest (`manifest.json`) is **1.6 KB** and is SSR-embedded via `+layout.server.ts` over the `DATA` service binding → first paint ships real manifest data with no client round-trip. Per-tier data files are fetched client-side, lazily, via repositories + `createResource` (not in blocking load functions).

| file | raw | encoded (br/gzip) | route(s) |
|------|-----|-------------------|----------|
| `manifest.json` | 1.6 KB | 0.9 KB | all (SSR-embedded) |
| `labels/fr.json` | 2.3 KB | 1.1 KB | all (i18n) |
| `historic/network_trend.json` | 13.2 KB | 2.5 KB | network, home |
| `historic/hotspots.json` | **157 KB** | 18 KB | hotspots |
| `historic/repeat_offenders.json` | 6.3 KB | 1.0 KB | repeat-offenders |
| `historic/alert_history.json` | 51 KB | 5.2 KB | alerts |
| `static/routes_index.json` | 22 KB | 3.3 KB | lines, stops, search |
| `static/stops_index.json` | **1.15 MB** | **177 KB** | stops index, map, search |
| `historic/route_reliability/[id].json` | ~80-91 KB | ~11.8 KB | line detail |
| `live/vehicles.json` | 21 KB | 2.6 KB | map (polled 30s) |
| `live/trips.json` | **289 KB** | 30 KB | map (polled 30s) |

Data risks:
- **`stops_index.json` = 1.15 MB raw / 177 KB encoded** is the single largest client payload on the site. It loads on `/stops`, `/search`, and the `/map` (MapHero pulls the stop catalogue). It is fetched lazily via `createResource(() => getStopsIndex())` (`src/lib/features/stops/StopsIndex.svelte:68`), so it does not block first paint — but on /search and /stops it gates interactivity, and on the map it is one of several large concurrent fetches. 177 KB encoded to parse into JS objects is a real main-thread cost (JSON.parse of 1.15 MB) → TBT/INP risk on mid-tier phones.
- **`live/trips.json` = 289 KB raw / 30 KB encoded, re-fetched every 30 s** on /map. Combined with maplibre boot this makes /map the heaviest surface. Polling a 289 KB doc every 30s is bandwidth-heavy for a long-lived tab.
- **`hotspots.json` 157 KB raw** and **line detail `route_reliability/[id].json` ~85 KB raw** are moderate; both encode well (18 KB / 12 KB).

---

## 5. Web-vitals risk review (key routes)

### Fonts — LOW risk, well handled
- Self-hosted variable woff2 via pinned copies under `/fonts/` (`src/lib/styles/fonts.css`), latin+latin-ext subsets only (dropped cyrillic/greek/vietnamese/etc.).
- `app.html:41-56` preloads the two LCP-path woff2 (`inter-latin-wght-normal.woff2` 48 KB, `jetbrains-mono-latin-wght-normal.woff2` 40 KB) with `crossorigin`, and the @font-face `src` URLs match the preload exactly (so the preload actually warms the request).
- `font-display: swap` on all four @font-face (`fonts.css:30,42,57,71`). Swap ⇒ **FOUT, not FOIT** — text is visible immediately, minor reflow when the webfont swaps in. Given Inter metrics are close to system sans, CLS from swap is small but nonzero; there is no `size-adjust`/fallback-metric override to eliminate it.
- Font file weights: inter-latin 48 KB, inter-latin-ext 85 KB, jetbrains-mono-latin 40 KB, jetbrains-mono-latin-ext 15 KB. Only the two latin ones are preloaded; latin-ext loads on demand (FR accents).

### Render-blocking / first paint — LOW-MEDIUM
- `app.html:9-20` inline synchronous theme-resolution script (pre-CSSOM) — tiny, avoids theme flash. Good.
- `app.html:33-35` `preconnect` + `dns-prefetch` to `protomaps.github.io` (maplibre glyph host) on EVERY page, even non-map pages — a wasted connection warmup on home/lines/etc. Minor.
- Global CSS `assets/0.DUjp3qHF.css` **86 KB raw / 14.6 KB gz** is render-blocking on every page (it is the `<link>`ed stylesheet for node 0). Large-ish but gzips well.
- `+layout.svelte:31-32` imports `fonts.css` then `app.css` as side-effects — bundled, not extra requests.
- No blocking third-party scripts. Vitals (`startVitals`, `+layout.svelte:297`) is onMount + dynamic `web-vitals` import + `sendBeacon` on unload → never blocks (`src/lib/vitals/collect.ts:17-91`).

### CLS sources — LOW-MEDIUM
- Shell chrome has explicit dimensions: 44px tap targets, fixed `--left-rail-tile-size`, fixed topbar heights (`src/lib/components/shell/*.svelte`). Sticky chrome is sized up-front → low CLS from nav.
- **Charts are the main CLS suspect**: LayerChart marks render into SVG that sizes to its container; if the chart container has no reserved height, the chart popping in after hydration + data resolve will shift content on line detail / network / stop detail. Needs verification in-browser (reserve min-height on chart wrappers).
- **`createResource` lazy data** (stops index, route reliability, hotspots): content renders an absence/skeleton state first, then swaps in real content when the fetch resolves. If skeletons are not the same height as the resolved content, this is a CLS source on stops/search/line-detail. The unknown-data layer (AbsentValue) suggests skeletons exist; height-parity needs a browser check.
- Font swap (FOUT) contributes a small CLS as noted.

### Hydration weight — MEDIUM on chart routes
- home 202 / metrics 208 KB gz hydrate a mostly-static shell → moderate TBT.
- **line detail 370 / stop detail 343 / network 331 KB gz** hydrate the chart engine + many mark components + selectors. These are the TBT/INP hot spots. The chart core (115 KB gz) parse+hydrate on a mid phone is the dominant cost.
- map: light static shell (186 KB gz) hydrates fast; the expensive maplibre init is deferred to `onMount` and runs off the critical hydration path.

### LCP
- home/lines/metrics LCP is text/tiles → gated by font swap + baseline JS hydration; should be fast.
- map LCP is the canvas → gated by maplibre dynamic import + basemap tiles (external protomaps host, hence the preconnect). Slowest LCP surface by design.
- line/stop/network LCP likely a chart or headline number → gated by chart-core hydration + `route_reliability/[id].json` (12 KB enc) or network_trend (2.5 KB enc) fetch.

---

## 6. Prioritized opportunities (biggest → smallest)

1. **Zod out of the baseline (36 KB gz on every page).** Lazy-load per-tier schemas with their repositories; consider skipping client re-validation of the SSR-embedded manifest (already validated in `+layout.server.ts`). Highest-leverage single change; directly cuts home/all-route JS.
2. **`stops_index.json` 1.15 MB / 177 KB enc.** Biggest data payload; loads on stops/search/map. Consider server-side search API, pagination, or a slimmer index (id+name+code only) with the full record fetched per-stop. JSON.parse of 1.15 MB is a real TBT hit.
3. **`live/trips.json` 289 KB polled every 30s on /map.** Consider a delta/etag-conditional fetch or a slimmer live trips payload.
4. **Chart routes 331-370 KB gz.** Chart core (115 KB gz) is unavoidable where charts are shown, but verify each chart wrapper reserves height (CLS) and consider deferring below-the-fold chart sections until scrolled into view.
5. **`/_kit` route (node 4, 57 KB) ships to production** — a kitchen-sink/debug route in the built output. Confirm it is nav-excluded / robots-blocked or drop it from the prod build.
6. **`preconnect` to protomaps.github.io on non-map pages** (`app.html:33`) — scope it to the map route to avoid a wasted connection on home/lines/etc.
7. **Font swap CLS** — add `size-adjust`/ascent-override fallback metrics or an adjusted fallback stack to zero out the swap reflow.

---

## Verdicts
- **Build:** succeeds clean (exit 0), 2 benign warnings.
- **Total client JS:** 2.86 MB raw / ~915 KB gz across 123 files (route-split; no page loads all).
- **Top 3 chunks:** maplibre+pmtiles 291 KB gz, LayerChart+d3 115 KB gz, Zod 36 KB gz.
- **Map-leak:** CLEAN — maplibre/pmtiles are in one `vendor-maplibre` chunk referenced ONLY by the /map node, and even there only via `await import()`. Zero leak into baseline or any non-map route. gsap similarly confined to /metrics (dynamic).
- **Baseline (every page):** 411 KB raw / 138 KB gz JS + 86 KB (14.6 gz) global CSS — Zod is the biggest removable slice.
- **Biggest web-vitals risks:** (1) `stops_index.json` 1.15 MB parse on stops/search/map (TBT/INP); (2) chart routes' 331-370 KB gz hydration + likely un-reserved chart heights (TBT + CLS); (3) Zod 36 KB gz + global JS on the home baseline gating home LCP/hydration.
