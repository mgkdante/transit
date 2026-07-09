# Vibe + Style Census — Features: remaining surfaces

**Scope:** `apps/web/src/lib/features/` across `network/`, `stops/`, `receipt/`, `health/`, `hotspots/`, `repeat-offenders/`, `alerts/`, `metrics/`, `search/`, `reliability/`, `trips/` (~110 files; 50 `.svelte` files carry `<style>` blocks).
**Method:** grepped for arbitrary Tailwind brackets, inline `style=`, raw color literals, and scanned every `<style>` block for off-token px/rem/em, letter-spacing, box-shadow, gradient, z-index, opacity, blur, backdrop, transition, radius, and filter literals. Token vocabulary read from `apps/web/src/app.css` + `apps/web/src/lib/styles/tokens.css`.

## Headline verdict

This is a **highly disciplined** surface. What is NOT present anywhere in scope:

- **Zero** arbitrary Tailwind bracket utilities (`p-[13px]`, `w-[42rem]`, `text-[13px]`, `bg-[#...]`, `rounded-[10px]`, `shadow-[...]`, `z-[...]`). Grep returned nothing.
- **Zero** raw hex / rgb / rgba / hsl / oklch color literals in any `.svelte` or `.ts` file in scope. Every color routes through a `var(--…)` token.
- **Zero** ad-hoc `box-shadow`, `linear/radial-gradient`, `z-index`, `blur()`, `backdrop-filter`, or `cubic-bezier()` literals inside component style blocks. Shadows/z-index/gradients all come from tokens or the shared `app.css` patterns.
- **124** `font-size` declarations use type-scale tokens (`var(--text-*)`); only **2** are literal (see below).
- Inline `style=` attributes (3 total) are all **dynamic** bindings (rotate-by-bearing, computed px position, `--occ` color var) — not hardcoded vibe.

**The entire drift is one thing:** raw `rem`/`px` **sizing** (gap / padding / margin / a few widths) written directly in `<style>` blocks, bypassing the spacing scale — plus a small tail of off-token `border-radius`, `letter-spacing`, `transition`, `font-size`, and `3px` accent-stripe literals.

### Counts by category (off-token hits, `1px` hairline borders excluded)

| Category | Count | Notes |
|---|---:|---|
| `rem` sizing literals (gap/padding/margin/width/grid) | 370 | house convention; not on any spacing token |
| `px` sizing literals (excl. `1px` hairline) | ~30 | mostly the `2px` focus-ring pattern (sanctioned-ish) + a few `3px` stripes |
| `opacity` numeric literals | 10 | all in JS-driven show/hide + faded-row states |
| `letter-spacing` literals | 5 | `1px` / `0.5px` / `0` |
| `em` literals (`text-underline-offset`) | 4 | `0.2em` / `0.15em` |
| `transition` duration/easing literals | 2 | `150ms ease` (off `--duration-*`/`--ease-*`) |
| `font-size` numeric literals | 2 | `0.7rem`, `0.6875rem` (off type scale) |
| `border-radius` literals (`999px`, `2px`) | 4 | should be `--radius-pill` / `--radius-sm` |

The rem-sizing count (370) is the census. It is a *systemic convention*, not per-file carelessness — the right disposition is a **decision** (mint spacing tokens vs. accept in-style rem as house style), not 370 individual edits.

---

## The 3 repeated ad-hoc patterns (top candidates to become named patterns)

### PATTERN A — Focus-ring triple (`outline: 2px solid var(--ring); outline-offset: 2px`)
Repeated **~15×** verbatim (plus `-2px` / `3px` offset variants). Exact clone of the base rule already in `app.css:280-283`. Occurrences:
`network/…/SectionReporting.svelte:167`, `stops/StopDetail.svelte:774`, `receipt/…/SectionNotReported.svelte:104`, `hotspots/…/HotspotSection.svelte:282,326`, `repeat-offenders/RepeatOffenders.svelte:445`, `repeat-offenders/…/RepeatOffendersSection.svelte:320,386`, `alerts/…/AlertFilters.svelte:161`, `alerts/…/AlertLog.svelte:277,300`, `metrics/MetricInfo.svelte:350,414`, `metrics/MetricsExplainer.svelte:1166,1226,1261`, `search/SearchSurface.svelte:435`, `search/VehicleResultRow.svelte:143`, `trips/TripDetail.svelte:297,452`.
→ **Disposition:** promote to a shared `@utility focus-ring` (and `focus-ring-inset` for the `-2px` variant) in `app.css`, or lean on the existing global `:focus-visible` base rule and delete the per-component copies. `MetricsExplainer` uses `outline-offset: 3px` — an unintentional divergence from the 2px standard; normalize.

