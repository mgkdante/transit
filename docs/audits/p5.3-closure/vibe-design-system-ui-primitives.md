# VIBE + STYLE CENSUS — Design-system / UI primitives

**Scope:** `apps/web/src/lib/components/{ui,brand,dataviz,edge,shared}/` + loose files (`CodeBlock.svelte`, `SeoHead.svelte`, `sql-highlight.ts`, `index.ts`). READ-ONLY analysis. Test files (`*.test.ts`) excluded.

**Token vocabulary (the "on-token" baseline), confirmed from `src/app.css` + `src/lib/styles/tokens.css`:**
- **Radius:** `--radius-sm 4px` / `--radius-md 8px` / `--radius-lg 12px` / `--radius-xl 16px` / `--radius-pill 9999px` → `rounded-{sm,md,lg,xl,pill}`.
- **Opacity:** `--opacity-muted .6` / `--opacity-dim .3` / `--opacity-subtle .15` / `--opacity-faint .05`.
- **Duration:** `--duration-instant 100ms` / `--duration-fast 150ms` / `--duration-normal 200ms` / `--duration-slow 300ms` / `--duration-slower 500ms`.
- **Easing:** `--ease-default`/`--ease-out`/`--ease-in-out`/`--ease-bounce` (all cubic-bezier).
- **Z-index:** `--z-base 0` / `--z-content 1` / `--z-rail 30` / `--z-sheet 50` / `--z-menu 60` / `--z-nav 70` (Tailwind `z-index-*`).
- **Type scale:** `--text-{hero,display,title,heading,subheading,body,small,control,tag,mono,caption,micro}` → `text-{name}`.
- **Spacing:** Tailwind default rem scale (`p-2`, `gap-3`, etc.) is on-scale; **arbitrary bracket values and raw `rem`/`px` in `<style>` are off-token**.
- **NO shadow/blur/backdrop tokens for arbitrary blur radii; NO letter-spacing token beyond `--tracking-{eyebrow,tight,wide}`.**

**Rule applied:** values sourced from a token (`var(--…)`, or a Tailwind theme utility) are FINE and NOT flagged. Only genuinely off-token literals below. Dynamic runtime bindings (`style="color: {color}"` where `color` resolves to a token var) are noted as *legit-dynamic* and not counted as defects.

---

## Category note on "legit-dynamic" inline styles (NOT counted as hits)
These `style=` attributes carry values that resolve to tokens or to geometry that must be computed at runtime; they are correct and listed only for completeness:
- `brand/MetroStation.svelte:42` `animation-delay: {pulseDelay}s` — per-instance stagger, computed.
- `dataviz/StatusBadge.svelte:63,84,100` `color: {color}` — `color` is a dataviz token var.
- `dataviz/ChartLegend.svelte:70,79`; `dataviz/ChartTooltip.svelte:205`; `dataviz/chart/marks/StackedShareMark.svelte:104`; `dataviz/chart/marks/SparklineMark.svelte:70,74`; `dataviz/chart/marks/LineMark.svelte:104,111,118`; `dataviz/DeltaStat.svelte:78`; `dataviz/RankedRow.svelte:262`; `dataviz/SeverityBar.svelte:158,183` — fill/stroke/color = dataviz token var (`item.colorVar`, `colorOf()`, `deltaVar`).
- `brand/StickyPanel.svelte:27` `top: {top}` — prop-driven sticky offset.
- `ui/toggle-group/toggle-group.svelte:70` `--gap: {spacing}` — sets a custom prop consumed on-scale.
- `ui/dialog/dialog-overlay.svelte:22`, `ui/dialog/dialog-content.svelte:28`, `ui/sheet/sheet-content.svelte:57`, `ui/sheet/sheet-overlay.svelte:22` — `z-index: var(--z-index-menu/sheet) [+1]` (token-based; the `+1` is a defensible stacking nudge but see §Z-INDEX).
- `edge/EdgeState.svelte:393` `--edge-rule: {accent.rule}`; `403` `font-size: var(--text-heading)` — token-based.
- `shared/CollapsibleSection.svelte:158` `--accent: {accentColor}` — sets custom prop (but `140` sets a hardcoded fallback bg, see below).

---

