# Transit prod browser pass — 390px mobile + desktop skim

**Date:** 2026-07-03
**Target:** https://transit.yesid.dev (prod)
**Primary viewport:** 390px CSS width (mobile)
**Desktop skim:** 1440px

## Methodology / important caveat

`resize_window` on this environment is a **no-op**: the tool reports success but the browser window frame does not move (`outerWidth` stayed 2014, `innerWidth` stayed 2007 at DPR 1.25 no matter what size was requested — window is maximized and the WM refuses the resize). Desktop `computer` screenshots therefore always show the ~1512px desktop layout.

To get a **true 390px responsive layout** I injected a same-origin **iframe harness** into the prod page: a `<iframe width=390>` pointed at each surface's URL. Media queries inside the iframe respond to the iframe's own width (`innerWidth` = 387 after scrollbar), so the genuine mobile breakpoint layout renders and hydrates. Because it is same-origin I introspect the iframe document directly for:
- **overflow check** — `iframe.contentDocument.scrollingElement.scrollWidth` vs `iframe.contentWindow.innerWidth` (387).
- **tap-target audit** — every interactive control (`a,button,[role=button|tab|link|switch],input,select,textarea,summary,[tabindex>=0]`), flagging any with `getBoundingClientRect` width OR height < 44px (visible, non-hidden only; deduped).
- **overflow offenders** — non-fixed elements whose right edge > innerWidth+1.

Screenshots capture the iframe rendered in the top-left 390px column of the desktop page (magenta border), which shows the real mobile layout. This is a sound method; the only thing it can't reproduce is the mobile browser's own URL bar / native scroll chrome, which is irrelevant to layout QA.

### Tap-target severity classes (used throughout)
Sub-44px controls recur in three consistent buckets. I score them by severity:
- **P1 (real):** primary in-body controls that are the main way to act (info "ⓘ" buttons at 17×17, icon-only toggles, chart controls, close buttons).
- **P2 (chrome):** top-bar icon buttons rendered at 36×36 (search/refresh/alerts/theme/menu). Consistent across every surface; 36px is under 44 but they have generous spacing. One shared fix.
- **P3 (footer/inline text links):** footer nav + inline prose links ~23px tall. Standard text-link affordance; low priority, present site-wide via the shared footer.

Counts below report **per-surface total** and the **P1 (real) subset**, since P2/P3 are the same shared components on every page.

---

## Surface: home — `/`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387 = innerWidth 387. 0 offenders.
- **Layout:** Clean mobile stack. Top bar collapses to logo + icon row (search/refresh/alerts/theme/lang/hamburger). KPI "network.control-room" card stacks the 4 KPIs vertically (ON-TIME 90% / VEHICLES 83 / NOT REPORTING 7 / COVERAGE 86%). Hero heading wraps cleanly. "What this is" cards stack.
- **Tap targets:** 26 total. P1 real = the four **"About X" info buttons at 17×17** (top ~563–769) — genuinely tiny, hard to hit. P2 = 8 chrome icons at 36×36. P3 = footer nav links (~23px tall) + "∑ How we measure" inline link (142×23).
- **Sticky/chrome:** top bar behaves; hamburger menu present.
- **Charts:** n/a on home (KPI tiles only), legible.

---

## Surface: map — `/map`

- **Verdict:** OK
- **Overflow:** document overflowX = 0 (scrollWidth 387). **1 clipped offender:** `span.transit-basemap-thanks` ("🧡", left 484 / right 500) — the attribution line "Big thanks to © OpenStreetMap contributors 🧡" runs past the 390 edge but is clipped inside the collapsible attribution, so it does NOT scroll the document. Cosmetic only.
- **Layout:** Full-bleed live map. Overlays laid out correctly for mobile: "NETWORK · LIVE / Live map" header top-left, "CONTROLS 0 ▸" collapsed pill bottom-left, orange "Stops near me" locate button bottom-right, attribution bottom. The map-overlay-law (full-bleed canvas, draggable/collapsible overlays) holds at 390px.
- **Map canvas:** sized **387×757** (properly sized). The canvas rendered dark/blank in the iframe — this is the **known GL-compositing artifact** (memory: "/map blank-until-resize is an artifact", canvas sized + no code bug), amplified by WebGL-in-iframe. NOT a layout defect. Should be re-confirmed on a real device where compositing is reliable.
- **Tap targets:** 9 total. Overlay primary controls are correctly sized — **"Stops near me" 44×44**, **"Controls" toggle 179×45** (both meet minimum, good). Only sub-minimum in-body control: **"Toggle attribution" summary 24×24** (P1 minor — secondary control).
- **Sticky/chrome:** map overlays float over canvas, do not resize it. Good.