### PATTERN B — The "sub-quarter gap" cluster: `0.4rem` (36×) + `0.35rem` (12×) + `0.3rem` (7×) + `0.625rem` (7×)
These are the recurring tight inline-flex chip/glyph gaps and small paddings. They cluster around ~0.375rem (6px) and ~0.625rem (10px) — values that *would* be `gap-1.5` (6px) and `gap-2.5` (10px) on the Tailwind spacing scale but are written raw in style blocks. `0.4rem` alone appears 36× across network/stops/receipt/health/alerts.
→ **Disposition:** mint a small named spacing set (e.g. `--space-chip-gap`, `--space-glyph-gap`) OR standardize these to the nearest quarter-rem and move to Tailwind `gap-*` utilities in markup. High-value because it is the single most-repeated magic number in scope.

### PATTERN C — The "receipt/section panel" box (`gap: 0.85rem; padding: 1.1rem 1.2rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card)`)
Byte-identical block repeated across every `receipt/sections/Section*.svelte` (Headline:70, Affected:57, plus StateCuts/Worst/TimeOfDay/NotReported panels) and echoed by the `network`/`stops`/`hotspots` section-panel shells (`padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg)`). The `0.85rem` / `1.1rem` / `1.2rem` values are off-scale one-offs unique to this panel.
→ **Disposition:** extract a shared `.surface-panel` / `<Panel>` primitive (or `@utility`) with token-driven padding/gap; the `0.85/1.1/1.2rem` literals should resolve to `--space-card-gap` or a new `--space-panel-*` token.

---

## Per-file findings

> Convention for the tables: rows list **genuinely off-token** declarations. `1px solid var(--border)` hairline borders and `var(--…)`-driven values are on-token and omitted. Line numbers are 1-indexed against the current files.

### network/reliability/sections/NetworkSurface.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :584 | gap | `0.5rem 1.25rem` | two-axis wrap gap on a meta row | → `gap-2`/`gap-5` scale or `--space-card-gap` |
| :591 | gap | `1rem` | stack gap | → `gap-4` |
| :597 | gap | `0.4rem` | tight inline gap | **PATTERN B** |
| :603 | letter-spacing | `1px` | eyebrow-ish tracking on a mono label | → `--tracking-wide` / the `.label-*` utilities in app.css |

### network/reliability/sections/SectionByTimeOfDay.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :78 | gap | `0.75rem` | section stack | → `gap-3` |
| :80 | padding | `1rem` | panel pad | **PATTERN C** (panel shell) |
| :88 | gap | `0.4rem` | chip gap | **PATTERN B** |
| :93 | gap | `0.5rem` | row gap | → `gap-2` |

### network/reliability/sections/SectionCancellations.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :74,:84 | gap | `0.75rem` | stack gaps | → `gap-3` |
| :76 | padding | `1rem` | panel pad | **PATTERN C** |

### network/reliability/sections/SectionCompleteness.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :64 | gap | `0.75rem` | stack | → `gap-3` |
| :66 | padding | `1rem` | panel | **PATTERN C** |

### network/reliability/sections/SectionCrowdingByDay.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :60 | gap | `0.75rem` | stack | → `gap-3` |
| :70,:78 | gap | `0.4rem` | chip gaps | **PATTERN B** |

### network/reliability/sections/SectionDelayHistogram.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| (gap/padding rem in style block) | gap/padding | `0.5–1rem` | section spacing | → `gap-*` scale |

### network/reliability/sections/SectionReporting.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :142 | gap/padding | `0.6rem` | tight row | **PATTERN B** (nearest 0.625rem) |
| :167 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :168 | outline-offset | `2px` | focus ring | **PATTERN A** |

### network/reliability/sections/SectionStatusMix.svelte / SectionTrend.svelte / SectionWeekday.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SectionTrend.svelte:89 | media | `min-width: 1024px` | responsive breakpoint | breakpoint literal — matches Tailwind `lg`; acceptable, but not a token. Consider a `--bp-lg` shared value (recurs in stops/metrics). |
| (various) | gap/padding | `0.5/0.75/1rem` | section spacing | → `gap-*` scale |

