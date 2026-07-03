# Spacing/Type Census — apps/web/src

Scope: all `.svelte` and `.css` files under `apps/web/src`, excluding `vendor/` and test files (`/tests/`, `*.test.*`, `*.spec.*`). 231 `.svelte` files + 3 `.css` files (`app.css`, `lib/styles/fonts.css`, `lib/styles/tokens.css`) scanned.

## 0. Token scale (source of truth, read first)

Read from `apps/web/vendor/design/tokens/tokens.json` and how it's compiled into `apps/web/src/app.css` (`@theme` block, lines 76–116, generated — do not hand-edit):

- **No `--spacing` base-unit override exists.** Tailwind v4's **default spacing scale** (`--spacing: 0.25rem` multiplier) is therefore live and is the on-scale baseline for every `p-*/px-*/py-*/m-*/mx-*/my-*/gap-*/space-*-*` utility: `{0, px, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96}` → rem = key × 0.25 (px = 1px = 0.0625rem).
- Plus 3 **named fluid spacing tokens** registered as Tailwind spacing keys via `--spacing-page-x/-section-y/-card-gap` (app.css:113-115 ← tokens.json `space.*`, all `yesid.clamp`): `page-x` (1.5rem→5rem), `section-y` (3rem→6rem), `card-gap` (1rem→1.5rem). These back `px-page-x`, `py-section-y`, `gap-card-gap` etc.
- **Font-size scale**: Tailwind default `text-xs…text-9xl` is untouched, **plus** 13 named tokens registered as Tailwind text keys via `--text-*` in app.css:80-92 (← tokens.json `text.*`): `hero, hero-mobile, display, title, heading, subheading, body, small, control, tag, mono, caption, micro`. These back `text-small`, `text-caption`, `text-micro`, etc., and are also used directly as `font-size: var(--text-*)` in raw CSS.
- **On-scale definition used below**: a Tailwind numeric utility value that is a member of the default spacing/text scale, OR a named token (`page-x/section-y/card-gap` for spacing; the 13 `--text-*` names for font-size), OR raw CSS whose length (rem/px/em, single or shorthand multi-value) reduces exactly to one of the default-scale rem values, OR a raw CSS value that is `var(--spacing-N)` / `var(--space-*)` / `var(--text-*)`, OR a `clamp()/calc()/min()/max()` fluid expression (bucketed separately as "fluid-clamp", not penalized — these are explicitly the vendor's `yesid.clamp` idiom). Everything else — Tailwind `[...]` arbitrary values with a non-scale length, non-scale utility suffixes, and raw CSS px/rem/em values that don't reduce to a scale step — is **off-scale**.

## 1. Histogram — Tailwind spacing utilities (p/px/py/pt/pr/pb/pl/ps/pe/m/mx/my/mt/mr/mb/ml/ms/me/gap/gap-x/gap-y/space-x/space-y)

226 total utility occurrences across 76 distinct `(prefix, value)` groups (after removing 3 grep false-positives — see §4).

**On-scale-default (Tailwind numeric scale), by value, occurrence count:**

| value | rem | count |
|---|---|---|
| 2 | 0.5rem | 35 |
| 4 | 1rem | 31 |
| 1.5 | 0.375rem | 31 |
| 3 | 0.75rem | 28 |
| 1 | 0.25rem | 22 |
| 0 | 0 | 19 |
| 6 | 1.5rem | 14 |
| 2.5 | 0.625rem | 11 |
| 0.5 | 0.125rem | 6 |
| 8 | 2rem | 4 |
| 10 | 2.5rem | 4 |
| 5 | 1.25rem | 2 |
| px | 1px | 1 |
| 12 | 3rem | 1 |
| 9 | 2.25rem | 1 |

Subtotal on-scale-default: **210** occurrences. Named-token spacing utilities (`page-x`/`section-y`/`card-gap`) did not appear as raw utility-class hits in this sweep (they're consumed via CSS `var(--space-card-gap)` inside `<style>` blocks instead — see §2 raw-CSS results, `on-scale-token` bucket).

**Off-scale Tailwind spacing utilities: 2 real hits** (see full file:line list in §3; a further 12 "off-scale" grep matches were false positives — `mx-auto`/`mt-auto`/`ml-auto` are legitimate Tailwind keyword utilities, and `gap-days`/`gap-day`/`gap-sample`/`gap-honest` are prose/comment text incidentally matching the regex, not real class attributes — see §4).

## 2. Histogram — font-size utilities (`text-xs`…`text-9xl`, `text-[...]`, named tokens)

62 total occurrences, 14 distinct value-groups (after filtering out `text-left/text-center/...` alignment and `text-{color}` hits, which are a different Tailwind utility family sharing the `text-` prefix).

| value | class | count |
|---|---|---|
| small | on-scale-token | 21 |
| caption | on-scale-token | 19 |
| body | on-scale-token | 4 |
| micro | on-scale-token | 4 |
| control | on-scale-token | 2 |
| subheading | on-scale-token | 2 |
| base | on-scale-default | 2 |
| xl | on-scale-default | 1 |
| lg | on-scale-default | 1 |
| heading | on-scale-token | 1 |
| title | on-scale-token | 1 |
| **[0.625rem]** | **off-scale-arbitrary** | **2** |
| **[0.8rem]** | **off-scale-arbitrary** | **1** |
| **[0.6875rem]** | **off-scale-arbitrary** | **1** |

On-scale: 58/62 (93.5%). Off-scale: **4/62** (6.5%) — full list in §3.

## 3. Full list of OFF-SCALE hits, file:line

### 3a. Tailwind spacing utilities — off-scale (2 real hits)

| file:line | snippet |
|---|---|
| `apps/web/src/lib/components/ui/tabs/tabs-list.svelte:9` | `base: 'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground ...'` — `p-[3px]` = 3px arbitrary, not on the 0.25rem(4px) grid |
| `apps/web/src/lib/components/ui/toggle-group/toggle-group.svelte:72` | `'group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg ...'` — dynamic CSS-var arbitrary value; technically resolves through the spacing scale function at runtime (bits-ui/shadcn primitive pattern), flagged only because it isn't a literal scale key. Low-priority / likely a non-issue. |

### 3b. Tailwind font-size utilities — off-scale (4 hits)

| file:line | snippet |
|---|---|
| `apps/web/src/lib/components/ui/button/button.svelte:36` | `sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg ..."` |
| `apps/web/src/lib/components/ui/badge/badge.svelte:39` | `xs: 'h-auto px-2 py-0.5 text-[0.6875rem] leading-tight',` |
| `apps/web/src/lib/components/brand/BrandCluster.svelte:50` | `<span class="label-station hidden text-[0.625rem] sm:inline">{liveLabel}</span>` |
| `apps/web/src/lib/components/shell/TopBar.svelte:402` | `class="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.625rem] font-bold leading-4 t...` (notification-count badge) |

Note: `0.6875rem` = 11px is **already a first-class token** (`--text-micro: 0.6875rem` per tokens.json/app.css). The badge.svelte and TopBar.svelte/BrandCluster.svelte hits at `[0.6875rem]`/`[0.625rem]` should almost certainly be `text-micro` (11px) instead of hand-typed arbitrary values — this is a straight "snap to existing token" fix, not a new-token proposal.

### 3c. Raw CSS declarations (`.svelte <style>` blocks + the 3 global `.css` files) — off-scale-numeric

**119 distinct (property, value) groups, 327 total occurrences.** This is the dominant source of off-scale spacing in the codebase — almost all of it is `gap`/`padding`/`margin` values in `<style>` blocks using odd fractional-rem literals instead of the Tailwind scale or a token. Full raw dump (446 lines, every occurrence with file:line) written to `/tmp/claude-1000/-home-mgkdante-Yesito-projects-transit/cd0cbc0d-7345-4d57-a71b-5a9a4948a56e/scratchpad/all_offscale_raw_css.txt`. Ranked list (count ≥ 2) below; singletons omitted from this table (present in the raw dump file).

| prop | value | count |
|---|---|---|
| gap | 0.4rem | 55 |
| gap | 0.35rem | 31 |
| gap | 0.6rem | 23 (+4 as `padding`/`padding-bottom` combined = 27 total for the literal `0.6rem`) |
| gap | 0.3rem | 25 (+1 `padding-bottom` = 26 total) |
| gap | 0.45rem | 15 (+1 `padding` = 16 total) |
| gap | 0.85rem | 9 (+ margin-top/padding-left/padding-bottom = 14 total) |
| gap | 0.55rem | 9 (+5 other props = 17 total) |
| gap | 0.15rem | 5 |
| padding | 1.1rem 1.2rem | 3 |
| font-size | 0.72rem | 3 |
| font-size | 13px | 3 |
| gap | 0.2rem | 4 |
| gap | 0.1rem | 1 (+ several 1-offs) |
| padding | 0.15rem 0 | 4 |
| padding | 0.5rem 0 | 3 |
| margin | 0.5rem 0 0 | 4 |
| padding | 0.4rem 0.6rem | 2 |
| padding | 0.6rem 0.7rem 0.6rem 0.9rem | 2 |
| padding | 0.35rem 0.75rem | 2 |
| padding | 0.45rem 0.85rem | 2 |
| margin-inline | -0.55rem | 2 |
| ...(≈100 more singleton/2-off shorthand combos, see raw dump) | | |

Worst offenders are near-duplicate 4-value padding shorthands (e.g. `0.6rem 0.7rem 0.6rem 0.9rem`, `0.65rem 1rem 0.65rem 0.85rem`) — each one is a bespoke, non-reusable pill/chip padding invented per-component.

### 3d. Worst files (off-scale raw-CSS occurrence count)

| file | off-scale hits |
|---|---|
| `apps/web/src/lib/features/map/MapSelectionDetail.svelte` | 44 |
| `apps/web/src/lib/features/map/MapNearMeControl.svelte` | 21 |
| `apps/web/src/lib/components/shell/TopBar.svelte` | 18 |
| `apps/web/src/lib/components/shell/LeftRail.svelte` | 14 |
| `apps/web/src/lib/features/map/MapFilters.svelte` | 13 |
| `apps/web/src/lib/features/lines/reliability/sections/Section2TheWait.svelte` | 11 |
| `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.svelte` | 8 |
| `apps/web/src/lib/features/map/MapDetailAlerts.svelte` | 7 |
| `apps/web/src/lib/features/alerts/sections/AlertLog.svelte` | 7 |
| `apps/web/src/lib/features/lines/RouteDetail.svelte` | 6 |
| `apps/web/src/lib/features/metrics/MetricsExplainer.svelte` | 6 |
| `apps/web/src/lib/features/repeat-offenders/sections/RepeatOffendersSection.svelte` | 6 |

`map/` (MapSelectionDetail + MapNearMeControl + MapFilters + MapDetailAlerts = **85** off-scale hits) and the shell chrome (TopBar + LeftRail = **32**) together account for well over a third of all off-scale raw-CSS declarations in the codebase.

## 4. Grep false-positives filtered out (for transparency)

The regex over Tailwind class strings initially flagged 14 "off-scale-nonstandard" spacing hits; 12 were false positives, not real design-scale violations:

- `mx-auto` (5×: `+layout.svelte:490`, `separator.svelte:71`, `Footer.svelte:100`, `Footer.svelte:139`, `BottomSheet.svelte:78`), `mt-auto` (1×: `sheet-footer.svelte:16`), `ml-auto` (1×: `TopBar.svelte:360`) — `auto` is a valid Tailwind spacing-utility keyword, not a scale violation.
- `gap-days`/`gap-day`/`gap-sample`/`gap-honest` (7× total, in `Section2TheWait.svelte:285`, `SectionDailyTrend.svelte:77`, `AccountabilityReceipt.svelte:235`, `DateRangePicker.svelte:20,101,207`) — these are English prose inside comments (e.g. "the caller marks ENABLED can be picked; a disabled **gap-day** option is never emitted") that the regex incidentally matched as `gap-<value>`; not `class="..."` attributes at all.

## 5. Top 5 off-scale values by frequency (candidates for scale-snap or token promotion)

Ranked by raw occurrence count, combining all raw-CSS hits for that literal value (Tailwind arbitrary-value hits are too sparse/heterogeneous — 0.625rem/0.6875rem/0.8rem, 4 total — to compete with the raw-CSS gap/padding pattern below):

1. **`0.4rem` (6.4px) — 55 occurrences, all `gap`.** Sits between `gap-1.5` (0.375rem/6px) and `gap-2` (0.5rem/8px). Extremely consistent single-purpose usage (tight icon+label / chip-row gaps) across ~40 distinct files (RouteDetail, Section1/3, TripDetail, StopDetail, HotspotSection, MapMotionControl, MapDetailAlerts, MapHeadTitle, MapSelectionDetail ×5, SectionTimeOfDay, SectionHeadline ×2, SectionWorst, SectionAffected, SearchSurface, SectionTrend ×2, SectionByTimeOfDay, SectionStatusMix, NetworkSurface, SectionCrowdingByDay ×2, SectionDelayHistogram, SectionWeekday, SectionNotes, SectionConformance, SectionLanes, MetricsExplainer ×3, RepeatOffenders, RepeatOffendersSection ×3, ReliabilityPane ×2, and more). **Strongest single candidate for promotion to a named token** (e.g. `--spacing-tight-gap: 0.4rem`) — this is clearly an intentional, repeated design decision, not accidental drift, and snapping it to `gap-1.5` or `gap-2` would be a visible density change everywhere at once.
2. **`0.35rem` (5.6px) — 31 occurrences, mostly `gap`.** Same tight-row family as #1, one step down. Also a snap-or-promote candidate; consider whether `0.4rem` and `0.35rem` should collapse into one token (they differ by only 1.6px) rather than both being promoted.
3. **`0.6rem` (9.6px) — 27 occurrences** across `gap`/`padding`/`padding-bottom`. Sits between `gap-2` (0.5rem/8px) and `gap-2.5` (0.625rem/10px) — close enough to `2.5` (0.625rem) that most instances could likely snap there with a sub-pixel difference invisible in practice.
4. **`0.3rem` (4.8px) — 26 occurrences**, `gap`/`padding-bottom`. Between `gap-1` (0.25rem/4px) and `gap-1.5` (0.375rem/6px); a fourth "tight-gap-family" value alongside #1/#2 — together `{0.3, 0.35, 0.4}rem` account for **112 occurrences** (over a third of all off-scale raw CSS) and look like an under-specified single design intent ("small gap between inline icon/label pairs") reinvented at 3 close-but-different literal values per component author.
5. **`0.55rem` (8.8px) — 17 occurrences** across 6 different properties (`gap`, `padding`, `padding-top`, `padding-bottom`, `padding-inline`, `margin-top`) — the most propertly-diverse of the top 5, suggesting it's used as a general "slightly-more-than-half-rem" spacing value rather than one specific UI pattern. Close to `gap-2.5` (0.625rem) but also close to `gap-2` (0.5rem); a genuine judgment call for whichever way the design system snaps it.

Runners-up just outside the top 5: `0.45rem` (16×), `0.85rem` (14×, spread across `gap`/`margin-top`/`padding-left`/`padding-bottom`), `0.15rem` (8×), `0.2rem`/`0.1rem` (7× each). The `{0.4, 0.35, 0.45, 0.3}rem` "small-gap" cluster and the `{0.85, 0.6, 0.55}rem` "medium-pad" cluster together represent the bulk of the drift — this reads as two missing tokens (a "tight" gap ~0.35–0.4rem and a "cozy" padding ~0.55–0.6rem) rather than 100+ independent one-off decisions.

## 6. Method notes / reproducibility

- Script: `/tmp/claude-1000/-home-mgkdante-Yesito-projects-transit/cd0cbc0d-7345-4d57-a71b-5a9a4948a56e/scratchpad/census.py` (grep-histogram over class attributes + `<style>` blocks + `.css` files) → `census_results.json`, then `/tmp/claude-1000/-home-mgkdante-Yesito-projects-transit/cd0cbc0d-7345-4d57-a71b-5a9a4948a56e/scratchpad/classify.py` (on-scale/off-scale classification against the Tailwind default scale + tokens.json) → `raw_classified.json`.
- Full occurrence dumps: `all_offscale_raw_css.txt` (446 lines, every off-scale raw-CSS hit with file:line), `top5_detail.txt` (file:line detail for the top-5 values specifically).
- Excluded: `vendor/design/` (read-only canon, per task instructions), any path containing `/tests/`, `.test.`, or `.spec.`.
- `space-x-*`/`space-y-*` utilities were included in the utility regex but 0 occurrences were found in the scanned scope.
- Colors/alignment matched by the bare `text-` prefix (`text-primary`, `text-left`, etc.) were deliberately excluded from the font-size histogram — only genuine font-size candidates (default scale keys, the 13 named `--text-*` tokens, or arbitrary values containing a length unit/`clamp`/`calc`) were counted.
