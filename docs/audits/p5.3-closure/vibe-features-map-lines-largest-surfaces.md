# Vibe + Style Census — Features: map + lines (largest surfaces)

Scope: `apps/web/src/lib/features/map/` + `apps/web/src/lib/features/lines/` — 33 `.svelte` files (the `.ts` logic/selector/copy files carry no visual properties and were excluded after inspection; `MapStageStub.svelte` is a test stub with no theme visuals; `MarkerGlyph.svelte` is pure SVG sprite geometry — see Exemptions).

Read-only analysis. No files modified.

## Token vocabulary reference (what "on-token" means here)

Sourced from `apps/web/src/lib/styles/tokens.css` (generated, canon) + `apps/web/src/app.css` `@theme`:

- **Radii:** `--radius-sm 4px` · `--radius-md 8px` · `--radius-lg 12px` · `--radius-xl 16px` · `--radius-pill 9999px`
- **Text:** `--text-hero … --text-micro` (all `--text-*` clamps/rem)
- **Tracking:** `--tracking-tight -0.025em` · `--tracking-wide 0.05em` · `--tracking-eyebrow 0.1em`
- **Z-index:** `--z-base 0` · `--z-content 1` · `--z-rail 30` · `--z-sheet 50` · `--z-menu 60` · `--z-nav 70`
- **Duration:** `--duration-instant 100ms` · `--duration-fast 150ms` · `--duration-normal 200ms` · `--duration-slow 300ms` · `--duration-slower 500ms`
- **Ease:** `--ease-default cubic-bezier(.4,0,.2,1)` · `--ease-out cubic-bezier(.2,.8,.2,1)` · `--ease-in-out` · `--ease-bounce`
- **Opacity:** `--opacity-muted .6` · `--opacity-dim .3` · `--opacity-subtle .15` · `--opacity-faint .05`
- **Spacing:** page-level clamps `--space-page-x/-section-y/-card-gap`; utility spacing = **Tailwind default 0.25rem-step scale** (0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 …). A raw `rem` is *off-scale* when `value*100 % 25 != 0` (e.g. 0.3, 0.35, 0.4, 0.45, 0.55, 0.6, 0.65, 0.7, 0.85 …).
- **Shadows:** `--shadow-glow-{sm,md,lg}` · `--shadow-card/-section/-nav/-sheet`.
- **No token exists for:** blur radius, `saturate()`, hairline border widths (only `--border-hairline` *color*), the 2px/3px accent-stripe width, the intra-overlay z-index band (2–32), or the micro rem spacing register (0.3–0.85rem). These are the recurring gaps.

## Headline counts

| Category | Count |
|---|---|
| Off-scale `rem` occurrences (not on 0.25 Tailwind step) | **244** (of 492 total rem literals) |
| `px` literals (hairlines, blur radii, widths, breakpoints) | 187 |
| `z-index` literals (not `var(--z-*)`) | 15 |
| `opacity` literals ≠ 0/1 (not `var(--opacity-*)`) | 11 |
| `letter-spacing` literals (not `var(--tracking-*)`, ≠ 0) | 11 |
| `backdrop-filter: blur() saturate()` lines | 12 |
| Hex colors outside tokens | 4 (all Google-logo brand hex) |
| `transform: translateX(2px)` hover-nudge | 7 |
| `border-radius: 999px` (should be `--radius-pill`) | 3 |
| 2px/3px accent-stripe borders (`border-left/top/inline-start`) | 9 |
| `transition` with `var(--token, LITERAL)` fallbacks | 47 lines (5 with **wrong** fallback: 180ms/140ms) |
| Arbitrary Tailwind bracket utils (`p-[13px]` etc.) | **0** (clean) |

The class list is disciplined (**zero** arbitrary Tailwind bracket values). Essentially all off-token debt lives in `<style>` blocks. The dominant issue is a **token-less micro-spacing register (0.3–0.85rem)** used everywhere instead of the Tailwind scale.

---

## Recurring patterns (the 3 to name)