## brand/

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| brand/BrandCluster.svelte:50 | text-[…] font-size | `text-[0.625rem]` | tiny "LIVE" caption below the micro scale | map to `text-micro` (0.75rem) or add a `--text-nano` token; DELETE bracket |
| brand/BrandCluster.svelte:61 | color (arb) | `text-[var(--foreground)]` | wants foreground color | use `text-foreground` utility; DELETE bracket |
| brand/BrandCluster.svelte:73-74 | width/height | `2px` / `18px` | divider bar dims | `2px`→hairline pattern; `18px`→map to `h-4.5`/token; name **divider-bar** pattern |
| brand/BrandCluster.svelte:84 | gap | `0.5rem` | flex gap | use `gap-2` scale |
| brand/BrandCluster.svelte:93,124 | outline-offset | `2px` | focus ring offset | recurring 2px focus offset → name **focus-offset** pattern |
| brand/BrandCluster.svelte:98 | font-size | `1rem` | product label | map to `--text-body` (1.0625) or `text-small` |
| brand/BrandCluster.svelte:108-109 | width/height | `2px` / `18px` | second divider bar (dup of 73-74) | same **divider-bar** pattern |
| brand/BrandCluster.svelte:115 | letter-spacing | `-0.01em` | tighten wordmark | map to `--tracking-tight` |
| brand/BrandCluster.svelte:129 | @media max-width | `760px` | breakpoint | off Tailwind breakpoint scale (sm=640/md=768); align to `md` |
| brand/BrandCluster.svelte:137 | gap | `0.35rem` | condensed gap | off-scale rem; snap to `gap-1.5` |
| brand/BrandCluster.svelte:140 | font-size | `0.98rem` | near-body size | magic rem; map to `--text-small`/`--text-body` |
| brand/ChevronToggle.svelte:37 | color (arb) | `text-[var(--muted-foreground)]` | muted color | use `text-muted-foreground`; DELETE bracket |
| brand/CornerMarks.svelte:21 | arm length map | `{ sm: 12, md: 32 }` | crop-mark arm px | off-scale px constants → tie to spacing scale |
| brand/CornerMarks.svelte:28 | inline `--arm`/`--mark-opacity` | `{arm}px`, `{opacity}` | prop-driven (arm px off-scale; opacity may be off-token) | arm px off-scale; verify opacity prop maps to `--opacity-*` |
| brand/MetricDisplay.svelte:99 | color (arb) | `text-[var(--muted-foreground)]` | muted sublabel | use `text-muted-foreground`; DELETE bracket |
| brand/MetricDisplay.svelte:109 | line-height | `1.2` | heading leading | on-scale-ish; map to a `leading-*` utility |
| brand/MetroStation.svelte:91-92 | width/height | `32px` / `32px` | roundel size | map to `size-8` (2rem) |
| brand/MetroStation.svelte:105-106 | width/height | `2rem` / `2rem` | roundel size (dup of 91-92 in rem) | `size-8`; consolidate the two roundel sizings |
| brand/MetroStation.svelte:113 | line-height | `1` | tight roundel number | `leading-none` |
| brand/MetroStation.svelte:114 | letter-spacing | `0.02em` | slight track | off-token; nearest `--tracking-wide`? verify |
| brand/MetroStation.svelte:121 | min-height | `20px` | label min height | off-scale px; snap to `h-5` |
| brand/SectionHeading.svelte:53 | font-size | `clamp(2.5rem, 6vw, 4rem)` | fluid heading | overlaps `--text-display` clamp(2.5,5vw,4) — reuse `--text-display` token |
| brand/SectionHeading.svelte:56 | letter-spacing | `-2px` | tighten display | px tracking off-token; map to `--tracking-tight` |
| brand/SectionHeading.svelte:57 | margin-block-end | `6px` | spacing | snap to `mb-1.5` scale |
| brand/SectionHeading.svelte:67 | letter-spacing | `2px` | eyebrow track | overlaps `--tracking-eyebrow`/`--tracking-wide`; reuse token |
| brand/SectionHeading.svelte:69 | margin-block-end | `36px` | spacing | off-scale; snap to `mb-9` (2.25rem) |
| brand/StickyPanel.svelte:39 | padding | `1.25rem` | panel pad | `p-5` scale |
| brand/StickyPanel.svelte:41 | max-height | `calc(100dvh - 8rem)` | viewport-fit | `8rem` magic offset; document/derive from header height |
| brand/StopLabel.svelte:30 | letter-spacing | `2px` | label track | reuse `--tracking-eyebrow`/`--tracking-wide` |
| brand/StopLabel.svelte:33 | padding-left | `16px` | room for dot | `pl-4` scale |
| brand/StopLabel.svelte:51-52 | width/height | `7px` / `7px` | status dot | off-scale odd px; name **status-dot-sm** or snap to `size-2` |
| brand/TerminalChrome.svelte:109,110,117,124,125,136,151,160,161,168 | gap/padding/margin | `0.75rem`,`0.5rem 0.75rem`,`0.5rem`,`0.25rem`,`0.25rem`,`0.125rem 0.375rem`,`0.75rem 1rem`,`1.5rem`,`0.5rem 0.75rem`,`0.5rem` | chrome bar spacing | all on Tailwind rem grid → convert to `gap-*`/`p-*`/`m-*` utilities; no new token needed |

