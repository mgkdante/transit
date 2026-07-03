# Vibe + Style Census — Shell / Layout / Surface Chrome / Map Canvas

Scope: `apps/web/src/lib/components/{shell,layout,surface,map}` (`.svelte` + map `.ts`), READ-ONLY.
Token canon: `apps/web/src/lib/styles/tokens.css` + `apps/web/src/app.css` (`@theme`). Tailwind v4 default
spacing scale = `0.25rem` steps (`p-2`, `gap-4`, `w-64`, …). Values sourced from a token (CSS `var(--*)`
or the Tailwind theme scale, incl. `bg-[var(--x)]`) are FINE and NOT flagged.

## Token reference (what "on-token" means)

- **Radii**: `--radius-sm 4px`, `-md 8px`, `-lg 12px`, `-xl 16px`, `-pill 9999px`.
- **Shadows**: `--shadow-glow-{sm,md,lg}`, `--shadow-card`, `--shadow-section`, `--shadow-nav`, `--shadow-sheet`.
- **Z-index**: `--z-base 0`, `--z-content 1`, `--z-rail 30`, `--z-sheet 50`, `--z-menu 60`, `--z-nav 70`.
- **Durations**: `--duration-instant 100ms`, `-fast 150ms`, `-normal 200ms`, `-slow 300ms`, `-slower 500ms`.
- **Easings**: `--ease-default`, `--ease-out (cubic-bezier(0.2,0.8,0.2,1))`, `--ease-in-out`, `--ease-bounce`.
- **Opacity**: `--opacity-muted 0.6`, `--opacity-dim 0.3`, `--opacity-subtle 0.15`, `--opacity-faint 0.05`.
- **Tracking**: `--tracking-tight -0.025em`, `-wide 0.05em`, `-eyebrow 0.1em`.
- **Type scale**: `--text-{hero…micro}` (smallest `--text-micro 0.75rem`).
- **Spacing tokens**: `--space-page-x`, `--space-section-y`, `--space-card-gap` (fluid clamps).

---

## Disposition legend