1. **Micro-spacing register `0.3 / 0.35 / 0.4 / 0.45 / 0.55 / 0.6 / 0.65 / 0.7 / 0.85rem`** — 244 hits. A deliberate "tighter than Tailwind" gap/padding vocabulary used in every panel/chip/row. Candidate: add half-step spacing tokens (`--space-1 .3rem`, `--space-1_5 .45rem`, `--space-2 .6rem`, `--space-3 .85rem` …) OR round each to the nearest 0.25 Tailwind step and use `gap-*/p-*` utilities.
2. **Glass-overlay chrome: `backdrop-filter: blur(10px) saturate(1.1)` + `1px` hairline border + `999px`/`--radius-*` pill** — 12 blur lines across MapFreshness / MapOverlayChrome / MapFeedStallBanner / MapNearMeControl / MapFilterPill / MapFilters / ReliabilityFilterPill. Candidate: a shared `.glass-overlay` utility (or `--blur-glass` + `--saturate-glass` tokens) — every floating map/filter overlay reimplements the same values.
3. **Hover-reveal nudge `transform: translateX(2px)`** (7×) + the `var(--token, 150ms)` transition triad (`color/background-color/border-color var(--duration-fast) var(--ease-default)`, ~47 lines). Candidate: a `.row-hover-nudge` utility and a `--transition-control` shorthand token so the triad + nudge stop being copy-pasted.

## Hottest 10 files (by off-scale-rem + px + other literal density)

1. `map/MapSelectionDetail.svelte` — 56 off-scale rem + 21 px + 8 opacity + 3 letter-spacing + 4 nudges (~92)
2. `map/MapNearMeControl.svelte` — 35 rem + 14 px + 4 hex + blur + letter-spacing (~57)
3. `map/MapFilters.svelte` — 26 rem + 21 px + multi shadows + gradient (~52)
4. `lines/reliability/RouteReliabilityClusters.svelte` — 12 rem + 16 px + accent stripe (~30)
5. `map/MapMotionControl.svelte` — 14 rem + 12 px + toggle-knob transforms (~28)
6. `lines/reliability/sections/Section2TheWait.svelte` — 14 rem + 7 px + 2 letter-spacing + accent stripe (~25)
7. `map/MapFilterPill.svelte` — 7 rem + 15 px + blur + 999px (~24)
8. `map/MapDetailAlerts.svelte` — 10 rem + 7 px + opacity + nudge (~19)
9. `lines/RouteDetail.svelte` — 8 rem + 13 px + opacity + nudge (~23)
10. `lines/reliability/ReliabilityFilterPill.svelte` — 6 rem + 13 px + blur + 999px (~20)

---

# Per-file findings

> Notation: where a literal class repeats many times in one file (e.g. off-scale rem), individual representative lines are listed and a "(+N more, lines …)" roll-up is given so the count reconciles. All `color-mix(... var(--token) ...)` values are token-derived and NOT flagged. `var(--token, LITERAL)` fallbacks are flagged only when the literal is *off-token* or *mismatched*; matching fallbacks (`--duration-fast, 150ms`) are noted once per file as low-priority.