## shared/

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| shared/CollapsibleSection.svelte:140 | inline style bg fallback | `background-color: ${accentColor}` (else `''`) | accent chip bg from prop | accentColor should be a token var; ensure caller passes `--dataviz-*` |
| shared/CollapsibleSection.svelte:147 | color (arb) | `text-[var(--foreground)]` | title color | use `text-foreground`; DELETE bracket |
| shared/CollapsibleSection.svelte:193/196 | border-width | `3px` | section-card accent rule | **3px accent-stripe** repeated pattern (see alert/EdgeState) |
| shared/CollapsibleSection.svelte:214,217-218 | transition | `scale 120ms cubic-bezier(0.2,0,0,1)`, `opacity 120ms cubic-bezier(...)` | press micro-motion | `120ms` + inline bezier are OFF the motion tokens → add `--duration-press`/reuse `--duration-instant`+`--ease-out` |
| shared/CollapsibleSection.svelte:233 | opacity | `0.92` | pressed dim | off-token opacity; nearest none — either add token or use `--opacity-muted`? (0.92 has no match) |
| shared/Detail.svelte:77 | gap | `0.45rem` | row gap | off-scale rem; snap to `gap-2` |
| shared/Detail.svelte:79 | min-height | `44px` | tap target | **44px tap-target** recurring (a11y min) → name **tap-target-min** pattern |
| shared/Detail.svelte:80 | padding | `0.4rem 0.15rem` | tap padding | off-scale rem; snap to scale |
| shared/Detail.svelte:96,105 | text-underline-offset | `3px` | underline offset | off-token; small; name **underline-offset** or accept |
| shared/Detail.svelte:100 | outline-offset | `3px` | focus offset | inconsistent with 2px elsewhere → unify **focus-offset** |
| shared/Detail.svelte:119 | gap | `clamp(1.75rem, 4vw, 2.75rem)` | fluid grid gap | one-off fluid clamp; document or tokenize |
| shared/Detail.svelte:120 | padding-top | `1.5rem` | `pt-6` scale | convert to utility |
| shared/TocNav.svelte:136 | tracking (arb) | `tracking-[1.5px]` | counter track | px tracking off-token → `--tracking-wide` |
| shared/TocNav.svelte:146 | font-size | `16px` | nav label | map to `--text-body`/`text-small` |
| shared/TocNav.svelte:148 | padding-left | `14px` | indent | off-scale px; snap `pl-3.5` |
| shared/TocNav.svelte:151 | gap | `2px` | tight gap | `gap-0.5` |
| shared/TocNav.svelte:157 | gap | `0.55rem` | off-scale rem | snap `gap-2` |
| shared/TocNav.svelte:164 | min-height | `44px` | tap target | **tap-target-min** pattern |
| shared/TocNav.svelte:180 | outline-offset | `2px` | focus offset | **focus-offset** |
| shared/TocNav.svelte:181 | border-radius | `2px` | tiny radius | below `--radius-sm` (4px); add `--radius-xs` or use `sm` |
| shared/TocNav.svelte:190 | min-width | `1.5rem` | counter box | `w-6` scale |
| shared/TocNav.svelte:201 | font-size | `13px` | child label | map to `--text-caption` (0.8125rem=13px) — exact token match, USE IT |
| shared/TocNav.svelte:202 | min-height | `36px` | child tap | off-scale; snap `h-9` |
| shared/TocNav.svelte:215-216 | width/height | `6px` / `6px` | bullet dot | off-scale; name **status-dot** / `size-1.5` |
| shared/TocPill.svelte:162 | bottom | `calc(20px + env(safe-area-inset-bottom,0px))` | float offset | `20px` magic; snap `1.25rem` |
| shared/TocPill.svelte:171 | gap | `8px` | `gap-2` | convert |
| shared/TocPill.svelte:172 | padding | `12px 20px` | pill pad | `py-3 px-5` scale |
| shared/TocPill.svelte:173 | min-height | `44px` | tap target | **tap-target-min** |
| shared/TocPill.svelte:175 | max-width | `calc(100vw - 2rem)` | viewport-fit | acceptable calc; keep |
| shared/TocPill.svelte:179 | backdrop-filter | `blur(8px)` | glass | **blur** literal off-token → add `--blur-sm`/`--blur-md` tokens |
| shared/TocPill.svelte:203 | z-index | `-1` | behind pseudo | local stacking; acceptable but note no token for negative |
| shared/TocPill.svelte:210 | bottom | `calc(100% + 8px)` | popover offset | `8px` magic; snap scale |
| shared/TocPill.svelte:213 | min-width | `280px` | popover width | off-scale px; tokenize popover width |
| shared/TocPill.svelte:222 | border-radius | `12px` | = `--radius-lg` | USE `var(--radius-lg)`/`rounded-lg` |
| shared/TocPill.svelte:223 | backdrop-filter | `blur(12px)` | glass | **blur** literal → `--blur-md` token |
| shared/TocPill.svelte:230 | gap | `10px` | off-scale | snap `gap-2.5` |
| shared/TocPill.svelte:231 | padding | `12px 14px` | pill pad | off-scale (14px); snap scale |
| shared/TocPill.svelte:232 | min-height | `44px` | tap | **tap-target-min** |
| shared/TocPill.svelte:235 | border-radius | `8px` | = `--radius-md` | USE `var(--radius-md)`/`rounded-md` |
| shared/TocPill.svelte:238 | font-size | `14px` | item label | map to `text-small` (0.9375=15px) or add token |
| shared/TocPill.svelte:240,242-243 | transition | multi (uses tokens) | — | OK (token-based) |
| shared/TocPill.svelte:252 | min-width | `1.75rem` | counter box | `w-7` scale |
| shared/TocPill.svelte:273 | outline-offset | `2px` | focus | **focus-offset** |
| shared/TocPill.svelte:278 | padding-left | `40px` | indent | off-scale; snap `pl-10` |
| shared/TocPill.svelte:279 | font-size | `13px` | = `--text-caption` (13px) | USE `var(--text-caption)` |