- **TOKEN** — map to an existing token/utility listed above.
- **NEW-PATTERN** — recurs enough to deserve a named shared token/util (proposed name inline).
- **KEEP/EXEMPT** — legitimately off-token (icon-internal SVG geometry, 3rd-party brand color, MapLibre
  canvas paint that can't consume CSS vars, breakpoint px). Listed for completeness; no action.
- **FIX-FALLBACK** — a `var(--token, <literal>)` whose literal fallback does not match the token value.
- **DELETE** — remove the property.

---

# SHELL

## shell/TopBar.svelte (HOTTEST — ~40 hits)

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| TopBar.svelte:273 | height (`h-[60px]`) | `60px` | header/topbar height | NEW-PATTERN `--topbar-height` (note app.css uses `--nav-height:64px`; reconcile to one) |
| TopBar.svelte:301 | max-width (`max-w-[14rem]`) | `14rem` | city-picker label cap | TOKEN → `max-w-56` (14rem) is on-scale; use utility not bracket |
| TopBar.svelte:402 | font-size (`text-[0.625rem]`) | `0.625rem` (10px) | alerts-badge micro number | TOKEN → `--text-micro (0.75rem)` or NEW `--text-nano` if 10px intended |
| TopBar.svelte:572,580 | z-index | `45` | mobile search/menu backdrops | TOKEN → between `--z-rail 30` & `--z-sheet 50`; add `--z-backdrop` or reuse `--z-rail` |
| TopBar.svelte:587,654 | z-index | `55` | mobile search panel / menu | TOKEN → `--z-sheet 50` (or NEW `--z-overlay 55`) |
| TopBar.svelte:600 | z-index | `65` | menu toggle burger | TOKEN → `--z-menu 60` |
| TopBar.svelte:799 | z-index | `50` | search results dropdown | TOKEN → `var(--z-sheet)` |
| TopBar.svelte:591,669,808 | padding | `0.45rem / 0.55rem / 0.35rem` | dropdown paddings | TOKEN → snap to `0.25rem` scale (0.5rem) |
| TopBar.svelte:588-590,655-656,800,819 | top/left/right offsets | `0.5rem / 0.75rem / 0.4rem / 0.45rem` | dropdown anchoring | TOKEN → 0.25rem scale where possible |
| TopBar.svelte:605,609 | gap/padding | `5px / 4px` | burger line gap/pad | TOKEN → snap to 4px/`gap-1` |
| TopBar.svelte:606-608 | w/h/min-w | `2.25rem` | burger toggle box | NEW-PATTERN `--control-size-sm` (2.25rem recurs: ThemeToggle, RefreshButton) |
| TopBar.svelte:630 | height | `1.5px` | burger line thickness | KEEP/EXEMPT (sub-px line-art weight) |
| TopBar.svelte:639,642,645,649 | width | `16px / 11px / 16px / 16px` | burger line widths | KEEP/EXEMPT (icon geometry) |
| TopBar.svelte:646,650 | translateY | `3.25px / -3.25px` | burger→X transform | KEEP/EXEMPT (icon geometry) |
| TopBar.svelte:596,674 | backdrop-filter | `blur(12px)` | frosted dropdown | NEW-PATTERN `--blur-panel: 12px` (also 10px @813, MapStage) |
| TopBar.svelte:813 | backdrop-filter | `blur(10px)` | frosted search results | NEW-PATTERN `--blur-panel` (unify 10↔12) |
| TopBar.svelte:626 | box-shadow | `0 0 0 2px var(--ring)` | focus ring | NEW-PATTERN `--ring-shadow` / util `.focus-ring` (recurs ×4) |
| TopBar.svelte:659,666,803,806 | width/max-height | `min(19rem…) / min(…34rem) / 38rem / 22rem` | dropdown sizing caps | KEEP (bespoke viewport caps) but `34rem/38rem/22rem` off-scale — NEW dropdown-size tokens |
| TopBar.svelte:685,734,827 | min-height | `2.55rem / 2.55rem / 2.25rem` | tap rows | NEW-PATTERN `--touch-row` (aligns w/ 44px touch target) |
| TopBar.svelte:757 | font-size | `18px` | house wordmark | NEW-PATTERN `--text-wordmark: 18px` (dup of BrandWordmark:4/87) |
| TopBar.svelte:779 | font-size | `0.72rem` | Google attribution wordmark | KEEP/EXEMPT (Google brand lockup sizing) |
| TopBar.svelte:781 | letter-spacing | `0` | Google wordmark | KEEP/EXEMPT |
| TopBar.svelte:785,789,792,795 | color | `#4285f4 #ea4335 #fbbc05 #34a853` | Google brand colors | KEEP/EXEMPT (3rd-party brand palette, must be literal) |
| TopBar.svelte:616,617,695-697,742-744 | duration fallback | `var(--duration-fast, 120ms)` | transitions | FIX-FALLBACK (token=150ms, not 120ms) |
| TopBar.svelte:634,635 | duration fallback | `var(--duration-normal, 180ms)` | line transform | FIX-FALLBACK (token=200ms) |
| TopBar.svelte:853,867 etc | padding | `0.12rem 0.35rem / 0.4rem 0.55rem` | search kind chip/result | TOKEN → 0.25rem scale |

## shell/AppShell.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| AppShell.svelte:385 | --app-rail-width-expanded | `16rem` | expanded left-rail width | TOKEN-ish (16rem = w-64) but as a named layout var it's fine; document |
| AppShell.svelte:386 | --app-rail-width-collapsed | `4.85rem` | collapsed icon-strip width | NEW-PATTERN `--rail-collapsed-w` (magic; pairs w/ LeftRail tile 3.35rem) |
| AppShell.svelte:387,398,381 | --app-left-rail-offset | `0px` | mobile rail offset default | KEEP (explicit 0 sentinel) |
| AppShell.svelte:408 | z-index | `30` | rail overlay | TOKEN → `var(--z-rail)` (value matches; just hardcoded) |
| AppShell.svelte:432 | z-index | `1` | rail drag handle | TOKEN → `var(--z-content)` |
| AppShell.svelte:483 | z-index | `32` | detail overlay | NEW-PATTERN off-token (between rail 30 & sheet 50); add `--z-detail-overlay` |
| AppShell.svelte:425,431 | width | `6px` (handle) | drag-handle hit strip | NEW-PATTERN `--handle-width: 6px` (matches app.css scrollbar 6px) |
| AppShell.svelte:413 | duration fallback | `var(--duration-normal, 180ms)` | rail width anim | FIX-FALLBACK (token=200ms) |
| AppShell.svelte:437,438 | duration fallback | `var(--duration-fast, 140ms)` | handle fade | FIX-FALLBACK (token=150ms) |
| AppShell.svelte:456-457 | outline | `2px` / offset `-2px` | focus ring | NEW-PATTERN `.focus-ring-inset` |
| AppShell.svelte:435,446 | opacity | `0 / 1` | handle reveal | KEEP (0/1 state) |
| AppShell.svelte:12,16,287,288,460,464,382 | breakpoint | `1024px` | desktop breakpoint | KEEP/EXEMPT (canonical breakpoint) |

## shell/LangSwitch.svelte (SVG line-art fingerpost — mostly icon geometry)

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| LangSwitch.svelte:121,122 | min-h/min-w | `44px` | WCAG touch target | NEW-PATTERN `--touch-target: 44px` (recurs: DateRangePicker, GrainPicker) |
| LangSwitch.svelte:123,231,241 | padding | `4px / 3px / 2px` | tap pad by breakpoint | TOKEN → 4px on-scale; 3/2 KEEP (mobile shrink) |
| LangSwitch.svelte:98 | transform-origin | `28px {ty}px` | SVG swing pivot | KEEP/EXEMPT (SVG coord) |
| LangSwitch.svelte:139,149,173 | stroke-width | `1.5 / 1.25 / 1.4` | line-art weights | KEEP/EXEMPT (drawing) |
| LangSwitch.svelte:155 | font-size | `13px` | plate label in SVG | KEEP/EXEMPT (SVG text) |
| LangSwitch.svelte:157 | letter-spacing | `0.02em` | plate label | KEEP/EXEMPT (drawing) |
| LangSwitch.svelte:179 | transform-origin | `28px 22px` | swing pivot | KEEP/EXEMPT (SVG coord) |
| LangSwitch.svelte:180 | animation | `post-swing 460ms …ease-out` | swing anim | NEW/KEEP off-token duration (bespoke; token max 500ms slower — could use `--duration-slower`) |
| LangSwitch.svelte:183 | animation | `board-settle 520ms …` | settle anim | off-token (>500ms); bespoke, KEEP or new `--duration-swing` |
| LangSwitch.svelte:225,228,238 | breakpoint | `360px / 479px / 359px` | phone shrink steps | KEEP/EXEMPT (bespoke phone breakpoints) |
| LangSwitch.svelte:226,234,235,244,245 | svg w/h | `360px 46px 34px 27px 22px 17px` | icon size by bp | KEEP/EXEMPT (icon geometry) |
| LangSwitch.svelte:200,204,208 | opacity | `0.7 / 1 / 1` | keyframe fades | KEEP (anim states) |
| LangSwitch.svelte:251-254 | sr-only | `1px … -1px` | visually-hidden | KEEP/EXEMPT (a11y idiom) |

## shell/RightPanel.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| RightPanel.svelte:183 | width | `360px` | expanded dock width | NEW-PATTERN `--detail-panel-w: 360px` (recurs: MissionControlGrid detail col, EntityList minTile) |
| RightPanel.svelte:188-190 | box-shadow | `-12px 0 28px -20px rgba(0,0,0,0.45), inset 1px 0 0 var(--edge-highlight)` | dock lift shadow | NEW-PATTERN `--shadow-dock` (one-off; raw rgba off-token) |
| RightPanel.svelte:189 | color | `rgba(0,0,0,0.45)` | shadow tint | TOKEN → color-mix on a token / part of `--shadow-dock` |
| RightPanel.svelte:201,213,217,218 | width | `3.7rem` | collapsed icon-strip | NEW-PATTERN `--rail-collapsed-w` (magic, ×6 here; pairs AppShell 4.85rem — DIFFERENT values, unify) |
| RightPanel.svelte:192 | duration | `180ms` | width transition | TOKEN → `--duration-normal` (200) or new; off-scale |
| RightPanel.svelte:193 | duration | `var(--duration-normal)` | box-shadow trans | TOKEN (good) |
| RightPanel.svelte:229,231 | container/padding | `18rem / 0.8rem` | narrow-dock reflow pad | TOKEN → 0.8rem→0.75rem/1rem scale |
| RightPanel.svelte:237 | animation | `volet-in 240ms …ease-out` | swap entrance | off-token duration (240 between 200/300); KEEP or `--duration-slow` |
| RightPanel.svelte:243 | translateX | `8px` | volet slide-in | TOKEN → `0.5rem` on-scale |

## shell/LeftRail.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| LeftRail.svelte:188,256-257,273-275 | --left-rail-tile-size | `3.35rem` | nav-tile square | NEW-PATTERN `--nav-tile-size` (magic) |
| LeftRail.svelte:221,234 | gap | `0.4rem` | nav row gap | TOKEN → 0.25rem scale (0.5rem) |
| LeftRail.svelte:235,242-243 | margin/padding | `0.85rem / 0.55rem` | group separator | TOKEN → 0.25rem scale |
| LeftRail.svelte:247-248 | padding | `0.2rem / 0.1rem` | group heading pad | TOKEN → 0.25rem scale |
| LeftRail.svelte:258,276 | padding | `0.6rem 0.7rem / 0.6rem` | link padding | TOKEN → 0.5rem/0.75rem scale |
| LeftRail.svelte:296-297 | w/h | `2rem` | icon box | TOKEN (2rem = size-8, on-scale) |
| LeftRail.svelte:310 | gap | `0.15rem` | copy stack | TOKEN → 0.25rem scale |
| LeftRail.svelte:321 | font-size | `0.96rem` | nav label | TOKEN → `--text-small (0.9375rem)` |
| LeftRail.svelte:331 | font-size | `0.72rem` | nav description | TOKEN → `--text-micro (0.75rem)` |
| LeftRail.svelte:265-267,337 | duration fallback | `var(--duration-fast, 120ms)` | color trans | FIX-FALLBACK (token=150ms) |
| LeftRail.svelte:314-315 | duration fallback | `var(--duration-normal, 180ms)` | copy fade | FIX-FALLBACK (token=200ms) |
| LeftRail.svelte:344,353 | container-query | `12rem / 9.5rem` | reflow breakpoints | KEEP (container-query thresholds) |
| LeftRail.svelte:348 | opacity | `0` | reflow hide | KEEP (state) |

## shell/ThemeToggle.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ThemeToggle.svelte:64,65 | h/w | `2.25rem` | icon-button box | NEW-PATTERN `--control-size-sm: 2.25rem` |
| ThemeToggle.svelte:79 | outline | `2px` | focus ring | NEW-PATTERN `.focus-ring` |
| ThemeToggle.svelte:80 | outline-offset | `1px` | ring offset (note: others use 2px) | TOKEN → unify offset to 2px |
| ThemeToggle.svelte:93 | filter | `drop-shadow(0 0 3px color-mix(--primary 60%…))` | lit-lens glow | NEW-PATTERN `--glow-lens` (one-off; 3px blur off-token) |
| ThemeToggle.svelte:72 | duration fallback | `var(--duration-fast, 120ms)` | color trans | FIX-FALLBACK (token=150ms) |
| ThemeToggle.svelte:87,88 | duration fallback | `var(--duration-normal, 220ms)` | lens fill/filter | FIX-FALLBACK (token=200ms, and inconsistent w/ 180ms elsewhere) |
| ThemeToggle.svelte (SVG) | stroke-width `1.25`, cx/cy/r coords | | line-art lamp | KEEP/EXEMPT (icon geometry) |

## shell/RefreshButton.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| RefreshButton.svelte:125,126 | h/w | `2.25rem` | icon-button box | NEW-PATTERN `--control-size-sm` |
| RefreshButton.svelte:113 | gap | `0.4rem` | readout gap | TOKEN → 0.25rem scale |
| RefreshButton.svelte:140,141 | outline `2px` / offset `1px` | | focus ring | NEW-PATTERN `.focus-ring` (offset inconsistent: 1px vs 2px) |
| RefreshButton.svelte:133 | duration fallback | `var(--duration-fast, 120ms)` | color trans | FIX-FALLBACK (token=150ms) |
| RefreshButton.svelte:149 | animation | `refresh-spin 0.8s linear` | spinner | off-token (0.8s not in scale); KEEP (spinner speed is functional) |

## shell/BrandWordmark.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| BrandWordmark.svelte:4,87 | font-size | `18px` | house wordmark (yesid.dev parity) | NEW-PATTERN `--text-wordmark: 18px` (dup TopBar:757) |
| BrandWordmark.svelte:90 | letter-spacing | `-0.01em` | tight wordmark | TOKEN → `--tracking-tight (-0.025em)` differs; add `--tracking-wordmark` or accept parity literal |
| BrandWordmark.svelte:98,99 | (SVG dot pulse coords) | `2px` | dot geometry | KEEP/EXEMPT |
| BrandWordmark.svelte:92 | duration fallback | `var(--duration-fast, 120ms)` | color trans | FIX-FALLBACK (token=150ms) |

## shell/BottomSheet.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| BottomSheet.svelte:71 | max-height (`max-h-[85svh]`) | `85svh` | sheet height cap | KEEP/EXEMPT (viewport cap; but 85svh recurs — could be `--sheet-max-h`) |

## shell/SurfaceNavList.svelte, LiveClock.svelte — no off-token hits found.

---

# LAYOUT

## layout/MissionControlGrid.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| MissionControlGrid.svelte:150 (+doc 4,5,29,31,35) | grid-template-columns | `60px 300px minmax(0,1fr) 360px` | 4-track console | NEW-PATTERN `--rail-w/--list-w/--detail-w` (magic layout constants recur: RailLayout, ListDetailGrid, RightPanel) |
| MissionControlGrid.svelte:133 | transition | `max-height 240ms cubic-bezier(0.2,0,0,1)` | sheet reveal | off-token: 240ms not in scale; `cubic-bezier(0.2,0,0,1)` ≠ any `--ease-*` (app.css tap-press uses it) → NEW `--ease-tap` |
| MissionControlGrid.svelte:130,164,169,188 | box-shadow / border | `var(--shadow-sheet)` / `1px` | sheet chrome | TOKEN (good) / 1px KEEP |
| MissionControlGrid.svelte:145 | max-height | `70svh` | sheet expanded | KEEP (viewport cap) |
| MissionControlGrid.svelte:129 | z-index | `var(--z-sheet)` | sheet layer | TOKEN (good) |
| MissionControlGrid.svelte:190 | border-radius | `0` | desktop reset | KEEP (explicit reset) |
| MissionControlGrid.svelte:17,148 | breakpoint | `1024px` | desktop | KEEP/EXEMPT |

## layout/RailLayout.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| RailLayout.svelte:10,70 | grid-template-columns | `minmax(13rem, 17rem) minmax(0,1fr)` | sticky-rail grid | NEW-PATTERN `--context-rail-min/max` (13/17rem magic) |
| RailLayout.svelte:11,71 | gap | `2rem` | column gap | TOKEN → 2rem = gap-8 on-scale, or `--space-card-gap` |
| RailLayout.svelte:11,84,87 | top | `5.5rem` | sticky chrome offset | NEW-PATTERN `--sticky-chrome-top: 5.5rem` (ControlsRail already tokenizes as `--rail-sticky-top`; RailLayout should reuse it) |
| RailLayout.svelte:10,12,68 | breakpoint | `1024px` | desktop | KEEP/EXEMPT |

## layout/ControlsRail.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ControlsRail.svelte:79 | gap | `0.75rem` | panel stack | TOKEN (0.75rem on-scale) |
| ControlsRail.svelte:80 | padding | `1rem` | panel pad | TOKEN (on-scale) |
| ControlsRail.svelte:104 | gap | `0.625rem` | mobile body gap | TOKEN → 0.625rem off-scale → 0.5rem/0.75rem |
| ControlsRail.svelte:11,41,109,118,122 | top / default | `5.5rem` (`--rail-sticky-top` default) | sticky offset | NEW-PATTERN promote `--rail-sticky-top` default (5.5rem) to a shared `--sticky-chrome-top` token |
| ControlsRail.svelte:81 | border | `1px` | panel border | KEEP (1px hairline) |
| ControlsRail.svelte:88 | comment `~88px` | — | doc | n/a |
| ControlsRail.svelte:108,121 | breakpoint | `1024px` | desktop | KEEP/EXEMPT |

## layout/DashboardGrid.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| DashboardGrid.svelte:41,74 | minTile default | `240px` | auto-fit min tile | NEW-PATTERN `--tile-min: 240px` (prop-driven; document standard default) |

## layout/ListDetailGrid.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ListDetailGrid.svelte:29,47 | listWidth default | `320px` | master-column width | NEW-PATTERN `--list-col-w: 320px` (magic; near MissionControl 300px — reconcile) |
| ListDetailGrid.svelte:104 | opacity | `0.7` | mobile de-emphasis | TOKEN → no exact token (dim=0.3, muted=0.6); add `--opacity-recede: 0.7` or use 0.6 |
| ListDetailGrid.svelte:143 | opacity | `1` | desktop reset | KEEP (state) |
| ListDetailGrid.svelte:127,133 | border | `1px` | column divider | KEEP (1px hairline) |
| ListDetailGrid.svelte:107 | breakpoint | `1024px` | desktop | KEEP/EXEMPT |

## layout/Surface.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| Surface.svelte:48 | gap | `clamp(1.75rem, 4vw, 2.75rem)` | section rhythm | NEW-PATTERN `--space-surface-gap` (parallels `--space-section-y` but different values) |
| Surface.svelte:54 | padding-block | `clamp(1.5rem, 4vw, 2.5rem)` | surface pad | NEW-PATTERN `--space-surface-pad` |
| Surface.svelte:57 | padding-block | `clamp(2rem, 6vw, 4rem)` | hub pad | NEW-PATTERN `--space-hub-pad` (or reuse `--space-section-y`) |

## layout/Footer.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| Footer.svelte:157 | height | `3px` | hazard strip height | NEW-PATTERN `--hazard-strip-h: 3px` (hazard recipe) |
| Footer.svelte:160-163 | gradient stops | `0px 6px 6px 12px` | hazard stripe geometry | NEW-PATTERN part of a shared `.hazard-strip` util (recipe already referenced in comment) |
| Footer.svelte:170 | border-top | `2px` | departure-board rule | NEW-PATTERN `--rule-bold: 2px` (recurs: divider-dashed 2px in app.css) |
| Footer.svelte:184 | gap | `0.15rem` | honesty stack | TOKEN → 0.25rem scale |
| Footer.svelte:192,195,202 | bg-size / height | `0% 1px / 1px` | underline-draw | KEEP (1px underline draw idiom) |
| Footer.svelte:94 | z-index (`z-50`) | `50` | footer layer | TOKEN → `var(--z-sheet)` value matches; hardcoded Tailwind number |
| Footer.svelte:94,105,113,127,139,145 | `bg-[var(--x)]/text-[var(--x)]` | token vars | color | KEEP (token-backed; consider `bg-muted`/`text-muted-foreground` utils exist) |

## layout/EdgeStateGrid.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| EdgeStateGrid.svelte:96 | breakpoint | `1024px` | desktop 3-col | KEEP/EXEMPT |
| (no numeric off-token style hits; uses `--space-*` tokens) | | | | — |

---

# SURFACE

## surface/AffectedAlerts.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| AffectedAlerts.svelte:252 | width | `3px` | severity accent stripe (`::before`) | NEW-PATTERN `--accent-stripe-w: 3px` (accent-border stripe; recurs EntityDetail tab 3px) |
| AffectedAlerts.svelte:201,244,206,267 | gap | `0.6rem / 0.5rem` | list/card gaps | TOKEN → 0.5rem/0.75rem scale (0.6rem off) |
| AffectedAlerts.svelte:222 | padding | `0.15rem 0` | disclosure btn | TOKEN → 0.25rem scale |
| AffectedAlerts.svelte:225 | text-underline-offset | `0.2em` | disclosure underline | KEEP (em relative) |
| AffectedAlerts.svelte:228 | text-decoration-thickness | `2px` | hover underline | KEEP (2px) |
| AffectedAlerts.svelte:233 | radius fallback | `var(--radius-sm, 0.375rem)` | focus radius | FIX-FALLBACK (token=4px, fallback=6px) |
| AffectedAlerts.svelte:244 | padding | `0.6rem 0.7rem 0.6rem 0.9rem` | card pad (asym for stripe) | TOKEN → 0.5/0.75rem scale; 0.9rem magic |
| AffectedAlerts.svelte:289,290,295 | gap | `0.3rem 0.7rem / 0.5rem / 0.35rem` | meta row gaps | TOKEN → 0.25rem scale |
| AffectedAlerts.svelte:317-320 | sr-only | `1px … -1px` | a11y | KEEP/EXEMPT |
| AffectedAlerts.svelte:238,256-262 | `--alert-tone: var(--dataviz-severity-*)` | token | severity color | KEEP (token-backed dataviz — GOOD example) |

## surface/ReliabilityPane.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ReliabilityPane.svelte:196 | gap | `1.5rem` | pane stack | TOKEN (1.5rem on-scale) |
| ReliabilityPane.svelte:200,212 | gap | `1rem / 1.25rem` | cards/metrics | TOKEN (on-scale) |
| ReliabilityPane.svelte:205 | minmax | `min(14rem,100%)` | card min | NEW-PATTERN `--card-min: 14rem` |
| ReliabilityPane.svelte:211,215,226,231 | gap/padding | `0.75rem / 0.4rem` | card pad, severe/trend gaps | TOKEN → 0.4rem→0.5rem |
| ReliabilityPane.svelte:214,216 | border/shadow | `1px` / `var(--shadow-card)` | card chrome | KEEP / TOKEN (good) |
| ReliabilityPane.svelte:215 | radius fallback | `var(--radius-lg, 0.75rem)` | card radius | FIX-FALLBACK-OK (0.75rem=12px matches token) — literal is correct here |
| ReliabilityPane.svelte:203 | breakpoint | `640px` | card reflow | KEEP/EXEMPT |

## surface/DateRangePicker.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| DateRangePicker.svelte:30,296,300,305,317 | min-height | `44px` | WCAG touch target | NEW-PATTERN `--touch-target: 44px` |
| DateRangePicker.svelte:306 | radius fallback | `var(--radius-md, 0.5rem)` | select radius | FIX-FALLBACK (token=8px=0.5rem — MATCHES, OK) |
| DateRangePicker.svelte:324 | radius fallback | `var(--radius-pill, 999px)` | clear-btn pill | FIX-FALLBACK (token=9999px, fallback=999px) |
| DateRangePicker.svelte:307,336-337 | padding | `0.35rem 0.6rem / 0.35rem 0.75rem` | control pad | TOKEN → 0.25rem scale (0.35/0.6 off) |
| DateRangePicker.svelte:310,311 | outline `2px`/offset `2px` | | focus ring | NEW-PATTERN `.focus-ring` |
| DateRangePicker.svelte:323 | border | `1px` | clear border | KEEP |
| DateRangePicker.svelte (clear) | transition | `color 0.15s / border-color 0.15s ease` | hover | TOKEN → `var(--duration-fast)` (0.15s=150ms) instead of raw seconds |

## surface/EntityRow.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| EntityRow.svelte:75 | inline style | `background:{swatch}` | GTFS route hue | KEEP/EXEMPT (documented dynamic data color) |
| EntityRow.svelte:109 | gap | `0.875rem` | row gap | TOKEN (0.875rem = gap-3.5 on-scale) |
| EntityRow.svelte:110 | padding | `0.75rem 0.875rem` | row pad | TOKEN (on-scale) |
| EntityRow.svelte:114 | transition | `background-color 150ms ease` | hover | TOKEN → `var(--duration-fast) var(--ease-*)` (150ms matches but raw) |
| EntityRow.svelte:120-121 | w/h | `0.85rem` | route swatch chip | TOKEN → 0.875rem (size-3.5) or new `--swatch-size` |
| EntityRow.svelte:137 | box-shadow | `inset 0 0 0 1px color-mix(--foreground 18%…)` | swatch ring | KEEP (1px inset ring on dynamic swatch; token-mixed) |
| EntityRow.svelte:142,149,167,183,184,190 | gap/padding | `0.15rem / 0.5rem / 0.05rem 0.4rem / 0.25rem / 0.1rem 0.35rem` | body/tag/route chips | TOKEN → 0.25rem scale (many off) |
| EntityRow.svelte:167 | letter-spacing | `0.4rem`? (route chip) | — | verify; likely padding — TOKEN scale |

## surface/EntityDetail.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| EntityDetail.svelte:139 | border-bottom | `3px solid transparent` | station-tab underline | NEW-PATTERN `--accent-stripe-w: 3px` (tab active underline) |
| EntityDetail.svelte:119,131,133 | gap/padding | `0.75rem / 0.5rem 1rem / 0.5rem` | head/tab pad | TOKEN (on-scale mostly) |
| EntityDetail.svelte:154,155,183 | outline `2px` / offset `-2px`/`2px` | | tab/back focus ring | NEW-PATTERN `.focus-ring` (inset variant) |
| EntityDetail.svelte:169 | gap | `0.3rem` | back link | TOKEN → 0.25rem scale |
| EntityDetail.svelte:185 | border-radius | `2px` | back-focus radius | TOKEN → `--radius-sm (4px)` (2px off-scale) |
| EntityDetail.svelte:191 | translateX | `-2px` | chevron nudge | KEEP (2px micro-motion) |
| EntityDetail.svelte:194 | padding-top | `1.25rem` | pane top | TOKEN (on-scale) |

## surface/EntityList.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| EntityList.svelte:38,51 | minTile default | `360px` | grid-mode min tile | NEW-PATTERN `--tile-min-wide: 360px` (recurs; near DashboardGrid 240px — different intent) |
| EntityList.svelte:109,120 | border | `1px` | row divider / tile border | KEEP (1px hairline) |
| EntityList.svelte:125 | padding | `0.75rem 0.875rem` | "more" row | TOKEN (on-scale) |

## surface/GrainPicker.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| GrainPicker.svelte:146,147,151 | min-height (was ~31px→) | `44px` | WCAG touch target | NEW-PATTERN `--touch-target: 44px` |
| GrainPicker.svelte:132-133,135 | gap/padding | `0.25rem / 0.75rem` | picker chrome | TOKEN (on-scale) |
| GrainPicker.svelte:135,153 | radius fallback | `var(--radius-lg, 0.75rem)` / `var(--radius-md, 0.5rem)` | radii | FIX-FALLBACK-OK (both match token values) |
| GrainPicker.svelte:152 | padding | `0.4rem 0.8rem` | segment pad | TOKEN → 0.25rem scale |
| GrainPicker.svelte:164 | opacity | `0.4` | disabled grain | TOKEN → no exact token (dim=0.3); add `--opacity-disabled: 0.4` |
| GrainPicker.svelte:174-175 | outline `2px`/offset `2px` | | focus ring | NEW-PATTERN `.focus-ring` |
| GrainPicker.svelte (seg) | transition | `background-color 0.15s / color 0.15s ease` | hover | TOKEN → `var(--duration-fast)` (raw seconds) |
| GrainPicker.svelte:134 | border | `1px` | picker border | KEEP |

## surface/Breadcrumb.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| Breadcrumb.svelte:94 | opacity | `0.6` | separator dim | TOKEN → `var(--opacity-muted)` (0.6 matches) |
| Breadcrumb.svelte:110,111 | outline `2px`/offset `2px` | | focus ring | NEW-PATTERN `.focus-ring` |
| Breadcrumb.svelte:112 | border-radius | `2px` | focus radius | TOKEN → `--radius-sm (4px)` (2px off) |
| Breadcrumb.svelte:85 (item) | gap | `0.35rem` | crumb gap | TOKEN → 0.25rem scale |

## surface/SearchInput.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SearchInput.svelte:64 | max-width | `28rem` | field width | NEW-PATTERN `--field-max-w: 28rem` |
| SearchInput.svelte:63 | gap | `0.4rem` | label/field gap | TOKEN → 0.5rem scale |
| SearchInput.svelte:75 | padding | `0.75rem 0.875rem` | input pad | TOKEN (on-scale) |
| SearchInput.svelte:83,84 | transition | `border-color 150ms / box-shadow 150ms ease` | focus | TOKEN → `var(--duration-fast)` (raw 150ms) |
| SearchInput.svelte:92 | box-shadow | `0 0 0 2px var(--ring)` | focus ring | NEW-PATTERN `--ring-shadow` / `.focus-ring` (recurs TopBar:626, GrainPicker) |
| SearchInput.svelte:80 | border | `1px` | input border | KEEP |

## surface/MapDrilldownLink.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| MapDrilldownLink.svelte:35 | min-height | `2rem` | link box | NEW-PATTERN `--control-size-xs: 2rem` (or touch-target if it should be 44) |
| MapDrilldownLink.svelte:36 | padding | `0.25rem 0.65rem` | link pad | TOKEN → 0.25rem scale (0.65 off) |
| MapDrilldownLink.svelte:42,55,56 | border `1px` / outline `2px` / offset `2px` | | chrome/focus | KEEP / NEW-PATTERN `.focus-ring` |
| MapDrilldownLink.svelte:45-47 | transition | `color/bg/border 150ms ease` | hover | TOKEN → `var(--duration-fast)` (raw 150ms) |

## surface/ConformanceBadge.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ConformanceBadge.svelte:137 | letter-spacing | `0.5px` | label tracking | TOKEN → tracking tokens are em-based; `0.5px` off — use `--tracking-wide` or accept |
| ConformanceBadge.svelte:131 | gap | `0.5rem` | badge gap | TOKEN (on-scale) |

## surface/FreshnessStamp.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| FreshnessStamp.svelte:162,168 | letter-spacing | `1px` | label tracking (live/updated) | TOKEN → `--tracking-eyebrow (0.1em)` or `--tracking-wide (0.05em)` (1px px-based off scale) |

## surface/ReliabilityBadge.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| ReliabilityBadge.svelte:95 | gap | `0.4rem` | badge gap | TOKEN → 0.5rem scale |

## surface/SurfaceControls.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SurfaceControls.svelte:242 | gap | `0.75rem 1rem` | controls row/col gap | TOKEN (on-scale) |
| SurfaceControls.svelte:248-251 | sr-only | `1px … -1px` | a11y reason | KEEP/EXEMPT |
| (largely token-driven; no material off-token hits) | | | | — |

## surface/SurfaceHeader.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SurfaceHeader.svelte:60 | gap | `0.75rem` | header stack | TOKEN (on-scale) |
| SurfaceHeader.svelte:66 | max-width | `52ch` | lede measure | KEEP/EXEMPT (ch measure idiom) |

## surface/EntityDetail/ResourceBoundary/AffectedAlerts... others clean.

---

# MAP (presentational canvas layer)

Note: MapLibre GL paint properties CANNOT consume CSS `var()` at the canvas layer, so the map uses a
**token-primary + documented-literal-fallback** pattern via `resolveColor('var(--token)', '<literal>')`.
This is architecturally sound — the literals are dormant SSR fallbacks. Flagged as low-priority
"fallback duplication" (the literals can drift from tokens over time), not as raw off-token color.

## map/basemap.ts (BASEMAP_PALETTES — MapLibre style JSON)

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| basemap.ts:66 | background (dark) | `#141414` | mirrors `--background` dark | KEEP/EXEMPT (canvas paint; comment cites token) — consider generating from tokens at build |
| basemap.ts:68 | land | `#0f0d0a` | mirrors `--manifesto` dark | KEEP/EXEMPT (token mirror) |
| basemap.ts:70,72 | water/waterEdge | `#17313a / #347383` | bespoke map water | KEEP/EXEMPT (map-only hue, no token equivalent) — could add `--map-water` tokens |
| basemap.ts:74 | park | `#173327` | bespoke map park | KEEP/EXEMPT (no token) → NEW `--map-park` if map palette tokenized |
| basemap.ts:76,78,80 | roadCasing/road/roadMajor | `#242424 / #3a3a3a / #4a4a4a` | road strokes (road/roadMajor mirror `--border`/`--border-strong`) | KEEP/EXEMPT (token mirror + bespoke) |
| basemap.ts:82,89,90 | roadBridge/parkInk/landmarkInk | `#5F574C / #8CBF9B / #C6B37E` | bespoke map inks | KEEP/EXEMPT (map-only) |
| basemap.ts:84,85,87,88,92 | shield/label inks & halos | `#141414 #D0D0D0 #A8A8A8 #D0D0D0 #141414` | label legibility | KEEP/EXEMPT (map-only) |
| basemap.ts:96-123 (light palette) | 16 hex | `#F3F6FB … #7A6642` | light-theme map palette (many mirror `--background/--card/--border/--muted-foreground/--secondary-foreground`) | KEEP/EXEMPT (token mirrors + bespoke map hues) |
| basemap.ts:133,172 | line-width/line-opacity | `0.5 / 0.4 / 1.25` | stroke geometry | KEEP/EXEMPT (canvas render math) |

**Disposition note (basemap):** The single highest-leverage improvement here is to GENERATE
`BASEMAP_PALETTES` from `tokens.json` at build (the file already annotates which entries mirror which
token) so the mirrors can't drift; the truly map-only hues (water/park/bridge) become a small
`--map-*` token group.

## map/vehicleSprites.ts

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| vehicleSprites.ts:42,44,46,51,57,59 | *_FALLBACK consts | `rgb(224,120,0) #141414 rgb(255,182,39) #f5f5f5 …` | documented token fallbacks | KEEP/EXEMPT (named fallback pattern — GOOD) |
| vehicleSprites.ts:280 | inline fallback | `'#8a8a8a'` | fallback for `--dataviz-status-unknown` | FIX-CONSISTENCY → promote to a named `*_FALLBACK` const like the others (inline literal breaks the pattern) |
| vehicleSprites.ts:284 | inline fallback | `'#7a5fb0'` | fallback for `--dataviz-occupancy-empty` | FIX-CONSISTENCY → named `*_FALLBACK` const |
| vehicleSprites.ts:26 | SIZE | `26` | sprite px size | KEEP/EXEMPT (render geometry) |

## map/routeLines.ts

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| routeLines.ts:147,188 | fallback | `rgb(255,182,39)` for `--accent-text` | route yellow | KEEP/EXEMPT (resolveColor fallback) |
| routeLines.ts:148,189 | fallback | `rgb(20,20,20)` for `--background` | casing | KEEP/EXEMPT (matches #141414) |
| routeLines.ts:156,167 | line-opacity | `0.9 / 0.95 / 0` | stroke alpha | KEEP/EXEMPT (render) |

## map/nearTargetLayer.ts

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| nearTargetLayer.ts:52,53,54 | fallbacks | `rgb(255,182,39) rgb(20,20,20) rgb(255,255,255)` | pin fill/halo/inner token fallbacks | KEEP/EXEMPT (resolveColor pattern) |
| nearTargetLayer.ts:28,30 | WIDTH/RATIO | `44 / 2` | sprite geometry | KEEP/EXEMPT (render) |

## map/MapStage.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| MapStage.svelte:370 | z-index | `12` | maplibre ctrl chrome | NEW-PATTERN off-token (below `--z-rail 30`); add `--z-map-ctrl` |
| MapStage.svelte:371 | transition | `right 180ms …ease-out` | ctrl offset anim | TOKEN → `var(--duration-normal)` (180ms off-scale) |
| MapStage.svelte:398 | breakpoint | `760px` | mobile map chrome | KEEP/EXEMPT (bespoke; but 760 ≠ 768/1024 elsewhere — reconcile) |
| MapStage.svelte:402,406,418 | max-width | `calc(100vw - 5.25rem)` | attrib cap | TOKEN → 5.25rem magic; keep calc but tokenize the inset |
| MapStage.svelte:412 | min-height | `1.75rem` | compact attrib | TOKEN → 1.75rem (size-7) on-scale |
| MapStage.svelte:414 | padding | `0.25rem 1.85rem 0.25rem 0.55rem` | attrib pad (1.85rem = X btn clearance) | KEEP/EXEMPT (maplibre chrome clearance) |
| MapStage.svelte:380 | max-width | `min(32rem, calc(...))` | attrib width | TOKEN → 32rem off-scale; NEW `--map-attrib-max` |
| MapStage.svelte:401 | bottom | `calc(1rem + env(safe-area-inset-bottom, 0px))` | safe-area | KEEP/EXEMPT |
| MapStage.svelte:354,360-361 | radius `--radius-lg` / outline `2px` | | stage chrome/focus | TOKEN (good) / NEW `.focus-ring` |

## map/{stopsLayer,vehicleLayer,polyline,routeDirection,viewport,nearbyStops,vehicleMotion,vehicleProjection,vehicleShapes,vehicleSilence}.ts

- No off-token **visual chrome** properties; contents are geometry/projection math, layer paint driven by
  `resolveColor` token fallbacks, and numeric render constants (line-width, radii in map units). Out of the
  vibe-census surface. **No hits.**

---

# APPENDIX — Repeated ad-hoc patterns (candidates to become named)

The three most-repeated, highest-leverage patterns (see Summary):

1. **Focus ring** `outline: 2px solid var(--ring); outline-offset: 2px` (+ `box-shadow: 0 0 0 2px var(--ring)`
   variant, + `-2px` inset variant) — appears in ~14 files (TopBar, AppShell, LeftRail, ThemeToggle,
   RefreshButton, LangSwitch, GrainPicker, DateRangePicker, Breadcrumb, EntityRow, EntityDetail, SearchInput,
   MapDrilldownLink, MapStage, AffectedAlerts). Offset is inconsistent (1px on ThemeToggle/RefreshButton vs
   2px elsewhere). → Propose a `.focus-ring` / `.focus-ring-inset` utility (app.css `@layer base` already has
   the global `:focus-visible` — these component rules largely duplicate it and could be deleted).

2. **Mismatched CSS-var fallbacks** — `var(--duration-fast, 120ms|140ms)` (token=150ms),
   `var(--duration-normal, 180ms|220ms)` (token=200ms), `var(--radius-sm, 0.375rem)` (token=4px),
   `var(--radius-pill, 999px)` (token=9999px). ~24 occurrences across shell + surface. Dormant (token always
   resolves) but wrong. → Drop the literal fallbacks (tokens are always loaded) OR regenerate them from
   tokens so they never drift.

3. **Off-0.25rem-scale rem spacings** — `0.4rem`, `0.6rem`, `0.65rem`, `0.85rem`, `0.15rem`, `0.35rem`,
   `0.55rem`, `0.45rem`, `0.625rem`, `0.96rem`, `0.72rem` — pervasive in gaps/paddings/font-sizes across
   nearly every file. → Snap to the Tailwind spacing scale (0.25/0.5/0.75/1rem) or the `--text-*` type scale.

Secondary repeated patterns worth tokenizing:
- **Control/icon-button size** `2.25rem` (TopBar burger, ThemeToggle, RefreshButton) → `--control-size-sm`.
- **Touch target** `44px` (LangSwitch, DateRangePicker×3, GrainPicker×3) → `--touch-target: 44px`.
- **Sticky-chrome offset** `5.5rem` (RailLayout, ControlsRail `--rail-sticky-top` default) → shared `--sticky-chrome-top`.
- **Layout column widths** `60px/300px/320px/360px/240px` (MissionControlGrid, ListDetailGrid, DashboardGrid,
  RightPanel, EntityList) → `--rail-w/--list-col-w/--detail-panel-w/--tile-min`.
- **Accent stripe width** `3px` (AffectedAlerts `::before`, EntityDetail tab underline) → `--accent-stripe-w`.
- **Panel backdrop blur** `10px/12px` (TopBar×3, MapStage) → `--blur-panel`.
- **Wordmark size** `18px` (BrandWordmark, TopBar house) → `--text-wordmark`.
- **Raw-seconds transitions** `0.15s` (DateRangePicker, GrainPicker) and raw `150ms`/`180ms` (EntityRow,
  SearchInput, MapDrilldownLink, RightPanel, MapStage, MissionControlGrid) → `var(--duration-fast|normal)`.
- **Bespoke easing** `cubic-bezier(0.16,1,0.3,1)` (RightPanel, AppShell, MapStage, LangSwitch, MissionControl
  fallbacks) — NOT one of the `--ease-*` tokens; and `cubic-bezier(0.2,0,0,1)` (MissionControl, app.css
  tap-press) also untokenized → add `--ease-emphasized` / `--ease-tap`.