## map/MapSelectionDetail.svelte  (HOTTEST)

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :572 | gap | 1.15rem | header column gap | round → 1.25rem (`gap-5`) or new token |
| :577 | gap | 0.7rem | header inner gap | micro-spacing token |
| :578/:579 | min/max-width | 14rem / 18rem | detail-header width band | keep as layout constants or `--panel-*` tokens |
| :586,:673,:768,:901,:919,:1213 | gap/padding | 0.3rem | tight stack gap | micro-spacing token (0.3rem is top-3 repeated) |
| :587,:591,:1082 | padding-bottom | 0.85rem / 0.55rem | section rhythm | micro-spacing token |
| :608/:609 | width/height | 1.35rem / **2px** | header accent tick bar | 2px = off-scale hairline; token or `h-px`? (2px intentional) |
| :619,:645,:669 | letter-spacing | -0.01em / 0.01em / 0.02em | label micro-tracking | **off-token** — map to `--tracking-tight`/`-wide` or add micro tracking token |
| :631,:673,:830,:933,:1100,:1140,:1181 | gap | 0.35rem / 0.4rem | chip/row gaps | micro-spacing token |
| :637,:660 | min-height | 1.85rem | pill min-height | round 1.75rem or `--control-h` token |
| :642,:665 | padding | 0.25rem 0.7rem | pill padding | 0.7rem off-scale → micro token |
| :688,:858 | opacity | 0.55 | dim secondary text | **off-token** → nearest `--opacity-muted .6` |
| :698,:813,:1004,:1061 | transform | translateX(2px) | hover reveal nudge (×4) | **PATTERN** → shared `.row-hover-nudge` |
| :718 | opacity | 0.75 | mid-dim | **off-token** → no exact token; add or use .6 |
| :726,:856 | width | 3px | left accent bar width | accent-stripe pattern (see below) |
| :728,:801,:1048,:977 | opacity | 0.5 / 0.45 | dim/inactive | **off-token** → `--opacity-dim .3`? re-evaluate |
| :740 | grid-template | 5.75rem minmax(0,1fr) | metric grid label col | 5.75rem off-scale |
| :741,:867,:874,:1011,:1042,:1065,:1081,:1092,:1197 | gap | 0.6rem / 0.55rem / 0.5rem / 0.65rem / 0.75rem | grid/stack gaps | micro-spacing tokens (0.6/0.55 top-repeated) |
| :743,:772 | min-height | 2.4rem / 1.7rem | row heights | off-scale |
| :746,:773,:845,:951,:1015,:1071,:1101 | padding | 0.2rem 0.55rem / 0.5rem 0.65rem 0.5rem 0.85rem / 0.18rem 0 | row padding | micro-spacing tokens |
| :888 | height | 1px | divider rule | hairline (no token) |
| :904,:987,:1095,:1125,:1205 | margin | 0.55rem / 0.1rem / 0.2rem | rhythm nudges | micro-spacing tokens |
| :946,:1010 | grid-template | 1.9rem … / minmax(3.5rem,auto) … | metric row grid | off-scale |
| :948,:1012 | width | calc(100% + 1.1rem) | negative-margin bleed | 1.1rem off-scale, paired w/ :949/:1013 margin-inline -0.55rem |
| :1109,:1149,:1193 | @media/@container | max-width: 42rem / 21rem / 17rem | responsive breakpoints | breakpoints — keep but consider shared bp tokens |
| :698,:813 etc translateX(2px) | (see above) | | | |

Off-scale rem in this file: **56** (representative lines above; remaining are more gap/padding at 0.3/0.35/0.4/0.45/0.5/0.55/0.6/0.65/0.7/0.85rem — same dispositions).

## map/MapNearMeControl.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :499,:503,:506,:509 | color | **#4285f4 / #ea4335 / #fbbc05 / #34a853** | Google wordmark logo colors | **Exempt-by-brand** but census hit — Google's own palette; can't tokenize (external brand). Consider a `--google-blue/-red/-yellow/-green` local const to name them. |
| :282,:362 | right/bottom offset | calc(var(--map-detail-offset,0rem) + 1rem) / calc(100% + 0.5rem) | overlay anchoring | var-based; 0.5rem fine |
| :283,:587 | bottom | 5.1rem / calc(3.35rem + env(...)) | FAB vertical offset | 5.1rem/3.35rem off-scale — layout constants |
| :287,:365,:395,:524 | gap | 0.45rem / 0.35rem | control gaps | micro-spacing token |
| :290 | transition | **right 180ms** var(--ease-out, …) | slide-in duration | **bare literal 180ms, no duration token** → `--duration-normal`(200) or add 180ms token |
| :303-305,:357,:413,:414 | transition | var(--duration-fast, 150ms) … | control transitions | fallback matches token — low priority; PATTERN |
| :311,:435,:449,:480,:540,:549 | gap | 0.5rem / 0.25rem / 0.12rem / 0.3rem | list gaps | micro-spacing token (0.12rem very tight) |
| :313,:374,:385,:404,:450,:556 | min-height | 2rem | control height | on-scale (2rem OK) |
| :314,:366,:375,:386,:405,:441,:451,:482,:525,:542,:557 | padding | 0.35rem 0.85rem 0.35rem 0.7rem / 0.6rem / 0.4rem 0.65rem / 0.3rem 0.7rem / 0.1rem 0.3rem 0.1rem 0.45rem | control padding | micro-spacing tokens |
| :316 | letter-spacing | 0.04em | button tracking | **off-token** → `--tracking-wide .05em`? |
| :322,:371 | backdrop-filter | **blur(10px) saturate(1.1)** / **blur(12px) saturate(1.1)** | glass overlay | **PATTERN** → `.glass-overlay` |
| :363,:436,:604 | width/max-height | min(28rem,…) / min(18rem,…) / min(24rem,…) | popover sizing | 28/18/24rem layout constants |
| :428 | outline-offset | 1px | focus offset | app.css uses 2px offset globally — inconsistent (1px vs 2px) |
| :481,:541 | min-height | 1.5rem / 1.75rem | row height | 1.75rem off-scale |
| :493 | font-size | **0.72rem** | Google wordmark size | **off-token** → `--text-micro .75rem` |
| :495,:497 | letter-spacing | 0 | reset | fine |
| :526 | border-left | **2px** solid color-mix(var(--primary)…) | origin accent stripe | accent-stripe pattern; 2px off-scale |
| :583,:760 | @media | max-width: 760px | mobile breakpoint | **760px is an odd breakpoint** (site uses 768px elsewhere) — reconcile |
| :594-598 | width/height/min-height/border-radius | 2.75rem … / **999px** | mobile FAB | 2.75rem off-scale; **999px → `--radius-pill`** |