## edge/

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| edge/AbsentValue.svelte:101 | gap | `0.3rem` | off-scale rem | snap `gap-1` |
| edge/AbsentValue.svelte:103 | padding | `0.18rem 0.55rem` | chip pad | off-scale rem; snap scale |
| edge/AbsentValue.svelte:108 | line-height | `1.3` | text leading | `leading-*` utility |
| edge/AbsentValue.svelte:126 | gap | `0.4rem` | off-scale | snap `gap-1.5` |
| edge/AbsentValue.svelte:128 | padding | `1.5rem` | `p-6` scale | convert |
| edge/AbsentValue.svelte:139 | max-width | `24rem` | copy width | `max-w-sm` (24rem) — exact; USE utility |
| edge/AbsentValue.svelte:148 | line-height | `1` | glyph | `leading-none` |
| edge/EdgeState.svelte:408 | color (arb) | `text-[var(--foreground)]` | title color | use `text-foreground`; DELETE bracket |
| edge/EdgeState.svelte:411 | color (arb) | `text-[var(--muted-foreground)]` | subtitle | use `text-muted-foreground`; DELETE bracket |
| edge/EdgeState.svelte:449/451 | border-top | `3px solid var(--edge-rule)` | accent bar | **3px accent-stripe** pattern (color IS a token) |
| edge/EdgeState.svelte:465 | padding | `0.5rem 1.25rem` | button pad | `py-2 px-5` scale |
| edge/EdgeState.svelte:467/475 | transition | `background 150ms ease` | hover | `150ms`+`ease` should be `var(--duration-fast) var(--ease-default)` |