### stops/StopDetail.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :598 | gap | `0.875rem` | departure row gap | → `gap-3.5` (14px) on scale |
| :599 | padding | `0.75rem 0.875rem` | departure row pad | → `py-3 px-3.5` |
| :622 | gap | `0.35rem` | inline delay-caption gap | **PATTERN B** |
| :637 | margin-inline-end | `0.3rem` | chip glyph spacing | **PATTERN B** |
| :756 | border-radius | `var(--radius-pill, 999px)` | pill chip | drop the `999px` fallback — `--radius-pill` always defined |
| :757 | padding | `0.35rem 0.75rem` | chip pad | **PATTERN B** + `gap-3` |
| :774 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :775 | outline-offset | `2px` | focus ring | **PATTERN A** |

### stops/StopsIndex.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :330 | font-size-adjacent gap/pad | `0.875rem` | list row | → `gap-3.5` |
| :340 | gap/pad | `0.85rem` | row spacing | → `--space-card-gap` (off-scale) |
| :350 | gap | `0.35rem` | inline chip gap | **PATTERN B** |
| :369 | gap/pad | `0.875rem` | list metrics | → `gap-3.5` |

### stops/reliability/sections/StopReliabilitySurface.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :369,:374,:401 | media | `1023.98px` / `1024px` | responsive grid switch | breakpoint literals (Tailwind `lg`); candidate `--bp-lg` shared value |
| :397 | gap | `0.35rem` | rail chip gap | **PATTERN B** |
| (various) | gap/padding | `0.5–1.5rem` | layout spacing | → `gap-*` scale |

### stops/reliability/sections/SectionByRoute / SectionCrowding / SectionDailyTrend / SectionHabits / SectionPercentiles / SectionTimeOfDay / SectionWeekday .svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SectionCrowding.svelte:87 | gap/pad | `0.6rem` | tight row | **PATTERN B** (→0.625rem) |
| SectionDailyTrend.svelte:180 | gap/pad | `0.6rem` | tight row | **PATTERN B** |
| SectionTimeOfDay.svelte:96 | gap/pad | `0.6rem` | tight row | **PATTERN B** |
| (all) | gap/padding | `0.4/0.5/0.75/1rem` | section spacing | → `gap-*` scale / **PATTERN B/C** |

### receipt/AccountabilityReceipt.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| (style block) | gap/padding | `0.5–1.5rem` | receipt layout spacing | → `gap-*` scale |

### receipt/sections/SectionHeadline.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :72 | gap | `0.85rem` | panel stack | **PATTERN C** |
| :73 | padding | `1.1rem 1.2rem` | panel pad | **PATTERN C** (off-scale) |
| :84 | gap | `1.1rem 1.75rem` | metrics grid | **PATTERN C** (off-scale) |

### receipt/sections/SectionAffected.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :59 | gap | `0.85rem` | panel stack | **PATTERN C** |
| :60 | padding | `1.1rem 1.2rem` | panel pad | **PATTERN C** |
| :77 | gap | `0.8rem 1.5rem` | counts grid | → `gap-*` (off-scale 0.8rem) |
| :88 | gap | `0.2rem` | dt/dd stack | → `gap-1` (nearest 0.25rem); off-scale |
| :93 | letter-spacing | `0.5px` | mono caption tracking | → `--tracking-wide` or `.label-metric` utility |

### receipt/sections/SectionStateCuts.svelte / SectionTimeOfDay.svelte / SectionWorst.svelte / SectionNotReported.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SectionStateCuts.svelte:106 | gap/pad | `0.85rem` | panel | **PATTERN C** |
| SectionWorst.svelte:70 | padding | `1.1rem 1.2rem` | panel | **PATTERN C** |
| SectionNotReported.svelte:104 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| SectionNotReported.svelte:105 | outline-offset | `2px` | focus ring | **PATTERN A** |

### health/HealthStatus.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :205 | letter-spacing | `1px` | mono label tracking | → `--tracking-wide` / `.label-*` |
| (style block) | gap/padding | `0.5–1.5rem` | layout | → `gap-*` scale |

### health/sections/SectionConformance.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :108 | gap/pad | `0.15rem` | micro stack | off-scale (2.4px); → `gap-0.5` (2px) |