Off-scale rem: 35. Blur: 2. Hex: 4. This file is the messiest for one-offs.

## map/MapFilters.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :240,:271,:302,:333,:363,:396,:455 | inline style | `--chip:var(--…)` | pass state color via CSS var | **OK** — token-based inline var |
| :491 | backdrop-filter | blur(10px) saturate(1.1) | filter panel glass | **PATTERN** → `.glass-overlay` |
| :508,:516 | border-bottom | 1px solid color-mix(var(--mf-edge)…) | group divider | hairline (color token) |
| :574,:623,:719,:794 | text-transform/letter-spacing/transform | uppercase / **0.01em** / translateY(**0.5px**) | label tracking + active press | 0.01em **off-token**; 0.5px press-nudge one-off |
| :644-651 | background | linear-gradient(to right, color-mix(var(--mf-edge)…), transparent) | edge fade rule | token-colored gradient — OK geometry |
| :660,:667 | width/height | var(--mf-badge-size) / … | badge | token var — OK |
| :644,:648 | height/min-width | 1px / 0.5rem | fade line | hairline + 0.5rem OK |
| :760 | opacity | 0.5 | disabled clear | **off-token** |
| :779,:821 | box-shadow | 0 0 0 1px color-mix(var(--chip)…) | swatch ring | ad-hoc ring geometry (color token) — glow pattern |
| :803-805,:811-813,:862-864 | box-shadow | inset 0 0 0 1px … , 0 0 0 1px … / 0 0 6px … | active chip / swatch glow | ad-hoc ring+glow (color token) — candidate `.chip-active-ring` |
| :819 | border-radius | 50% | circular swatch | OK (circle) |
| :852-869 (.mf-glyph) | width/height/padding | 1.4rem / 1.4rem / **0.16rem** | filter glyph box | 1.4rem + 0.16rem off-scale |
| gaps/paddings | 0.3/0.35/0.4/0.45/0.55/0.6rem across group | tight spacing | micro-spacing tokens (26 off-scale total) |

Off-scale rem: 26. px: 21. Contains the only two non-fade custom gradients + multiple box-shadow ring/glow one-offs.

## map/MapMotionControl.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :171 | letter-spacing | 0.02em | label tracking | **off-token** |
| :178-180,:203,:219,:240,:269-271 | transition | var(--duration-fast,150ms) var(--ease-default, ease) | control transitions | fallback matches; PATTERN. Note `ease` fallback ≠ token cubic-bezier (harmless) |
| :215,:265 | border-radius | 50% | toggle knob circle | OK |
| :217 | box-shadow | 0 1px 2px color-mix(var(--foreground) 30%…) | knob drop shadow | ad-hoc shadow (color token) → `--shadow-*`? none fits a 1px knob shadow |
| :218,:222 | transform | translate(0,-50%) / translate(0.8rem,-50%) | toggle knob position | 0.8rem off-scale — layout constant for knob travel |
| :249 | border-radius | **2px** | track/pip radius | **off-token** → `--radius-sm 4px` (or intentional tighter) |
| gaps/paddings | 0.3–0.85rem register | control layout | micro-spacing tokens (14 off-scale) |

Off-scale rem: 14. px: 12.