## ui/

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| ui/alert/alert.svelte:15 | arbitrary grid | `grid-cols-[0_1fr]`, `has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr]` | icon/content grid | structural grid template; token-derived calc — acceptable, keep |
| ui/alert/alert.svelte:63/68 | border-left-width | `3px` | severity stripe | **3px accent-stripe** pattern (color = dataviz token) |
| ui/badge/badge.svelte:39 | text-[…] | `text-[0.6875rem]` | xs badge text | below scale; map to `--text-micro` or add `--text-nano` |
| ui/button/button.svelte:35,40 | rounded-[…] | `rounded-[min(var(--radius-md),10px)]` | clamp radius on xs | token-derived clamp; intentional but **repeated 4×** → extract shared `--radius-control-xs` |
| ui/button/button.svelte:36,42 | rounded-[…] | `rounded-[min(var(--radius-md),12px)]` | clamp radius sm | same; **repeated** → `--radius-control-sm` |
| ui/button/button.svelte:36 | text-[…] | `text-[0.8rem]` | sm button text | magic rem; map to `--text-small`/`--text-caption` |
| ui/card/card-header.svelte:17 | arbitrary grid | `grid-cols-[1fr_auto]`, `grid-rows-[auto_auto]` | header layout | structural template; keep |
| ui/card/card.svelte:36 | border | `2px solid var(--border-brand)` | panel edge | **2px brand-panel-border** recurring (card + others); tokenize `--border-width-panel` |
| ui/card/card.svelte:40 | box-shadow | `inset 0 1px 0 var(--edge-highlight)` | top bevel | **bevel-highlight** pattern (1px inset, token color) → extract |
| ui/collapsible/collapsible-content.svelte:49-51 | transition | grid-template-rows/opacity `var(--duration-slow) var(--ease-default)` | expand | OK (token-based) |
| ui/dialog/dialog-content.svelte:30 | max-w-[…] | `max-w-[calc(100%-2rem)]` | mobile inset | structural; keep (calc) |
| ui/dialog/dialog-content.svelte:28 | inline z-index | `calc(var(--z-index-menu) + 1)` | above overlay | token+1; acceptable stacking nudge |
| ui/line-combobox/line-combobox.svelte:193 | padding | `0.5rem 3.75rem 0.5rem 0.75rem` | input w/ affordances | `3.75rem` right pad = space for buttons; off-scale, derive |
| ui/line-combobox/line-combobox.svelte:194 | line-height | `1.4` | input leading | `leading-*` |
| ui/line-combobox/line-combobox.svelte:201,273 | outline-offset | `2px` | focus | **focus-offset** |
| ui/line-combobox/line-combobox.svelte:209-210 | width/height | `1.75rem` | clear/chevron btn | `size-7` scale |
| ui/line-combobox/line-combobox.svelte:219 | right | `2rem` | affordance pos | `right-8` scale |
| ui/line-combobox/line-combobox.svelte:223 | right | `0.25rem` | affordance pos | `right-1` scale |
| ui/line-combobox/line-combobox.svelte:247,253,294 | padding | `0.25rem`, `0.5rem 0.625rem`, `0.625rem 0.75rem` | menu/item pad | on rem grid → utilities |
| ui/line-combobox/line-combobox.svelte:252 | gap | `0.5rem` | `gap-2` | convert |
| ui/scroll-area/scroll-area.svelte:32 | rounded-[…], ring-[…] | `rounded-[inherit]`, `ring-[3px]` | inherit radius + 3px ring | `rounded-[inherit]` OK; `ring-[3px]` off-scale (ring default 3 is fine) — keep or use `ring` |
| ui/separator/separator.svelte:28 | stripeWidth map | `{ sm:6, md:8, lg:12 }` | hazard stripe px | off-scale px constants driving gradient stops |
| ui/separator/separator.svelte:29-30 | h-[…]/w-[…] | `h-[3px]`,`w-[3px]` | thin hazard bar sm | off-scale; other sizes use `h-1.5`/`h-2.5` (on-scale) — inconsistent |
| ui/separator/separator.svelte:97 | height | `2px` | gradient line | off-scale; `h-0.5` |
| ui/sheet/sheet-content.svelte:14 | max-h-[…] | `max-h-[90svh]` | bottom sheet | viewport unit; keep (no token for svh) |
| ui/skeleton/skeleton.svelte:31 | animation | `pulse 2s cubic-bezier(0.4,0,0.6,1) infinite` | shimmer | `2s`+inline bezier OFF motion tokens → add `--duration-pulse` or reuse token |
| ui/skeleton/skeleton.svelte:40 | opacity | `0.5` | pulse trough | off-token; nearest none (0.5) → tokenize or use `--opacity-*` |
| ui/tabs/tabs-list.svelte:9 | p-[…] | `p-[3px]` | list inset | off-scale 3px; snap `p-0.5`(2px)/`p-1`(4px) |
| ui/tabs/tabs-trigger.svelte:17 | h-[…] | `h-[calc(100%-1px)]` | fill minus border | structural calc; keep |
| ui/tabs/tabs-trigger.svelte:28 | bottom-[…] | `after:bottom-[-1px]` | underline align | 1px hairline align; keep |
| ui/toggle/toggle.svelte:19 | rounded-[…] | `rounded-[min(var(--radius-md),12px)]` | clamp radius | same **--radius-control-sm** dup as button |
| ui/toggle-group/toggle-group.svelte:72 | rounded-[…], gap-[…] | `rounded-[min(var(--radius-md),10px)]`, `gap-[--spacing(var(--gap))]` | clamp radius + var gap | radius = **--radius-control-xs** dup; gap = token-derived, keep |

## Loose files

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| SeoHead.svelte:74 | themeColor default | `'#141414'` | `<meta theme-color>` fallback | hardcoded hex — map to `--background` dark value; source from token at build |
| CodeBlock.svelte:56-59 | `--code-*` (dark) | `#c98a5e`,`#7fae6f`,`#c98fd6`,`#6fa8c9` | syntax-highlight palette (dark) | off-token hex palette; define as `--dataviz-code-*` tokens in tokens.css |
| CodeBlock.svelte:76-79 | `--code-*` (light) | `#9a4a14`,`#3f6e2c`,`#7d3b8f`,`#245a73` | syntax palette (light) | off-token hex; tokenize alongside dark set |
| CodeBlock.svelte:85 | gap | `0.5rem` | `gap-2` | convert |
| CodeBlock.svelte:86 | padding | `0.4rem 0.75rem` | toolbar pad | off-scale (0.4rem); snap scale |
| CodeBlock.svelte:101 | padding | `1rem` | `p-4` | convert |
| CodeBlock.svelte:104 | line-height | `1.6` | code leading | `leading-relaxed`(1.625) or tokenize |
| CodeBlock.svelte:111 | outline-offset | `-2px` | inset focus | **focus-offset** (negative variant) |