### health/sections/SectionEnvelope / SectionFreshness / SectionGaps / SectionLanes / SectionNotes / SectionRetention / SectionSources .svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| SectionFreshness.svelte:88 | gap/pad | `0.1rem` | micro stack | off-scale (1.6px); → `gap-0.5` |
| SectionGaps.svelte:44 | border-left | `3px solid var(--dataviz-status-late)` | **accent-stripe** (data-tone left bar) | intentional accent; standardize stripe width → new `--stripe-w` (3px recurs) |
| SectionGaps.svelte:59 | gap/pad | `0.3rem` | inline gap | **PATTERN B** |
| SectionLanes.svelte:174 | gap | `0.2rem` | micro stack | → `gap-1`; off-scale |
| SectionLanes.svelte:213 | gap/pad | `0.15rem` | micro stack | → `gap-0.5`; off-scale |
| SectionSources.svelte:67 | gap | `0.2rem` | micro stack | → `gap-1`; off-scale |

### hotspots/HotspotsBoard.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| (style block) | gap/padding | `0.5–1.5rem` | board layout | → `gap-*` scale |

### hotspots/sections/HotspotSection.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :217,:222 | gap | `0.625rem` | tab-pane stack | **PATTERN B** (→ `gap-2.5`) |
| :267 | border-bottom | `3px solid transparent` | **accent-stripe** (active-tab underline) | intentional; standardize `--stripe-w` |
| :282,:326 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :283 | outline-offset | `-2px` | inset focus ring | **PATTERN A** (inset variant) |
| :327 | outline-offset | `2px` | focus ring | **PATTERN A** |

### repeat-offenders/RepeatOffenders.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :445 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :446 | outline-offset | `2px` | focus ring | **PATTERN A** |
| (style block) | gap/padding | rem literals | layout | → `gap-*` scale |

### repeat-offenders/sections/RepeatOffendersSection.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :255,:260 | gap | `0.625rem` | list stack | **PATTERN B** |
| :305 | border-bottom | `3px solid transparent` | **accent-stripe** (active-tab underline) | intentional; `--stripe-w` |
| :320 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :321 | outline-offset | `-2px` | inset focus ring | **PATTERN A** |
| :336 | gap | `0.2rem` | micro stack | → `gap-1`; off-scale |
| :386 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :387 | outline-offset | `2px` | focus ring | **PATTERN A** |

### alerts/AlertHistory.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| (style block) | gap/padding | rem literals | layout | → `gap-*` scale |

### alerts/sections/AlertFilters.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :152 | gap/pad | `0.15rem` | micro | → `gap-0.5`; off-scale |
| :155 | text-underline-offset | `0.2em` | underline offset | em literal; → `--underline-offset` token (recurs 4×) |
| :158 | text-decoration-thickness | `2px` | underline weight | literal; standardize with the em-offset above |
| :161 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :162 | outline-offset | `2px` | focus ring | **PATTERN A** |

### alerts/sections/AlertLog.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :169 | gap/pad | `0.7rem` / `0.9rem` | row spacing | off-scale; → `gap-*` |
| :177 | width | `3px` | **accent-stripe** (severity-tone left bar, `background: var(--alert-tone)`) | intentional data-tone stripe; `--stripe-w` |
| :214 | gap/pad | `0.3rem` / `0.7rem` | inline gaps | **PATTERN B** |
| :243 | gap/pad | `0.15rem` | micro | → `gap-0.5` |
| :270,:294 | text-underline-offset | `0.2em` | underline offset | em literal; → shared token |
| :274,:297 | text-decoration-thickness | `2px` | underline weight | literal |
| :277,:300 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :278,:301 | outline-offset | `2px` | focus ring | **PATTERN A** |
| :307,:308 | width / height | `1px` | visually-hidden sr-only clip box | a11y idiom (`.sr-only`); acceptable — consider shared `@utility sr-only` |
| :310 | margin | `-1px` | sr-only clip | a11y idiom; same as above |

### metrics/EasterProse.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :54 | text-underline-offset | `0.15em` | prose underline offset | em literal; → shared token |
| :55 | text-decoration-thickness | `1px` | underline weight | literal |