## lines/reliability/RouteReliabilityClusters.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :650,:665 | gap | clamp(3rem,7vw,5rem) | band spacing | clamp — intentional, mirrors `--space-section-y`; consider using the token directly |
| :656 | --rail-sticky-top | 0px | sticky offset | 0px OK |
| :681,:752,:879 | padding | 0.5rem 0.8rem / 0.2rem 0.6rem / clamp(0.9rem,2.2vw,1.35rem) | chip/card padding | 0.8rem/1.35rem off-scale |
| :682,:685,:729,:742,:750,:808 | gap | 0.35rem / 0.3rem 0.6rem / 0.4rem 0.5rem / 0.45rem 0.75rem | grid gaps | micro-spacing tokens |
| :697,:698,:700 | width/height/margin | 1px / 1px / -1px | `.sr-only` visually-hidden | **Exempt** (a11y clip pattern) |
| :751 | min-height | **28px** | grain rail button height | **off-token** → 1.75rem or `--control-h` |
| :811,:823 | @media | min-width: 768px / max-width: 1023.98px | responsive | breakpoints |
| :853 | scroll-margin-top | 7rem | sticky-nav anchor offset | app.css sets this via `--nav-height`; this 7rem duplicates — reconcile |
| :867,:876 | border | 1px solid var(--border) | card border | hairline (color token) |
| :868 | padding-top | clamp(1.75rem,4vw,2.75rem) | section top | 2.75rem off-scale |
| :884 | border-inline-start | **3px** solid var(--border-rule) | section accent stripe | **accent-stripe pattern** (see below); 3px off-scale |

Off-scale rem: 12. px: 16.

## lines/reliability/sections/Section2TheWait.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :920,:949,:970,:975,:980,:988,:1011,:1016,:1025,:1065,:1148 | gap | 0.625rem / 0.75rem / clamp(1rem,2.5vw,1.75rem) / 0.5rem / 1.25rem / 0.35rem / 0.25rem 0.6rem / 0.6rem / 0.5rem 1rem | grid/stack gaps | 0.625/0.35/0.6 off-scale → micro-spacing tokens |
| :929,:931 | gap/padding-inline-start | 0.3rem / 0.7rem | callout indent | micro-spacing token |
| :932 | border-inline-start | **3px** solid var(--accent-text) | callout accent stripe | **accent-stripe pattern**; 3px off-scale |
| :1026,:1078,:1121,:1131,:1168 | padding | 0.3rem 0 / 0.4rem 0.6rem / 0.5rem 0 / 0.15rem 0 | table padding | micro-spacing tokens |
| :1029,:1088,:1098,:1122 | border-top/bottom | 1px solid color-mix(in oklab, var(--border) 60%…) / 1px solid var(--border) | table rules | hairline (color token) |
| :1032,:1041 | flex-basis/min-width | 7rem / 3.25rem | table col widths | 3.25rem off-scale |
| :1086,:1139 | letter-spacing | 0.04em | table-head tracking | **off-token** |
| :1102 | @media | max-width: 28rem | table reflow bp | breakpoint |
| :1115,:1116 | width/height | 1px / 1px | `.sr-only` clip | **Exempt** (a11y) |
| :1125,:1168 | margin | 0.2rem / 0.25rem 0 0 | rhythm | micro-spacing token |

Off-scale rem: 14. px: 7.

## map/MapFilterPill.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :101 | z-index | var(--z-sheet) via class `z-sheet` | overlay stacking | **OK** (token) |
| :115 | text-transform | uppercase | label | OK |
| :122,:211 | backdrop-filter | blur(10px)/blur(12px) saturate(1.1) | pill + popover glass | **PATTERN** → `.glass-overlay` |
| :141 | border-radius | **999px** | pill shape | **off-token** → `--radius-pill 9999px` |
| :147 | box-shadow | 0 0 0 3px color-mix(var(--primary) 22%…) | active focus ring | ad-hoc ring (color token) |
| :176 | box-shadow | inset 0 0 0 1px var(--border-subtle) | inner hairline | ad-hoc inset ring (color token) |
| :190 | z-index | **-1** | pseudo behind | intra-overlay micro z; small negative — keep, no token fits |
| gaps/paddings | micro register | pill layout | micro-spacing tokens (7 off-scale) |

Off-scale rem: 7. px: 15.

## map/MapDetailAlerts.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :86,:187 | text-transform | uppercase | labels | OK |
| :151,:160 | opacity | 0.55 / 1 | dim/active | 0.55 **off-token** → .6 |
| :161 | transform | translateX(2px) | hover nudge | **PATTERN** → `.row-hover-nudge` |
| gaps/paddings | 0.3–0.85rem register (10 off-scale) | alert row layout | micro-spacing tokens |
| :7 px lines | 1px/2px hairlines | rules/borders | hairline (color token) |

Off-scale rem: 10. px: 7.