---

## Surface: lines index — `/lines`

- **Verdict:** OK (1 recurring minor tap issue)
- **Overflow:** none — scrollWidth 387 = innerWidth. 0 offenders.
- **Layout:** Clean stack. Title "Lines.", description, then a "CONTROLS" panel: FILTER LINES text input, SORT toggle (Alphabetical / Least reliable), RELIABILITY toggle (All / Late), then ~200 line rows. Each row = radio + line number + "Ligne N - X" name + a small "Map" chip.
- **Tap targets:** 221 total, but this decomposes to ONE real component issue repeated: the **primary row link is 259×73 (good)**, but the secondary **"View route N on map" chip is 46×32 — height 32 < 44, ×200 rows** (P1-minor, secondary action). The remaining ~21 are the shared footer (P3, ~23px) + 8 chrome icons (P2, 36px). Filter/sort toggle buttons are adequately sized.
- **Charts:** none (list).
- **Sticky/chrome:** fine.
- **Note:** raising the per-row map chip to ≥44px tall would clear 200 of the site's tap violations in one component change.

---

## Surface: line detail — `/lines/24` (busy bus line)

- **Verdict:** OK
- **Overflow (Detail tab):** none — scrollWidth 387, 0 offenders.
- **Overflow (Reliability tab):** document overflowX = **0** (no page scroll). My raw detector flagged 219 elements, but **218 are `table.sr-only` a11y tables + their th/caption** (visually hidden, width 2460 — intentional screen-reader content, false positives). After excluding sr-only there is exactly **1 visible wide element: the repeat-problem/crowding heatmap `.chart-frame.dv-heatmap-cells` (width 432 > 387)** — and it is correctly wrapped in a **`dv-scrollframe__scroller`** (scrollWidth 432 > clientWidth 265, canScroll true). So the wide heatmap scrolls inside its own overflow container exactly as spec requires. NOT a bug. (This is the "ScrollFrame" from memory, working.)
- **Layout:** Breadcrumb HOME > LINES > 24, "< LINES" back, "LINE 24." heading, "View on map" chip, tab bar (Detail / Schedule / Reliability), SERVICE ALERTS cards on Detail. Reliability tab renders the 4-section reliability cluster: insight prose ("repeat delays peak on Monday… calmest day"), the day×hour heatmap, methodology notes, section-nav pills ("When to ride 2/5 ▸").
- **Charts at 390px:** heatmap legible — 7 day rows × hourly cols, x-axis "Hour of day" ticks 0:00/03:00/06:00/09:00/12:00/15:00…, a visible horizontal scrollbar under it. Legend "Rarely late / Sometimes late / Often late / Very unreliable ◆ / No data" reads clearly with color+glyph per Chart Doctrine. No label collisions, no clipped legend.
- **Tap targets:** 29 (Detail). Sub-44 in-body: breadcrumb "Home" 36×20, "View route 24 on map" 108×**32**, tab buttons Detail/Schedule/Reliability at **41px tall** (marginally under 44), "+3 more" 63×**23**. Section-nav pills are well-sized (203×45, 179×45). All P1-minor (tabs at 41 are close).
- **Sticky/chrome:** section-nav ToC pill is `sticky` and briefly overlaps prose while scrolling — normal sticky behavior, not a defect.

---

## Surface: stops index — `/stops`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** Search-first surface. "Stops. // SEARCH", CONTROLS panel: SEARCH STOPS input ("Stop name or code…"), FILTER BY LINE combobox, SORT toggle (Route order / Least reliable), empty state "Start typing to filter stops." Honest empty-state, clean stack.
- **Tap targets:** 23. In-body sub-44: "Filter by line" input **311×39** + its inner clear/icon button **28×28** (P1-minor). Rest = footer (P3) + chrome (P2). Sort toggle buttons adequately sized.
- **Charts:** none.
- **Sticky/chrome:** fine.