### metrics/MetricInfo.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :301 | inline `style=` | `left:{fixedLeft}px; top:{fixedTop}px; transform:{transform}` | JS-positioned floating tooltip | dynamic — acceptable (computed at runtime) |
| :331,:332 | inline/block-size | `1.05rem` | (i) trigger button size | off-scale; → a sizing token or `size-*` scale |
| :335 | border-radius | `999px` | circular trigger | → `var(--radius-pill)` |
| :350,:414 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :351,:415 | outline-offset | `2px` | focus ring | **PATTERN A** |
| :355 | **font-size** | `0.7rem` | (i) glyph size | **off type scale** → nearest `--text-micro` (0.75rem) |
| :375 | max-inline-size / calc | `2 * 8px` | viewport-margin clamp | `8px` inset literal; → `--radius-md`-adjacent or a spacing token |
| :383,:386,:423,:426 | opacity | `0` / `1` | tooltip fade in/out states | JS-driven visibility; `0`/`1` are semantic endpoints — acceptable, not token candidates |
| :416,:1263 | border-radius | `2px` | tiny inner-focus radius | → `var(--radius-sm)` (4px) or a `--radius-xs` if 2px is intended |

### metrics/MetricsExplainer.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :834 | media | `min-width: 1024px` | responsive grid | breakpoint literal (`lg`); candidate `--bp-lg` |
| :959 | gap/pad | `0.1rem` | micro | → `gap-0.5`; off-scale |
| :971 | **font-size** | `0.6875rem` | tiny meta label | **off type scale** (11px) → `--text-micro` (0.75rem) or mint `--text-nano` |
| :1034 | border-left | `3px solid var(--border-rule-accent, var(--border))` | **accent-stripe** (methodology block) | intentional; `--stripe-w` |
| :1142,:1202 | min-height | `44px` | a11y tap target | **sanctioned** WCAG 44px min; consider `--tap-target` token (recurs) |
| :1144,:1204 | border | `2px solid var(--border-brand)` | emphasis border | `2px` literal; on-brand but off any width token |
| :1147,:1207 | box-shadow | `inset 0 1px 0 var(--edge-highlight)` | inner top highlight | matches the `--shadow-card` inset idiom but written raw; → extract `--shadow-inset-edge` |
| :1151,:1211 | letter-spacing | `0` | explicit reset | acceptable (reset), or drop if default |
| :1166,:1226,:1261 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :1167,:1227 | outline-offset | `3px` | focus ring | **PATTERN A** — but `3px` diverges from the 2px standard; normalize |
| :1183,:1186 | opacity | `0.5` / `0` | dimmed/hidden state | `0.5` is off the opacity token set (`--opacity-muted` 0.6 / `--opacity-dim` 0.3) → map to nearest or add `--opacity-half` |
| :1191,:1243 | filter | `drop-shadow(0 0 4px …var(--glow)…)` / `(0 0 3px …)` | glow flourish | color is tokenized; the `4px`/`3px` blur radii are literals → extract a `--glow-drop` shadow token |
| :1262 | outline-offset | `2px` | focus ring | **PATTERN A** |

### search/SearchSurface.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :435 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :436 | outline-offset | `2px` | focus ring | **PATTERN A** |
| (style block) | gap/padding | rem literals | layout | → `gap-*` scale |