## lines/RouteDetail.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :577,:586 | opacity | 0.45 / 1 | dim/active row | 0.45 **off-token** |
| :587 | transform | translateX(2px) | hover nudge | **PATTERN** → `.row-hover-nudge` |
| gaps/paddings | micro register (8 off-scale) | detail layout | micro-spacing tokens |
| px (13) | 1px hairlines + widths | borders | hairline (color token) |

Off-scale rem: 8. px: 13.

## lines/reliability/ReliabilityFilterPill.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :99 | z-index | var(--z-sheet) via `z-sheet` | popover | **OK** (token) |
| :117,:185 | backdrop-filter | blur(10px)/blur(12px) saturate(1.1) | glass | **PATTERN** → `.glass-overlay` (near-duplicate of MapFilterPill) |
| :137 | border-radius | **999px** | pill | **off-token** → `--radius-pill` |
| :160 | z-index | **-1** | pseudo behind | intra-overlay micro z |
| gaps/paddings | micro register (6 off-scale) | pill layout | micro-spacing tokens |

Off-scale rem: 6. px: 13. Nearly a clone of MapFilterPill — the two pills should share a primitive.

## map/MapOverlayChrome.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :185 | z-index | **10** | left nav overlay | intra-overlay band (2–32); no token — candidate `--z-map-nav` sub-scale |
| :195 | z-index | **24** | detail overlay above nav | intra-overlay band |
| :200,:229 | border-top | **2px** solid var(--border-rule) | overlay accent stripe | accent-stripe pattern; 2px off-scale |
| :207,:232 | backdrop-filter | blur(10px) saturate(1.05) | overlay glass (note **1.05** not 1.1) | **PATTERN** → `.glass-overlay` (inconsistent saturate value) |
| :219 | z-index | **12** | filter overlay | intra-overlay band |
| gaps/paddings | micro register (6 off-scale) | chrome layout | micro-spacing tokens |

Off-scale rem: 6. px: 11. The z-index 10/12/24 trio is the clearest case for a named intra-overlay z sub-scale.

## map/MapHeadTitle.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :40 | z-index | **10** | title overlay | intra-overlay band |
| :51 | border-left | **2px** solid var(--border-rule) | title accent stripe | accent-stripe pattern; 2px off-scale |
| :67 | text-transform | uppercase | eyebrow | OK |
| :81 | letter-spacing | **-0.01em** | title tightening | **off-token** → `--tracking-tight -0.025em` |
| gaps/paddings | micro register (6 off-scale) | title layout | micro-spacing tokens |

Off-scale rem: 6. px: 4.

## map/MapFreshness.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :43 | z-index | **10** | freshness pill overlay | intra-overlay band |
| :53,:106 | backdrop-filter | blur(10px)/blur(8px) saturate(1.1) | glass (note **8px** variant) | **PATTERN** → `.glass-overlay` (yet another blur value) |
| :55,:56,:57 | transition | **right 180ms** var(--ease-out,…), border/bg var(--duration-fast,150ms)… | slide + color | 180ms bare literal (no token); rest fallback-matched |
| gaps/paddings | micro register (6 off-scale) | pill layout | micro-spacing tokens |

Off-scale rem: 6. px: 5. Blur value **8px** here vs 10px elsewhere — inconsistency.

## lines/reliability/sections/Section1WhenToRide.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :610 | border-top | 1px solid color-mix(in oklab, var(--border) 60%…) | rule | hairline (color token) |
| gaps/paddings | micro register (6 off-scale) | section layout | micro-spacing tokens |
| px (3) | 1px hairlines | rules | hairline |

Off-scale rem: 6. px: 3.

## lines/LineDirections.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :170,:173 | border-bottom | 1px solid var(--border-subtle, var(--border)) / none | row divider | hairline (color token) |
| :223 | letter-spacing | 0.01em | label tracking | **off-token** |
| :257,:269 | opacity | 0.45 / 1 | dim/active | 0.45 **off-token** |
| :270 | transform | translateX(2px) | hover nudge | **PATTERN** → `.row-hover-nudge` |
| gaps/paddings | micro register (6 off-scale) | list layout | micro-spacing tokens |

Off-scale rem: 6. px: 4.

## lines/reliability/sections/Section3RunAndFit.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| gaps/paddings | micro register (5 off-scale) | section layout | micro-spacing tokens |
| px (1) | 1px hairline | rule | hairline |

Off-scale rem: 5. px: 1.