---

## Surface: stop detail — `/stop/51234` (ARRÊT 51234 · Crémazie / De Lorimier, real entity)

- **Verdict:** ISSUES (tab strip clipped)
- **Overflow:** document overflowX = 0, BUT **1 real visible offender: the last station tab "Reliability" (`.station-tab`, width 131) right-edge = 399 vs viewport 387 — clipped ~12px.**
- **⚠️ REAL ISSUE — tab strip clips at 390px:** the tab strip (`.group/tabs-list`, Next / Schedule / Info / Reliability) has total content width **383px in a 345px container with `overflow-x: visible`** (scrollWidth 383 > clientWidth 345, no scroll). The 4th tab **"Reliability" renders truncated as "Reliabilit"** with the final "y" cut off at the viewport edge (confirmed visually). No horizontal-scroll affordance to reveal it. This tab strip needs `overflow-x: auto` (like the line-detail ScrollFrame) or shorter labels / wrap at narrow widths.
- **Layout otherwise clean:** breadcrumb HOME > STOPS > 51234, "STOP · ARRÊT 51234 · CRÉMAZIE / DE LORIMIER", "View on map" chip, NEXT DEPARTURES with honest empty state "Nothing to show — No data has been published for this view yet."
- **Tap targets:** 29. Station tabs are **41px tall** (under 44) and the last one is also clipped. "View on map" chip fine.
- **Charts:** none surfaced in Next tab (empty state).

---

## Surface: network — `/network`

- **Verdict:** OK (one minor chart-label nit)
- **Overflow:** document overflowX = 0. 4 raw offenders are all **LayerChart internal SVG `<g>`/`<rect>` (transparent hover-catcher layers) drawn to right 402 past a 320px-wide SVG whose parent is `overflow: visible`** — invisible transparent overlays, not visible content, no document scroll. Not a defect.
- **Layout:** "Network health.", desc, LIVE/FEED freshness line ("FEED COMPLIANT"), LIVE NOW KPI tiles (ON-TIME 84% / COVERAGE 81% / MEDIAN DELAY 0 min), CROWDING stacked bar, DELAY DISTRIBUTION histogram, HISTORIC TREND with VIEW (Day/Week/Month) + (7d/30d/90d) toggles. Everything stacks cleanly.
- **Charts at 390px:** SVGs sized 311×144 (fit viewport). CROWDING legend "Many seats 88% / Few seats 11% / Standing 1%" legible (color dots). DELAY DISTRIBUTION histogram legible; **minor nit: the -1 / 0 / 1 x-axis tick labels collide around zero** (tick x-positions 73/85/93, ~8–12px apart → labels nearly touch "-1O1"). Readable but cramped. All other ticks (-5, 5, 10, 30) well spaced. HISTORIC TREND toggles well-sized (Day 50×?, 7d/30d/90d).
- **Tap targets:** 44. In-body: KPI info ⓘ buttons (17×17, P1-minor, recurring pattern), rest footer/chrome. Trend toggles OK.
- **Sticky/chrome:** fine.

---

## Surface: metrics — `/metrics` (nested +layout, collapsible ToC)

- **Verdict:** OK
- **Overflow:** document overflowX = 0. Raw detector flagged 445 elements, but **ALL are SQL code-block tokens (`.codeblock__code`, `.tok--*`) inside `<pre>` with `overflow-x: auto` (scrollWidth 828 > clientWidth 290, canScroll true)** — code scrolls inside its own frame, spec-compliant. **0 non-code offenders.** Clean.
- **Layout:** "How we measure. // PROXY, NOT CERTIFIED OTP", intro prose, "Focus" + "Remember" buttons (the Focus/ToC quiet contract from memory), then default-closed metric sections with "Provenance (applies to every… 1/17 ▸" section-nav pills (default-closed + hash-opener pattern). Everything stacks; the S10 mobile parity work shows.
- **Tap targets:** 22. "Back to top" link 100×20 (P3 inline). "Focus"/"Remember" ~40px tall. Rest footer/chrome. No new P1.
- **Charts:** SQL code blocks legible and scrollable. No dataviz charts on this surface.
- **Sticky/chrome:** section pills fine.