## dataviz/ (component-level, non-marks)

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| dataviz/ChartTooltip.svelte:229 | max-width | `min(16rem, calc(100vw-16px))` | tooltip width | `16rem`/`16px` — `16rem`=`max-w-64`; `16px` gutter magic |
| dataviz/ChartTooltip.svelte:230 | padding | `6px 8px` | tooltip pad | off-scale; `py-1.5 px-2` |
| dataviz/ChartTooltip.svelte:244 | transition | `opacity 80ms ease-out` | fade | `80ms` OFF motion tokens (below `--duration-instant` 100ms) → add `--duration-micro` |
| dataviz/ChartTooltip.svelte:248 | margin | `0 0 4px` | `mb-1` | convert |
| dataviz/ChartTooltip.svelte:260,266 | gap | `2px`, `6px` | row gaps | off-scale; `gap-0.5`, `gap-1.5` |
| dataviz/ChartTooltip.svelte:271-272 | width/height | `0.5rem` | swatch | `size-2` |
| dataviz/ChartTooltip.svelte:283 | padding-inline-start | `8px` | indent | `ps-2` |
| dataviz/ChartTooltip.svelte:193 | inline pos | `left/top/transform` from px | computed placement | legit-dynamic (runtime coords) |
| dataviz/ExplainedMetricCard.svelte:133 | padding | `1.1rem 1.25rem` | card pad | `1.1rem` off-scale; snap |
| dataviz/ExplainedMetricCard.svelte:146 | gap | `0.75rem` | `gap-3` | convert |
| dataviz/ExplainedMetricCard.svelte:152 | @container min-width | `23rem` | container query bp | one-off CQ breakpoint; document |
| dataviz/ExplainedMetricCard.svelte:154 | grid cols | `minmax(7rem,12rem) minmax(0,1fr)` | 2-col track | structural; `7rem`/`12rem` magic track widths |
| dataviz/ExplainedMetricCard.svelte:155 | gap | `1.25rem 1.75rem` | grid gap | `gap-5 gap-x-7` scale |
| dataviz/ExplainedMetricCard.svelte:167 | padding-inline-end | `1.5rem` | glyph clearance | `pe-6` |
| dataviz/ExplainedMetricCard.svelte:173 | inset-block-start | `0.05rem` | micro nudge | magic 0.05rem; likely deletable |
| dataviz/ExplainedMetricCard.svelte:181 | padding-inline-end | `1.4rem` | clearance | off-scale rem |
| dataviz/ExplainedMetricCard.svelte:188 | line-height | `1.55` | body leading | tokenize/`leading-*` |
| dataviz/ExplainedMetricCard.svelte:195 | margin | `0.4rem 0 0` | off-scale | snap `mt-1.5` |
| dataviz/ExplainedMetricCard.svelte:198 | line-height | `1.4` | leading | `leading-*` |
| dataviz/RankedRow.svelte:276 | arbitrary grid | `grid-cols-[auto_1fr_auto]` | row layout | structural; keep |
| dataviz/SeverityBar.svelte:194 | min-width | `2px` | min bar width | keeps sliver visible; small, acceptable/name **bar-min** |
| dataviz/SeverityBar.svelte:195 | transition | `width 240ms cubic-bezier(0.22,1,0.36,1)` | bar grow | `240ms`+inline bezier OFF tokens → `--duration-normal`+`--ease-out` |

## dataviz/chart/ (frame + marks — SVG mark internals)

Chart marks legitimately hand-tune **stroke-width / stroke-dasharray** for SVG legibility (LayerChart primitives). These are arguably a separate "chart geometry" vocabulary, but they are NOT on any token scale and repeat heavily. Flagged as a cluster:

| file:line | property | literal value | intent | disposition |
|---|---|---|---|---|
| dataviz/chart/ScrollFrame.svelte:110 | outline-offset | `2px` | focus | **focus-offset** |
| dataviz/chart/ScrollFrame.svelte:120 | width | `1.25rem` | fade gutter width | `w-5` scale |
| dataviz/chart/ScrollFrame.svelte:123 | z-index | `1` | fade above content | = `--z-content`; USE `var(--z-content)` |
| dataviz/chart/ScrollFrame.svelte:128-140 | gradient | `color-mix(...var(--foreground) 16%...)` | edge fade | `16%` magic mix; tokenize fade or keep (token-derived) |
| dataviz/chart/marks/BulletMark.svelte:97 | opacity | `0.55` | track dim | off-token → `--opacity-*` (no exact match) |
| dataviz/chart/marks/BulletMark.svelte:114 | stroke-width | `2` | target tick | **stroke-width cluster** |
| dataviz/chart/marks/BulletMark.svelte:115 | stroke-dasharray | `2 2` | dashed target | **dash cluster** |
| dataviz/chart/marks/DotStripMark.svelte:122 | stroke-width | `0.75` | mean line | **stroke cluster** |
| dataviz/chart/marks/DotStripMark.svelte:123 | stroke-dasharray | `3 3` | dashed mean | **dash cluster** |
| dataviz/chart/marks/DotStripMark.svelte:138 | opacity | `0.5` | grid dim | ≈`--opacity-*` (0.5 no exact) |
| dataviz/chart/marks/DumbbellMark.svelte:151 | gap | `0.3rem` | legend gap | off-scale rem |
| dataviz/chart/marks/DumbbellMark.svelte:154-155 | width/height | `0.6rem` | swatch | off-scale (0.6rem); snap `size-2.5` |
| dataviz/chart/marks/DumbbellMark.svelte:156 | border-radius | `50%` | round swatch | circle; keep (or `rounded-full`) |
| dataviz/chart/marks/DumbbellMark.svelte:167 | opacity | `0.7` | connector | off-token |
| dataviz/chart/marks/DumbbellMark.svelte:193 | opacity | `0.5` | grid | off-token |
| dataviz/chart/marks/HeatmapMark.svelte:209 | min-width | `27rem` | scroll intrinsic width | documented magic (24-col grid); keep but comment-tied |
| dataviz/chart/marks/HeatmapMark.svelte:216 | stroke-width | `0.5` | cell border | **stroke cluster** |
| dataviz/chart/marks/HeatmapMark.svelte:236 | stroke-width | `1.25` | worst outline | **stroke cluster** |
| dataviz/chart/marks/HistogramMark.svelte:169 | opacity | `0.45` | on-time band dim | off-token |
| dataviz/chart/marks/HistogramMark.svelte:176 | stroke-width | `0.5` | bar border | **stroke cluster** |
| dataviz/chart/marks/HistogramMark.svelte:180 | stroke-width | `1` | median | **stroke cluster** |
| dataviz/chart/marks/HistogramMark.svelte:184-185 | stroke-width/dash | `0.75` / `3 3` | p90 | **stroke/dash cluster** |
| dataviz/chart/marks/HistogramMark.svelte:200 | opacity | `0.5` | grid | off-token |
| dataviz/chart/marks/LineMark.svelte:104 | inline opacity | `opacity:0.12` | band fill | off-token magic 0.12 |
| dataviz/chart/marks/LineMark.svelte:163 | stroke-width | `2` | spline | **stroke cluster** |
| dataviz/chart/marks/LineMark.svelte:166 | stroke-dasharray | `5 4` | dashed | **dash cluster** |
| dataviz/chart/marks/LineMark.svelte:170 | stroke-dasharray | `3 3` | target | **dash cluster** |
| dataviz/chart/marks/LineMark.svelte:174 | opacity | `0.5` | grid | off-token |
| dataviz/chart/marks/MagnitudeBarsMark.svelte:179 | opacity | `0.5` | grid | off-token |
| dataviz/chart/marks/MagnitudeCiWhiskers.svelte:54 | stroke-width | `1.5` | CI line | **stroke cluster** |
| dataviz/chart/marks/MagnitudeCiWhiskers.svelte:55 | opacity | `0.62` | CI uncertainty | off-token magic 0.62 |
| dataviz/chart/marks/ServiceSpanMark.svelte:153,178,179,183,206,207,231,232 | gap | `0.5rem`,`1rem`,`0.25rem`,`0.3rem`,`0.5rem 1rem` | span layout | mostly on rem grid → utilities |
| dataviz/chart/marks/ServiceSpanMark.svelte:157 | stroke-width | `0.75` | grid line | **stroke cluster** |
| dataviz/chart/marks/ServiceSpanMark.svelte:158 | stroke-dasharray | `2 3` | dashed grid | **dash cluster** |
| dataviz/chart/marks/ServiceSpanMark.svelte:162 | stroke-width | `1` | track | **stroke cluster** |
| dataviz/chart/marks/ServiceSpanMark.svelte:193 | letter-spacing | `0.04em` | label track | off-token → `--tracking-wide` |
| dataviz/chart/marks/ServiceSpanMark.svelte:214 | line-height | `1` | glyph | `leading-none` |
| dataviz/chart/marks/SparklineMark.svelte:53 | inline w/h | `width:{width}px;height:{height}px` | plot dims | legit-dynamic (prop-sized) |
| dataviz/chart/marks/SparklineMark.svelte:74 | Points r | `r={2.5}` | last-point dot | off-scale radius constant |
| dataviz/chart/marks/SparklineMark.svelte:102 | stroke-width | `1.5` | spline | **stroke cluster** |
| dataviz/chart/marks/StackedShareBar.svelte:66 | outline-offset | `1px` | focus | **focus-offset** (1px variant) |
| dataviz/chart/marks/StackedShareMark.svelte:130 | stroke-width | `1` | segment divider | **stroke cluster** |
| dataviz/chart/marks/TrendMark.svelte:275,286,296 | stroke-width | `2`,`2`,`0.75` | otp/retard/target | **stroke cluster** |
| dataviz/chart/marks/TrendMark.svelte:289,299 | stroke-dasharray | `4 3`,`4 3` | dashed lines | **dash cluster** |
| dataviz/chart/marks/TrendMark.svelte:290 | opacity | `0.95` | retard line | off-token magic 0.95 |
| dataviz/chart/marks/TrendMark.svelte:314 | opacity | `0.5` | grid | off-token |

