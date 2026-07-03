# VIBE + STYLE CENSUS — Routes + app shell config

**Scope:** `apps/web/src/routes/**` (all page/layout/error/server/endpoint files), `apps/web/src/app.css`, `app.d.ts`, `hooks.server.ts`, `service-worker.ts`, `params/locale.ts` (~35 files).

**Method:** Read every file in scope. Cross-referenced literals against the vendored token vocabulary in `apps/web/vendor/design/tokens/tokens.json` and the runtime CSS vars in `apps/web/src/lib/styles/tokens.css`. A value is **on-token** (FINE, not flagged) when it is a `var(--token)`, a Tailwind theme-scale utility (`text-*`, `rounded-*`, `bg-<role>`, `shadow-<name>`, `z-<name>`), or a documented design decision the tokens themselves encode. A value is **off-token** (flagged below) when it is a raw literal that a token exists for, or an ad-hoc value with no token home.

**Key token facts used for classification** (from `tokens.css`):
- Motion: `--duration-instant 100ms · fast 150ms · normal 200ms · slow 300ms · slower 500ms`; `--ease-default/out/in-out/bounce`. → raw `120ms`, `150ms ease`, `200ms cubic-bezier(...)`, `250ms`, `2s` and hand-written beziers are **off-token**.
- Opacity scale: `--opacity-muted 0.6 · dim 0.3 · subtle 0.15 · faint 0.05`. → `0.8`, `0.7`, `0.92`, `0.97`, `0.6`, `0.5`, `0.35`, `0.4` used raw are **off-token** (some coincide with a token value but are written as literals).
- Radius scale: `--radius-sm 4px · md 8px · lg 12px · xl 16px · pill 9999px`. → `3px`, `1px` radii are **off-token**.
- Tracking scale: `--tracking-tight/-wide/-eyebrow(0.1em)`. → `letter-spacing: 3px / 2px` are **off-token**.
- **No fine-grained spacing token scale exists** — only three page-level clamps (`--space-page-x/-section-y/-card-gap`). Every `gap`/`padding`/`margin` in `rem` (0.25rem…2.5rem) has **no token to map to**. This is the single biggest repeated pattern; treated as a systemic gap (proposed new spacing scale), not per-line noise, but every occurrence is catalogued.

**Headline:** Only **4 of ~35 files** carry any visual styling. The other ~31 are thin feature-mounts (`<Feature />`), pure loaders (`+page.ts`, `+layout.ts/.server.ts`), or logic-only endpoints (`+server.ts`, `hooks.server.ts`, `service-worker.ts`, `app.d.ts`, `params/locale.ts`) — **zero** visual literals, correctly delegating all presentation to `$lib`. Findings concentrate in `app.css`, `+error.svelte`, `[[lang=locale]]/+page.svelte` (hub), and `_kit/+page.svelte`.

---

## `apps/web/src/app.css`