---

## Surface: status / data-health — `/status`

- **Verdict:** OK
- **Overflow:** none at top AND mid-page (pipeline lanes) — scrollWidth 387, 0 offenders throughout.
- **Layout:** "Data health. // PROVENANCE", prose, "AS OF · UPDATED Jun 29, 08:00 p.m. EDT", "FEED FRESHNESS" list ("gis_static · LOADED · 1 hour ago"), pipeline lanes + build accountability (S11). All stacks cleanly; feed rows fit 390px.
- **Tap targets:** 21 (mostly chrome + footer). No new P1.
- **Charts:** status lanes/rows, no wide dataviz. Legible.
- **Sticky/chrome:** fine.

---

## Surface: hotspots — `/hotspots`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** "Hotspots. // WORST FIRST", desc, "UPDATED Jul 1, 08:00 p.m. EDT", VIEW toggle (Day/Week/Month) + "Peak hours", Line/Stop tab toggle, "WORST SPOTS · 10/180" + top-N selector (5/10/20/30/50/ALL), then ranked entity rows. Clean stack.
- **Tap targets:** 38. Line/Stop tabs **41px tall**; "About Severe-delay rate" ⓘ 17×17; top-N "**5**" button **35×44** (width 35 < 44 — others 44×44 ✓); ranked-row entity links (René-Lévesque, Des Sources / YUL Aéroport…) are **18px-tall text links** — these are primary list-nav targets so the 18px height is a P1-minor tap concern (whole row may be tappable though). 
- **Charts:** ranked rows with severity bars; legible at 390px.
- **Sticky/chrome:** fine.
- **Confirmed:** ranked-row link is `inline`, 18px tall, in a 23px row — tappable area ~18–23px, NOT a full 44px row target (real P1-minor).

---

## Surface: receipt — `/receipt`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** "Accountability receipt. // RECEIPT", desc, "UPDATED Jul 1", DAY selector ("Receipt day: Jul 2" `<select>`), then "service-receipt DAILY / THE RECEIPT" card with headline reliability + worst-of-day metrics. Windowed AlertHistory-driven (S15). Clean stack, date `<select>` well-sized.
- **Tap targets:** 28. All in-body sub-44 are the recurring **"About X" info ⓘ buttons at 17×17** (7 of them: The receipt, On-time, Average delay, Severe delays, Rider impact, Affected on the day, Worst of the day). Same shared component pattern.
- **Charts:** metric tiles, legible.
- **Sticky/chrome:** fine.

---

## Surface: repeat-offenders — `/repeat-offenders`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** "Repeat offenders. // RÉCIDIVISTES", desc, "UPDATED Jul 1", "WORST FIRST" ranked full-width cards ("1 · YUL Aéroport / Centre-… 2.4 min · recurs 13/14d · Vehicle 747" + orange severity bar). Cards are proper full-width blocks (~48px tall — better tap targets than the hotspots inline-link rows). No repeat_problem_score sentinel leak visible (honest values). Clean.
- **Tap targets:** 22. Only new in-body sub-44 = "About Severe-delay rate" ⓘ 17×17. Rest chrome/footer.
- **Charts:** per-card severity bars, legible.
- **Sticky/chrome:** fine.

---

## Surface: alerts — `/alerts`

- **Verdict:** OK
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** "Alerts. // HISTORY", desc, "UPDATED Jul 1", "ALERTS IN WINDOW 200 · median duration 480 min" summary card, filter inputs (Line / Stop), "PAST ALERTS · Showing 25 of 200 alerts" list with "+175 more" expander. Clean stack (windowed 90d AlertHistory, S15).
- **Tap targets:** 27. In-body sub-44: "Alerts in window" ⓘ 17×17; Line/Stop filter inputs 311×**39** + inner clear buttons 28×28; "+175 more" 81×**23** (P3). No overflow.
- **Charts:** none (list + summary tile).
- **Sticky/chrome:** fine.

---

## Surface: search — `/search`