---

## SUMMARY OF PATTERNS TO PROMOTE (candidates for named/tokenized patterns)

1. **`text-[var(--…)]` / `bg-[var(--…)]` bracket color wrappers** — pure noise; a plain `text-foreground`/`text-muted-foreground`/`bg-*` utility exists. Files: BrandCluster:61, ChevronToggle:37, MetricDisplay:99, CollapsibleSection:147, EdgeState:408/411, StatusDot:61-64 (signal vars), MetricDisplay:99. **Disposition: DELETE brackets, use theme utility.** (~9 hits)

2. **3px accent-stripe** (`border-left-width:3px` / `border-top:3px` / `border-width:3px` in a dataviz-severity/edge-rule hue): alert.svelte:63/68, EdgeState.svelte:449/451, CollapsibleSection.svelte:193/196. **Disposition: name `--border-width-accent: 3px` + a shared `.accent-stripe` recipe.**

3. **`min-height: 44px` tap-target** — Detail:79, TocNav:164, TocPill:173/232. **Disposition: `--size-tap-min: 44px` token / `.tap-target` utility.**

4. **`outline-offset: 2px` (and 1px/3px/-2px variants) focus offset** — BrandCluster:93/124, TocNav:180, TocPill:273, line-combobox:201/273, ScrollFrame:110, Detail:100, StackedShareBar:66, CodeBlock:111. **Disposition: `--focus-offset: 2px` token; unify the stray 1px/3px.**

5. **Chart `stroke-width` (0.5/0.75/1/1.25/1.5/2) + `stroke-dasharray` (2 2 / 3 3 / 4 3 / 5 4 / 2 3)** across ~10 mark files. **Disposition: a small `--chart-stroke-{hair,thin,base,emphasis}` + `--chart-dash-*` scale in dataviz/tokens.ts.**

6. **`rounded-[min(var(--radius-md),10px|12px)]` control-radius clamp** — button.svelte ×4, toggle.svelte, toggle-group.svelte. **Disposition: `--radius-control-xs: min(var(--radius-md),10px)` / `-sm: …12px` tokens.**

7. **`blur(8px)` / `blur(12px)` backdrop** — TocPill:179/223. **Disposition: add `--blur-sm`/`--blur-md` tokens.**

8. **Off-token motion timings** — `120ms`+bezier (CollapsibleSection), `240ms`+bezier (SeverityBar), `80ms ease-out` (ChartTooltip), `150ms ease` (EdgeState), `2s`/`3s` keyframe durations (skeleton, StopLabel, MetroStation, separator). **Disposition: reuse `--duration-*`/`--ease-*`; add `--duration-micro`(80ms) + `--duration-pulse`(2s) if needed.**

9. **Exact-token-value literals that should just reference the token:** TocNav:201 `13px`, TocPill:279 `13px` → `--text-caption`; TocPill:222 `12px` → `--radius-lg`; TocPill:235 `8px` → `--radius-md`; ScrollFrame:123 `z-index:1` → `--z-content`; AbsentValue:139 `24rem` → `max-w-sm`. **Disposition: swap literal for the token — zero visual change.**

10. **Hardcoded hex palettes:** CodeBlock `--code-*` (8 hexes), SeoHead `#141414`. **Disposition: define `--dataviz-code-*` tokens; source theme-color meta from `--background`.**