## lines/LinesIndex.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :245 | text-transform | uppercase | label | OK |
| gaps/paddings | micro register (4 off-scale) | index layout | micro-spacing tokens |
| px (4) | 1px hairlines | borders | hairline (color token) |

Off-scale rem: 4. px: 4.

## map/MapFeedStallBanner.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :83 | z-index | **10** | banner overlay | intra-overlay band |
| :95 | z-index | **13** | banner-content stacking | intra-overlay band |
| :107 | border-top | **2px** solid color-mix(var(--dataviz-status-late)…, var(--border-rule)…) | warning accent stripe | accent-stripe pattern; 2px off-scale (color token) |
| :110 | backdrop-filter | blur(10px) saturate(1.05) | glass | **PATTERN** → `.glass-overlay` |
| gaps/paddings | micro register (3 off-scale) | banner layout | micro-spacing tokens |

Off-scale rem: 3. px: 5.

## map/MapDelayTag.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :43 | font-size | inherit | inherit parent | OK |
| :45 | letter-spacing | 0.01em | tag tracking | **off-token** |
| gaps/paddings | micro register (3 off-scale) | tag layout | micro-spacing tokens |

Off-scale rem: 3.

## lines/reliability/sections/MetricBullet.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| gaps/paddings | micro register (3 off-scale) | bullet layout | micro-spacing tokens |
| px (1) | 1px hairline | rule | hairline |

Off-scale rem: 3.

## map/MapHero.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :1229 | class | z-5 / z-10 (Tailwind) | canvas stacking | **Tailwind z-5/z-10 utilities** — not token-mapped (site z-scale is 30/50/60/70); intra-overlay micro-z, acceptable but off the named z ladder |
| gaps/paddings | micro register (2 off-scale) | hero layout | micro-spacing tokens |
| px (3) | 1px hairlines | borders | hairline |

Off-scale rem: 2. Mostly a logic file; little inline visual.

## map/MapDetailOverlay.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :149 | z-index | **32** | detail overlay panel | intra-overlay band (just above --z-rail 30) — candidate token |
| :154 | transition | width var(--duration-normal, **180ms**) … | width slide | **MISMATCHED fallback** — `--duration-normal` is 200ms, fallback says 180ms |
| :177 | z-index | **1** | inner content | = --z-content; use token |
| :180,:190 | opacity | 0 / 1 | collapse fade | OK (0/1) |
| :182,:183 | transition | opacity/background var(--duration-fast, **140ms**) … | fade | **MISMATCHED fallback** — `--duration-fast` is 150ms, fallback says 140ms |
| gaps/paddings | micro register (2 off-scale) | overlay layout | micro-spacing tokens |

Off-scale rem: 2. px: 3. Notable for two **wrong** `var(--token, LITERAL)` fallbacks.

## map/MapSurfaceCanvasLayer.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :40 | z-index | **1** | base canvas | = --z-content; use token |
| :41 | border-radius | 0 | reset | OK |
| :51 | z-index | **5** | overlay-above-canvas | intra-overlay band |
| :54-65 | background | linear-gradient(…) + radial-gradient(…) | vignette/scrim | **inspect colors** — see note below |
| :10,:11 | class | z-1 / z-5 / z-10 | Tailwind stacking | off the named z ladder |

Off-scale rem: 0. Gradient colors: read confirmed token-based (uses `color-mix`/vars) — geometry ad-hoc but acceptable scrim. z-index 1/5 should map to `--z-content` + a named sub-token.

## lines/reliability/sections/CollapsibleSection.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| gaps/paddings | on-scale mostly | section header/body | OK |
| px (2) | 1px hairlines | rules | hairline (color token) |

Off-scale rem: 0. Clean.

## lines/reliability/sections/Section0Verdict.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| gaps/paddings | micro register (2 off-scale) | verdict layout | micro-spacing tokens |

Off-scale rem: 2.

## lines/reliability/sections/Section4WorstStops.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| gaps/paddings | micro register (2 off-scale) | list layout | micro-spacing tokens |
| px (1) | 1px hairline | rule | hairline |

Off-scale rem: 2.

## lines/reliability/sections/VerdictBanner.svelte

| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :32 | inline style | `--verdict-accent: ${color}` | pass verdict color as var | **OK** — color originates from a token-mapped verdict scale (verify `color` source is a `--dataviz-*`/token) |
| px (1) | 1px hairline | rule | hairline |