- **Verdict:** OK (cleanest surface)
- **Overflow:** none — scrollWidth 387, 0 real offenders.
- **Layout:** "SEARCH / Find a line, stop or bus.", desc, "SEARCH LINES, STOPS AND BUSES" input, empty-state card "Search a line, stop or bus — Type a line number…". Clean, well-sized search input.
- **Tap targets:** 21 with **0 in-body body violations** (all chrome + footer). The search input is properly sized.
- **Charts:** none.
- **Sticky/chrome:** fine.

---

## Surface: trip detail — `/trip/{id}`

- **Not-broadcasting state** (`/trip/12345678`, made-up id): honest empty state "TRIP · Trip not broadcasting — This trip is not currently broadcasting. Trip identifiers rotate frequently." Good honesty, no layout issue.
- **Live state** (`/trip/301027004`, route 356, pulled live from `/data/v1/stm/live/vehicles.json`):
  - **Verdict:** OK
  - **Overflow:** none — scrollWidth 387, 0 real offenders.
  - **Layout:** "TRIP · Trip 301027004. // LIVE", desc, "LIVE 29 seconds ago" + "View on map" chip, metric row (LINE 356 / STATUS · Late / DELAY · 4 min Late), "REMAINING STOPS" list (577… 02:53 LIVE PREDICTION · 4 min late · chevron, …). Stop names truncate with ellipsis — acceptable at 390px. Clean stack.
  - **Tap targets:** 23. "View trip on map" chip 108×**32**, "View line 356" chip 53×**29** (both under-height). Stop rows have chevrons — rows appear tappable.
  - **Charts:** none (prediction list). Legible.

---

# Desktop skim (1440px) — also the pending T8 browser-pass veto item

Note: `resize_window` is a no-op here too, so the "desktop" here is the real maximized viewport (2007px CSS at DPR 1.25 = 2560px physical, representative of ≥1440px desktop). Checked the main tab directly (no iframe).

## Desktop: home — `/`
- **Verdict:** OK. Left sidebar rail (NEXT STATIONS: Map/Lines/Stops/Network; AUDIT: How we measure/Data health/Hotspots/Daily receipt/Repeat offenders/Alerts), top search bar, main column with the network.control-room KPI card (4 KPIs horizontal), "What this is" (Live/Honest/Accountable cards).
- **Overflow:** innerWidth 2007, overflowX 0, **0 offenders.** Brand-consistent, nothing off.

## Desktop: metrics — `/metrics`
- **Verdict:** OK. Sidebar rail, "How we measure." hero, "// PROXY, NOT CERTIFIED OTP", intro, Focus/Remember buttons, then 2-col: "Jump to a metric ▸" ToC panel (left) + PROVENANCE prose (right). Matches S10 metrics parity (2-col, default-closed, ToC).
- **Overflow:** overflowX 0, **0 offenders.** On-brand.