### search/VehicleResultRow.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :89 | inline `style=` | `transform: rotate({vehicle.bearing}deg)` | heading arrow rotation | dynamic — acceptable |
| :115 | inline `style=` | `--occ:{occColor}` | occupancy tone var | dynamic — acceptable (sets a var, doesn't hardcode) |
| :137 | transition | `background-color 150ms ease` | hover transition | **off motion tokens** → `var(--duration-fast) var(--ease-default)` |
| :159 | transition | `transform 150ms ease` | hover transition | **off motion tokens** → `var(--duration-fast) var(--ease-out)` |
| :143 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :144 | outline-offset | `2px` | focus ring | **PATTERN A** |
| :211 | gap/pad | `0.3rem` | inline gap | **PATTERN B** |

### trips/TripDetail.svelte
| file:line | property | literal | intent | disposition |
|---|---|---|---|---|
| :287,:436 | opacity | `0.45` | faded (skipped/past) row | **off opacity token set** (`--opacity-dim` 0.3 / `--opacity-muted` 0.6) → mint `--opacity-fade` (0.45) or snap to nearest |
| :293,:448 | opacity | `1` | active-row reset | acceptable endpoint |
| :294,:449 | transform | `translateX(2px)` | subtle active-row nudge | `2px` micro-nudge literal; keep, or `--nudge` token if it recurs |
| :297,:452 | outline | `2px solid var(--ring)` | focus ring | **PATTERN A** |
| :298,:453 | outline-offset | `2px` | focus ring | **PATTERN A** |
| :320,:321 | gap/pad | `0.45rem` | inline gaps | off-scale; → **PATTERN B** neighborhood |

### metrics/easterWordHover.ts (motion note, not a token violation)
GSAP timeline durations (`0.3`, `0.15`, `0.25`, `0.5`) and eases (`back.out(1.7)`, `power2.out`, `elastic.out`, `sine.out`) at lines 26–52. These are **GSAP-native** motion values byte-mirrored from the house `wordmarkHover` family — they do not map to the CSS `--duration-*`/`--ease-*` tokens by design. **No action** unless the team wants a JS-side motion-token layer.

---

## Files with NO off-token findings (clean)

All `.ts` selectors/data files (`selectors/*.ts`, `data/*.ts`, `*.copy.ts`, `reliability/domains.ts`, `reliability/shiftGrains.ts`, `metrics.content.ts`, `easterWords.ts`) and all `*.test.ts` — **zero** visual literals. The `.copy.ts` files are pure strings; the selectors are pure math. `search/search.copy.ts`, `trips/trips.copy.ts`, `metrics/metrics.copy.ts`, etc. carry no CSS.

---

## Recommended dispositions, ranked

1. **PATTERN A → shared focus utility.** ~15 verbatim copies of the focus ring + the app.css base rule already exists. Extract `@utility focus-ring` / `focus-ring-inset`; normalize the two `outline-offset: 3px` MetricsExplainer divergences to 2px. Highest DRY win, zero visual change.
2. **PATTERN C → `<Panel>` / `.surface-panel`.** The receipt-panel box is copy-pasted across ~6 files with off-scale `0.85/1.1/1.2rem`. One primitive, token-driven padding.
3. **PATTERN B → mint 2–3 tight-gap tokens** (`--space-chip-gap` ≈ 0.375rem/6px, `--space-glyph-gap` ≈ 0.3rem, and a 0.625rem/10px step) or snap all to Tailwind `gap-1.5`/`gap-2.5` in markup. Kills the single most-repeated magic number (`0.4rem` ×36).
4. **Radius fixes** (fast): `border-radius: 999px` → `--radius-pill` (MetricInfo:335); drop the `999px` fallback (StopDetail:756); `border-radius: 2px` → `--radius-sm` or a new `--radius-xs` (MetricInfo:416,1263).
5. **Motion-token the two raw transitions** in VehicleResultRow (`150ms ease` → `var(--duration-fast) var(--ease-*)`).
6. **Off-scale opacities** (`0.45` TripDetail, `0.5` MetricsExplainer): map to the opacity token set or extend it (`--opacity-fade`).
7. **The `3px` accent-stripe** recurs across SectionGaps / AlertLog / HotspotSection / RepeatOffendersSection tabs → mint `--stripe-w: 3px` for the data-tone left/bottom bars.
8. **Two literal font-sizes** (MetricInfo:355 `0.7rem`, MetricsExplainer:971 `0.6875rem`) → snap to `--text-micro` or mint `--text-nano` if a sub-12px tier is genuinely wanted.
9. **`text-underline-offset: 0.2em/0.15em` + `text-decoration-thickness: 1px/2px`** (AlertFilters, AlertLog, EasterProse) → one shared underline pattern.
10. **`min-height: 44px`** tap targets (MetricsExplainer) → `--tap-target` token (a11y-load-bearing, worth naming).
11. **Breakpoint literals** (`1024px` / `1023.98px` in SectionTrend, StopReliabilitySurface, MetricsExplainer) — Tailwind `lg`; low priority, but a shared `--bp-lg` would remove the `1023.98` fencepost duplication.

## Non-issues (explicitly cleared)
- All 3 inline `style=` attributes are dynamic bindings, not hardcoded vibe.
- All colors are tokenized; no hex/rgb/hsl/oklch anywhere in scope.
- No arbitrary Tailwind brackets, no ad-hoc box-shadows/gradients/z-index/blur/backdrop/cubic-bezier in component style blocks.
- `opacity: 0/1`, `letter-spacing: 0`, sr-only `1px`/`-1px` clip idiom, and GSAP timeline values are semantic endpoints / idioms, not token drift.