Off-scale rem: 0.

## map/MapDetailOverlayHarness.svelte / MapFilterPillHarness.svelte / MapOverlayChromeHarness.svelte

Test harnesses (render scaffolds). Inline visual values are test-fixture layout only — **low priority / exempt**. No brand-facing surface. (Confirmed no hex/blur/arbitrary values; only benign flex/gap wrappers.)

---

## Accent-stripe pattern roll-up (candidate named pattern #4)

The `2px/3px solid var(--border-rule|--accent-text|--primary|--dataviz-status-late)` left/top accent stripe recurs 9×:
- MapHeadTitle:51 (border-left 2px --border-rule)
- MapOverlayChrome:200,229 (border-top 2px --border-rule)
- MapFeedStallBanner:107 (border-top 2px, warn color)
- MapNearMeControl:526 (border-left 2px --primary)
- MapSelectionDetail:726,856 (width:3px accent bar via pseudo)
- Section2TheWait:932 (border-inline-start 3px --accent-text)
- RouteReliabilityClusters:884 (border-inline-start 3px --border-rule)

Colors are token-based; only the **width (2px/3px)** is off-scale/ad-hoc and inconsistent (2 vs 3). Candidate: `.accent-stripe` utility with a `--stripe-w` (single value) + `--stripe-color` var.

## Intra-overlay z-index band roll-up (candidate named pattern #5)

Values 1, 2, 5, 10, 12, 13, 24, 32, -1 sit *between* `--z-content (1)` and `--z-rail (30)` — an unnamed micro-ladder the map overlays improvise (MapOverlayChrome 10/12/24, MapDetailOverlay 32, MapFreshness/MapHeadTitle/MapNearMeControl/MapFeedStallBanner 10/13, MapSurfaceCanvasLayer 1/5). Candidate: named tokens `--z-map-canvas`, `--z-map-overlay`, `--z-map-detail` so the stacking order is legible and collision-safe. The Tailwind `z-1/z-5/z-10` classes (MapHero:1229, MapSurfaceCanvasLayer, MapHero) are the same band expressed as utilities.

## Exemptions (census hits that are legitimately off-token)

- **MarkerGlyph.svelte** — all `x/y/width/height/rx/r/cx/cy` are SVG sprite drawing coordinates (viewBox 0 0 26 26), not theme spacing. Exempt.
- **Google wordmark hex** (MapNearMeControl :499/:503/:506/:509) — Google's brand palette; cannot be tokenized to the transit scale. Exempt-by-brand, but should be named locally.
- **`.sr-only` clip** (`width:1px;height:1px;margin:-1px`) — RouteReliabilityClusters:697-700, Section2TheWait:1115-1116. Standard a11y visually-hidden. Exempt.
- **`50%` / `999px` circles**, **`0`/`0px` resets**, **`0`/`1` opacity**, **`inherit`** — not off-token debt (999px is the one exception: should be `--radius-pill`).
- **Breakpoint px/rem** (768/1024/760/28rem/42rem/21rem/17rem) — responsive breakpoints; a shared breakpoint-token set would help but these aren't "vibe" debt per se. Note **760px** (MapNearMeControl) and **1023.98px** (RouteReliabilityClusters) diverge from the 768/1024 used elsewhere — reconcile.

## Cross-file inconsistencies worth flagging

- **blur radius drifts:** 8px (MapFreshness:106) / 10px (most) / 12px (popovers). **saturate:** 1.05 (MapOverlayChrome, MapFeedStallBanner) vs 1.1 (everywhere else). No single glass value.
- **transition fallbacks:** 47 lines use `var(--duration-*, LITERAL)`; 3 fallbacks are **wrong** (MapDetailOverlay:154 `--duration-normal,180ms` should be 200ms; :182/:183 `--duration-fast,140ms` should be 150ms) and 2 are **bare literals** with no token (MapNearMeControl:290, MapFreshness:55 `right 180ms`).
- **outline-offset:** MapNearMeControl:428 uses 1px vs the global 2px focus offset (app.css) everywhere else.
- **opacity register:** 0.45 / 0.5 / 0.55 / 0.75 used for dim states, none matching `--opacity-{muted .6, dim .3}`. A "dim" token gap.
- **letter-spacing register:** -0.01 / 0.01 / 0.02 / 0.04em, none matching `--tracking-{tight -0.025, wide .05, eyebrow .1}`. A micro-tracking token gap.