Tokenised well overall (colors are 100% `var()`; radii/shadows/z/type via `@theme`). The off-token residue is **motion literals**, **raw opacities/scales in keyframes & tap utilities**, a **3px scrollbar radius**, **px letter-spacing on the label utilities**, and a few **hardcoded rgba() shadow tints** in the light-theme hand region (these last are arguably canon since the generator's own shadow tokens also embed raw rgba — noted but low-priority).

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| app.css:34 | transition (scale) | `120ms cubic-bezier(0.2, 0, 0, 1)` | `.tap-press` press feedback timing | `120ms`→ no exact token (closest `--duration-instant 100ms`); bezier `(0.2,0,0,1)` is off-scale → map to `--ease-out`. NEW token `--duration-tap` if 120ms is intentional, else snap to `--duration-instant var(--ease-out)` |
| app.css:35 | transition (opacity) | `120ms cubic-bezier(0.2, 0, 0, 1)` | `.tap-press` opacity feedback | same as above |
| app.css:39 | scale | `0.97` | `.tap-press:active` shrink | magic scale; no token → keep as documented interaction constant OR NEW `--press-scale` |
| app.css:40 | opacity | `0.92` | `.tap-press:active` dim | off-token; nearest none → NEW `--press-opacity` or accept as interaction constant |
| app.css:48 | transition | `120ms ease-out` | `.tap-feedback` timing | `120ms`→`--duration-instant`(100)/NEW; `ease-out` keyword → `var(--ease-out)` |
| app.css:51 | opacity | `0.7` | `.tap-feedback:active` dim | off-token magic opacity → NEW interaction constant or `--opacity-*` addition |
| app.css:307 | scrollbar-color thumb | `40%` (color-mix) | brand scrollbar thumb tint (dark) | off-token mix %; acceptable as scrollbar-specific but consider `--opacity-*`-derived pattern |
| app.css:311-312 | width/height | `6px` / `6px` | webkit scrollbar track size | off-scale px; NEW `--scrollbar-size` shared pattern |
| app.css:317 | background (color-mix) | `35%` | scrollbar thumb tint | off-token mix % (magic) → shared `--scrollbar-thumb` pattern |
| app.css:318 | border-radius | `3px` | scrollbar thumb radius | **off radius scale** (sm=4) → `--radius-sm` or NEW `--scrollbar-radius` |
| app.css:321 | background (color-mix) | `60%` | scrollbar thumb hover tint | off-token mix % |
| app.css:325 | scrollbar-color | `50%` | light-theme scrollbar tint | off-token mix % |
| app.css:329 | background (color-mix) | `50%` | light-theme thumb tint | off-token mix % |
| app.css:338-342 | background-image | `400px / 80px / 16px / 1px` grid steps | `.circuit-grid` schematic blueprint | intentional decorative geometry (mirrors yesid canon); NOT a token candidate — keep, but it is off-scale magic geometry |
| app.css:354-355 | background-image | `3.5% / 1px / 80px` | `.detail-header-grid` dot-grid lines | decorative canon (ported 1:1 from yesid); keep. `3.5%` mix is a one-off tint |
| app.css:363-367 | radial-gradient | `2.5px/2px @ 80px/160px/240px`, `12%/8%/10%/6%`, `320px` | `.detail-header-grid::after` solder dots | decorative canon; keep as shared pattern (already IS the shared pattern) |
| app.css:376 | box-shadow | `0 1px 2px rgba(28,24,19,0.06), 0 4px 12px rgba(28,24,19,0.08), inset 0 1px 0 …` | light `--shadow-card` hand override | raw rgba tints in the hand-maintained region; canon-adjacent (generator also emits raw rgba). Low priority — leave, or migrate to color-mix on a token ink |
| app.css:377 | box-shadow | `0 4px 24px rgba(28,24,19,0.1), 0 0 0 1px rgba(28,24,19,0.04)` | light `--shadow-nav` | same as above |
| app.css:378 | box-shadow | `0 8px 32px rgba(28,24,19,0.08)` | light `--shadow-section` | same |
| app.css:382 | box-shadow | `0 -8px 32px rgba(28,24,19,0.12)` | light `--shadow-sheet` | same |
| app.css:404,408 | box-shadow | `0 0 4px 1px … / 0.5`, `0 0 10px 4px … / 0.8` | `@keyframes pulse-glow` glow radii + alphas | off-token glow geometry + raw alphas; the `--shadow-glow-*` tokens exist but keyframes need discrete steps → keep as animation-specific, document |
| app.css:414,418-421 | transform/opacity | `scale(1)`→`scale(2.5)`, `0.6`→`0`, `75%` | `@keyframes station-ping` | animation geometry; keep (decorative) |
| app.css:454,457 | animation duration/ease | `200ms cubic-bezier(0.2, 0, 0, 1)` | view-transition root cross-fade | `200ms`→`var(--duration-normal)`; bezier `(0.2,0,0,1)` off-scale → `var(--ease-out)` |
| app.css:483 | letter-spacing | `3px` | `.label-station` tracking | **off tracking scale** (eyebrow=0.1em) → NEW `--tracking-station` or reuse `--tracking-eyebrow` |
| app.css:491 | letter-spacing | `2px` | `.label-metric` tracking | **off tracking scale** → NEW `--tracking-metric` or `--tracking-wide` |
| app.css:499 | height | `1px` | `.brand-fade-line` hairline | 1px hairline (ubiquitous) → acceptable/NEW `--hairline` |
| app.css:504 | border-top | `2px dashed` | `.divider-dashed` weight | 2px rule weight is canon ("round 3: 2px everywhere") → NEW `--rule-weight` token to name the canon |
| app.css:517 | animation | `2s ease-in-out` | `.led-pulse` cadence | `2s` off-duration-scale (max slower=500ms); intentional slow pulse → NEW `--duration-pulse`; `ease-in-out` keyword → `var(--ease-in-out)` |
| app.css:535 | scroll-margin-top | `calc(var(--nav-height, 64px) + 1rem)` | anchor offset under sticky nav | `64px` fallback + `1rem` literal; fallback is defensive, `1rem` is a spacing magic → NEW spacing token |
| app.css:294 | padding | `0.5rem 1rem` | `.skip-link` padding | off-scale spacing (no token) → NEW spacing scale |

---

## `apps/web/src/routes/+error.svelte`

Colors fully tokenised (`--dataviz-status-severe`, `--foreground`, `--primary`, `--muted-foreground`). Off-token residue: **spacing rem literals** (no token home), **raw line-heights**, **a magic opacity 0.8**, **transition timing/easing keywords**, and **ch/rem max-widths**.

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| +error.svelte:72 | max-width | `40rem` | error card column width | off container scale (content=64rem/wide=72rem); a reading measure → NEW `--measure-*` or keep as ch below |
| +error.svelte:74 | padding | `clamp(3rem, 10vw, 6rem) var(--space-page-x, 1.5rem)` | vertical band + horizontal gutter | vertical clamp is bespoke (≈`--space-section-y` 3-6rem — could reuse!); `var(--space-page-x, 1.5rem)` fallback OK → map vertical to `var(--space-section-y)` |
| +error.svelte:79 | gap | `1rem` | error stack gap | off-token spacing → NEW spacing scale |
| +error.svelte:84 | gap | `0.75rem` | status glyph/code gap | off-token spacing |
| +error.svelte:100,109 | line-height | `1.15`, `1.6` | heading / body leading | off-token; no leading scale exists → NEW `--leading-tight/-normal` |
| +error.svelte:105,111,118 | max-width | `28ch`, `44ch`, `44ch` | reading measure | ch measures (good practice) but ad-hoc values → NEW `--measure-heading/-body` |
| +error.svelte:116 | opacity | `0.8` | `.err-detail` dim | **off opacity scale** → nearest none; use `--muted-foreground` alone or NEW `--opacity-*` |
| +error.svelte:121 | margin-top | `0.5rem` | home-link spacing | off-token spacing |
| +error.svelte:123 | padding | `0.5rem 1.25rem` | home-link button padding | off-token spacing (button-pad pattern repeats site-wide) → NEW `--btn-pad` / button primitive |
| +error.svelte:131 | border-radius | `var(--radius-md, 0.5rem)` | button radius | on-token (fallback fine) — NOT flagged, listed for completeness |
| +error.svelte:133 | transition | `background 150ms ease` | hover timing | `150ms`→`var(--duration-fast)`; `ease` keyword → `var(--ease-default)` |
| +error.svelte:139 | outline / outline-offset | `2px solid` / `2px` | focus ring | matches the app.css global focus ring (`2px`/`2px`) → this is a REPEATED focus-ring pattern; NEW `--focus-ring` / already-global rule makes this redundant (could delete, inherits from `@layer base`) |

---

## `apps/web/src/routes/[[lang=locale]]/+page.svelte` (Hub landing)

Largest style block in scope. Colors 100% tokenised. Doctrine-clean (dataviz vs `--primary` separation respected). The entire off-token surface is **ad-hoc spacing (`gap`/`padding`) in rem**, **raw line-heights**, **ch measures**, **transition timing/easing keywords**, and a `translateY(-2px)` hover lift.

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| +page.svelte:537 | gap | `0.85rem` | hero head stack gap | off-token spacing → NEW spacing scale |
| +page.svelte:539,545 | max-width | `62ch`, `56ch` | hero measure | ch measures ad-hoc → NEW `--measure-*` |
| +page.svelte:544,603 | line-height | `1.6`, `1.65` | tagline/body leading | off-token leading → NEW `--leading-*` |
| +page.svelte:556 | gap | `0.75rem 1rem` | pulse-head row/col gap | off-token spacing |
| +page.svelte:557 | margin-bottom | `1.25rem` | pulse-head spacing | off-token spacing |
| +page.svelte:562 | gap | `0.55rem` | pulse-label inline gap | off-token spacing (oddly specific) |
| +page.svelte:578 | gap | `0.4rem` | pulse-kpi gap | off-token spacing (recurs many times) |
| +page.svelte:588,665 | gap | `clamp(1.5rem, 4vw, 2.5rem)`, `clamp(1.75rem, 4vw, 2.5rem)` | section rhythm | bespoke clamps ≈ `--space-card-gap`/`--space-section-y` family → reuse or NEW named section-gap clamp |
| +page.svelte:590 | media min-width | `1024px` | desktop 2-col breakpoint | off-token breakpoint (repeats site-wide) → NEW `--bp-lg` / shared breakpoint set |
| +page.svelte:599,671 | gap | `1rem` | prose / explore-group gap | off-token spacing |
| +page.svelte:606 | max-width | `60ch` | body measure | ch measure ad-hoc |
| +page.svelte:611,689 | gap | `0.5rem`, `1rem` | link icon gap / tile gap | off-token spacing |
| +page.svelte:617 | transition | `border-color 150ms ease` | what-link hover | `150ms`→`--duration-fast`; `ease`→`--ease-default` |
| +page.svelte:625 | outline-offset | `3px` | what-link focus offset | off-token (global ring uses 2px) → align to global `2px` |
| +page.svelte:637,692 | padding | `1rem 1.1rem`, `1.25rem 1.5rem` | pillar / tile padding | off-token spacing (card-pad pattern) → NEW `--card-pad` |
| +page.svelte:640,696 | border-radius | `var(--radius-lg, 0.75rem)` | pillar/tile radius | on-token (fallback fine) — not flagged |
| +page.svelte:636,655,659,731,734 | gap / line-height | `0.4rem`, `1.5`, `1.5` | pillar internal / desc leading | off-token spacing + leading |
| +page.svelte:699-701 | transition | `border-color 150ms ease, transform 150ms ease` | tile hover | `150ms`→`--duration-fast`; `ease`→`--ease-default` |
| +page.svelte:705 | transform | `translateY(-2px)` | tile hover lift | off-token motion distance → NEW `--hover-lift` |
| +page.svelte:723 | gap | `0.25rem` | tile-body gap | off-token spacing |
| +page.svelte:616,621 | border-bottom | `1px solid` | what-link underline | 1px hairline (ubiquitous) → `--hairline` pattern |

*(Note: `text-*` sizes, `var(--card)`, `var(--border)`, `var(--shadow-card)`, `var(--muted-foreground)`, `var(--accent-text)`, `var(--primary)`, `DashboardGrid minTile` px values like `160px/180px/240px` are on-token / component-API props — the minTile px are grid-sizing props, not visual literals; not flagged.)*

---

## `apps/web/src/routes/[[lang=locale]]/_kit/+page.svelte` (dev gallery, not shipped in chrome)

Dev-only contract sheet. Same profile: colors tokenised, off-token = **ad-hoc rem spacing/gaps**, **fixed rem sizes** (`16rem`, `9rem`), a **768px breakpoint**, and a couple of component-prop px values. Lower priority (not user-facing) but catalogued.

| file:line | property | literal value | intent | proposed disposition |
|---|---|---|---|---|
| _kit:557 | padding | `clamp(1.5rem, 4vw, 3rem) var(--space-page-x, 1.5rem)` | kit page padding | vertical clamp bespoke → reuse section clamp |
| _kit:560,565,567,577,578,583,588,589,595,596,600,606,607,614,615,623,626,631,645,653,664,677,681 | gap / padding / margin-top | `2rem`,`3rem`,`1rem`,`0.5rem`,`0.75rem`,`0.4rem`,`0.75rem` (many) | gallery layout rhythm | off-token spacing (dozens) → NEW spacing scale (single systemic fix covers all) |
| _kit:110,111 | width / height (prop) | `220`, `48` | sparkline demo dims | ChartSpec API props, not CSS — not a visual literal (borderline; listed for completeness) |
| _kit:496 | prop `top` | `1rem` | StickyPanel demo offset | component prop value (off-token) → could be tokenised in the primitive |
| _kit:634 | media min-width | `768px` | 2-col grid breakpoint | off-token breakpoint → NEW `--bp-md` |
| _kit:653 | min-width | `16rem` | tabs demo min | off-scale fixed size |
| _kit:663 | height | `9rem` | resizable demo height | off-scale fixed size |
| _kit:665,680 | border-radius | `var(--radius-lg)`, `var(--radius-md)` | demo card radii | on-token — not flagged |
| _kit:677 | padding | `0.5rem 0.75rem` | surface-demo pad | off-token spacing |

---

## Files with ZERO visual literals (correct delegation — verified, not flagged)

**Thin feature mounts** (`<Feature />` only, no markup/style): `alerts`, `hotspots`, `lines/+page`, `network`, `map`, `metrics/+page`, `metrics/+layout` (pass-through), `receipt`, `repeat-offenders`, `search`, `status`, `stops`, `lines/[id]/+page`, `stop/[id]/+page`, `trip/[id]/+page`.

**Pure loaders / logic** (no styling by nature): `+layout.svelte` (uses only Tailwind flow utilities `flex h-full w-full flex-col overflow-* min-h-0 grow shrink-0 basis-auto` + `max-w-2xl p-6` — all on-scale Tailwind, no arbitrary values), `+layout.ts`, `+layout.server.ts`, `lines/[id]/+page.ts`, `stop/[id]/+page.ts`, `trip/[id]/+page.ts`, `route/[id]/+server.ts`, `api/geocode/montreal/+server.ts`, `api/vitals/+server.ts`, `health/+server.ts`, `robots.txt/+server.ts`, `sitemap.xml/+server.ts`, `hooks.server.ts`, `service-worker.ts`, `app.d.ts`, `params/locale.ts`.

**One borderline in `+layout.svelte`:** line 490 `max-w-2xl p-6` on the error-edge wrapper — `max-w-2xl` (42rem) and `p-6` are Tailwind default-scale utilities, not arbitrary `[...]` values, so on-scale/FINE. Not flagged.

---

## Category counts (flagged, off-token)

- **Ad-hoc spacing (gap/padding/margin in rem)** — the dominant category. app.css: 3 · +error: 6 · hub: ~18 · _kit: ~25 → **~52 occurrences**. No token exists to map to (only 3 page-level clamps).
- **Motion literals (raw ms durations + hand-written beziers + `ease`/`ease-out` keywords + `2s`)** — app.css: 6 · +error: 1 · hub: 3 → **~10 occurrences** (all have exact token homes: `--duration-*` / `--ease-*`).
- **Raw opacity / magic scale (0.7, 0.8, 0.92, 0.97 + raw color-mix %)** — app.css: ~7 · +error: 1 → **~8 occurrences** (`--opacity-*` scale exists but these don't map cleanly).
- **Off-scale line-height (leading)** — +error: 2 · hub: 5 → **~7 occurrences** (no leading token scale exists).
- **Off-scale ch/rem max-width (reading measures)** — +error: 3 · hub: 3 · _kit: 2 → **~8 occurrences** (no measure token).
- **Off-radius (3px scrollbar, 1px hairlines-as-radius)** — app.css: 1 (3px) → **1 clean off-radius** (+ several `1px` hairlines counted separately).
- **Off-tracking (letter-spacing px)** — app.css: 2 (`3px`, `2px`) → **2**.
- **Off-scale breakpoints (1024px, 768px)** — hub: 1 · _kit: 1 → **2** (repeat elsewhere in `$lib`).
- **Hardcoded rgba() shadow tints (light hand region)** — app.css: 4 → **4** (canon-adjacent, low priority).
- **One-off transform (translateY(-2px) hover lift)** — hub: 1 → **1**.
- **Scrollbar size (6px)** — app.css: 1 → **1**.

**Total flagged hits: ~96** across 4 files (dominated by spacing + motion).

---

## The 3 most common repeated ad-hoc patterns → candidates to become named patterns

1. **A fine-grained spacing scale is MISSING.** ~52 hits. Every `gap`/`padding`/`margin` in these files is a raw rem (`0.25 / 0.4 / 0.5 / 0.55 / 0.75 / 0.85 / 1 / 1.1 / 1.25 / 1.5 / 1.75 / 2 / 2.5rem`). The tokens only define three page-level clamps. **Proposed:** add a `--space-1…8` (or `--space-2xs…2xl`) step scale to `tokens.json` and sweep. This one change resolves >half of all findings site-wide.

2. **Motion literals bypass the existing motion tokens.** ~10 hits, but this is a *doctrine* violation because the tokens explicitly exist (`--duration-*`, `--ease-*`). Raw `120ms`, `150ms ease`, `200ms cubic-bezier(0.2,0,0,1)`, `2s ease-in-out`, and the `ease`/`ease-out` keywords should all be `var(--duration-*) var(--ease-*)`. **Proposed:** a `motion-tokens-only` lint sweep + (optionally) a `--duration-tap`/`--duration-pulse` token for the 120ms/2s cases the scale doesn't cover.

3. **The card / tile / button chrome is copy-pasted, not a primitive.** The exact block `background-color: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); padding: <ad-hoc>` recurs verbatim across `.pillar`, `.hub-tile`, `.kit-card` (and the `+error` `.err-home` button repeats `padding: .5rem 1.25rem; radius; hover; focus-ring`). Plus the focus ring (`outline: 2px solid var(--primary); outline-offset: 2px`) is redeclared locally even though `app.css @layer base` already applies it globally (redundant — could delete the local copies). **Proposed:** a shared `.surface-card` utility (or lean on the existing `Card`/`Surface` primitives) + a `Button` primitive so the padding/radius/hover/focus is defined once.