## Desktop: line detail — `/lines/24?tab=reliability`
- **Verdict:** OK. VIEW window toggle (Today/This week/This month/Date range), "JUMP TO" section-nav (Reliability / When to ride / The wait / Service & space / Where it's worst), "REPEAT PROBLEMS BY HOUR" insight + full-width day×hour heatmap (Mon–Sun × 00:00–21:00, clear axis ticks), color+glyph legend (Rarely late / Sometimes late / Often late / Very unreliable ◆ / No data), honest methodology paragraph, ◆ worst-hour outlined cells, "Show the detail" disclosure. Chart-Doctrine compliant, heatmap full-width (no scroll needed at desktop).
- **Overflow:** overflowX 0, **0 offenders.** No visual defects.

## T8 verdict — SATISFIED
The pending T8 browser-pass veto item can be **marked satisfied.** Across the desktop skim (home, metrics, line-detail reliability) the site renders cleanly at ≥1440px: correct sidebar+content composition, zero horizontal overflow, on-brand four-color/Chart-Doctrine dataviz, legible full-width charts, honest empty states. No desktop visual regressions found. (Caveat noted for completeness: the map GL canvas blank-on-cold-load is a known compositing artifact, not a T8 blocker; and `resize_window` being a no-op means I verified at 2007px not exactly 1440px — but 2007px exercises the same ≥lg breakpoint and layout.)

---

# SUMMARY TABLE

| Surface | Verdict | doc overflowX | Real overflow offenders | Notable tap issues |
|---|---|---|---|---|
| home `/` | OK | 0 | 0 | 4× "About" ⓘ 17×17 |
| map `/map` | OK | 0 | 0 (1 clipped 🧡 attribution, not scrolling) | attribution toggle 24×24; primary controls 44×44 ✓ |
| lines `/lines` | OK | 0 | 0 | "View route N on map" chip 46×**32** ×200 |
| line detail `/lines/24` | OK | 0 | 0 (heatmap 432px scrolls in ScrollFrame ✓) | tabs 41px; map chip 108×32 |
| stops `/stops` | OK | 0 | 0 | filter input 311×39 |
| **stop detail `/stop/51234`** | **ISSUES** | 0 | **1 — tab strip clips: "Reliability" tab truncated ("Reliabilit") at 390px, `overflow-x:visible` no scroll** | tabs 41px + clipped |
| network `/network` | OK | 0 | 0 (SVG hover-layers only) | KPI ⓘ 17×17; **delay-dist -1/0/1 x-ticks collide (minor)** |
| metrics `/metrics` | OK | 0 | 0 (SQL code scrolls ✓) | Back-to-top 100×20 |
| status/data-health `/status` | OK | 0 | 0 | none new |
| hotspots `/hotspots` | OK | 0 | 0 | ranked rows inline links 18px (23px row); "5" btn 35×44 |
| receipt `/receipt` | OK | 0 | 0 | 7× "About" ⓘ 17×17 |
| repeat-offenders `/repeat-offenders` | OK | 0 | 0 | 1× ⓘ 17×17 (cards ~48px ✓) |
| alerts `/alerts` | OK | 0 | 0 | filter inputs 311×39; "+175 more" 81×23 |
| search `/search` | OK | 0 | 0 | none in-body ✓ |
| trip `/trip/{live}` | OK | 0 | 0 | chips 108×32 / 53×29 |
| **Desktop home/metrics/line** | **OK** | 0 | 0 | — |

## Cross-cutting findings (site-wide shared components)
1. **P2 chrome icons 36×36** — search/refresh/alerts/theme/menu top-bar icons are under 44px on every surface. One shared component. Low severity (well-spaced).
2. **P1 "About X" info ⓘ buttons at 17×17** — genuinely tiny, recur on home/network/receipt/hotspots/repeat-offenders/alerts. The single most impactful tap-target fix (one component).
3. **Tab strips render at 41px tall** (line detail, stop detail, hotspots Line/Stop) — just under 44. And on **stop detail the 4-tab strip overflow-clips the last tab at 390px** (only real overflow bug found).
4. **Per-row secondary chips at ~32px tall** ("View route/trip on map", "View line") — recur on lines index (×200), line/trip detail. Under-height.
5. **Footer nav + inline text links ~23px tall (P3)** — shared footer, every surface. Standard text-link affordance, lowest priority.
6. **Wide dataviz correctly scroll-contained** — line-detail heatmap (ScrollFrame) and metrics SQL code blocks (overflow-x:auto) both scroll inside their own frames; document never scrolls horizontally. Spec-compliant. Good.

## Totals
- **Overflow offenders (real, document-affecting):** 1 (stop-detail tab-strip clip). All other "wide" elements are either sr-only a11y tables, transparent SVG hover layers, or correctly scroll-contained (heatmap/code) — none scroll the document.
- **Tap-target violations:** every surface has sub-44 controls, but they collapse to ~6 shared components (chrome 36px, ⓘ 17px, tabs 41px, row map-chips 32px, filter inputs 39px, footer links 23px). The one that repeats most and is genuinely hard to hit is the **17×17 "About" ⓘ button**. Raw per-surface counts ranged 21–44 (lines index 221 = 200 identical row chips + shared footer/chrome).
- **Surfaces with real issues:** 1 (stop detail). 15/16 mobile surfaces + all 3 desktop = clean.

## Verdict
Site is **mobile-ready at 390px.** One real bug (stop-detail tab-strip clip), a handful of shared under-44 tap targets (most impactful: the 17px ⓘ info buttons), and one minor chart-label collision (network delay-distribution -1/0/1). No off-brand rendering; honesty/empty-state patterns intact everywhere. **T8: SATISFIED.**
