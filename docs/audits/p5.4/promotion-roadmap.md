# P5.4 PROMOTION ROADMAP — the `@yesid/ui-*` extraction plan

> Written at the close of P5.4 (b→e). This is the plan for a **separate later cross-repo
> session** — standing up shared `@yesid/ui-*` Svelte-component packages and migrating BOTH
> transit and yesid.dev onto them. P5.4 deliberately did NOT do this: it built every new
> component **transit-local but promotion-ready** (token-driven, app-agnostic, no app
> conditionals, clean props), so the extraction below is a mechanical lift, not a redesign.
>
> Source of the split: `reuse-audit.md` §0 + the "PROMOTE vs BUILD-LOCAL" table. This doc
> updates that plan with what P5.4 actually built.

## 0. The structural fact (unchanged from the reuse audit)

`@yesid/{tokens,motion,gates}` (vendored at `apps/web/vendor/design`) ships **ZERO Svelte
components** — only tokens, motion actions, gate logic. Every shared *component* is today a
**copy-fork** between `transit/…/lib/components` and `yesid.dev/…/lib/components`, and forks
drift (the TerminalPanel dots + the two divergent schedule grids + the two head systems were
all fork-drift symptoms P5.4 fixed). Standing up `@yesid/ui-*` is the durable fix: one source,
both apps consume it, drift becomes impossible by construction.

## 1. What P5.4 built (promotion-ready, transit-local today)

Each of these was built to drop into a shared package with **zero code change** (tokens only,
no app conditionals, props-driven):

| component | path (transit) | package target | notes |
|---|---|---|---|
| `Masthead` | `brand/Masthead.svelte` | `@yesid/ui-brand` | the ONE head family (merged SurfaceHeader + ArticleShell). kicker → title+dot → lede → meta → tape. |
| `DetailShell` | `layout/DetailShell.svelte` | `@yesid/ui-detail` | full-bleed dot-grid header band + hazard tape + 3-col grid (1fr 2fr 1fr @1024) + observeActiveToc + TocPill. **DRYs yesid's OWN project≈blog copy-paste** — the strongest promote win. |
| `ScheduleTable` | `schedule/ScheduleTable.svelte` | transit-local (domain) | grid + board modes. Transit-domain (routes/headsigns/delays) — NOT a yesid concept; stays local. |
| `FilterGroup` | `filter/FilterGroup.svelte` | `@yesid/ui-detail` | ported FROM yesid; controlled (activeKey + onSelect), owns no URL/state. Rewired to transit i18n — the reconciliation step below merges the two. |
| `FilterSummary` | `filter/FilterSummary.svelte` | `@yesid/ui-detail` | ported FROM yesid; count + clear. Same reconciliation. |
| `SurfaceControls` (grainHints) | `surface/SurfaceControls.svelte` | transit-local | the grain rail + the new positive per-grain hint. Transit-domain (grain/data-depth). |
| `TerminalPanel` | `brand/TerminalPanel.svelte` | `@yesid/ui-brand` | the framed control-room chassis; the signal-head lights are an **opt-in** (transit keeps them; a `signalHead?` prop lets yesid's `TerminalChrome` merge in). |
| `CornerMeta` | `brand/CornerMeta.svelte` | `@yesid/ui-brand` | blueprint-margin corner readouts. Needs a `position:relative` host with a clearance band (see the P5.4c metrics `.metrics-header-content` padding pattern). |

## 2. Package split (v0.4.0 — three new Svelte packages)

- **`@yesid/ui-primitives`** — the `ui/` shadcn set (card w/ `interactive`, badge, tabs,
  toggle, **toggle-group**, separator, **collapsible**, scroll-area, resizable, tooltip) +
  `StatusDot`, `SectionIcon`, `CornerMarks`, `ChevronToggle`, a `Pill`. Pure, token-driven.
- **`@yesid/ui-brand`** — `TerminalChrome`/`TerminalPanel` (signalHead opt-in), `SectionHeading`,
  `SectionLabel`, **`Masthead`**, `MetricDisplay`, `StopLabel`, `MetroStation`, `CornerMeta`.
- **`@yesid/ui-detail`** — **`DetailShell`**, `TocNav`, `TocPill`, `TocBadge`,
  `CollapsibleSection`, `toc.ts`, **`FilterGroup`**, **`FilterSummary`**, `ListingMobileFilters`
  (port from yesid; transit does not yet ship it — see §5).

## 3. Fork-reconciliation register (resolve BEFORE lifting each to the shared package)

The two apps' copies must be diffed and merged into one superset before extraction. Known drift:

| component | drift to reconcile |
|---|---|
| `FilterGroup` / `FilterSummary` | transit's port dropped yesid's `accentColor`, rewired i18n (`Locale`/`getLocale` vs `resolveLocale`/`siteLabels`) + `persisted` path (`$lib/stores` vs `$lib/state`). The shared version needs an **i18n adapter seam** (each app injects its locale resolver) — this is the main cross-repo design task. |
| `TocNav` / `CollapsibleSection` | already drifted (files differ) — transit added `closeSignal`/`openSignal` (S10 FOCUS/quiet). The shared version keeps the signals (yesid can ignore them). |
| `SectionHeading` | transit heavily extended (overline mode, NumberedChip, explainer slot). Promote the transit superset. |
| `ui/card` | transit added `interactive` + `card-surface`. Promote the superset with `interactive` as a shared prop. |
| `TerminalChrome` vs `TerminalPanel` | one component, `signalHead?: boolean` (default false); transit sets true, yesid keeps its head. |
| `DetailShell` | transit's owns `observeActiveToc` + exposes `activeId` `$bindable`; yesid's project/blog pages own the observer inline. The shared DetailShell takes transit's owning model; yesid's two pages re-platform onto it (killing their copy-paste). |

## 4. Migration sequence (the later session)

1. **Scaffold** `@yesid/ui-{primitives,brand,detail}` in the design repo (the same build/export
   convention as `@yesid/{tokens,motion,gates}`); wire an **i18n adapter interface** (locale
   resolver injected by each consuming app) so `FilterGroup`/`FilterSummary`/copy-carrying
   components are app-agnostic.
2. **Lift primitives** first (least drift): the `ui/` set + StatusDot/SectionIcon/etc. Point
   both apps' imports at `@yesid/ui-primitives`; delete the forks.
3. **Lift brand**: Masthead, TerminalChrome(signalHead), SectionHeading(superset), CornerMeta.
   transit already consumes these locally — swap the import path; delete the forks.
4. **Lift detail**: DetailShell + the ToC kit + FilterGroup/FilterSummary. **Re-platform
   yesid's `ProjectDetailPage` + `BlogDetailPage` onto the shared DetailShell** (kills their
   copy-paste — the headline win). transit's /metrics + /status already consume DetailShell.
5. **Bump** the design repo to v0.4.0; both apps pin it; run both apps' full gates + a
   cross-app visual convergence pass.

## 5. Stays transit-local (NOT promoted — domain-specific)

- `ScheduleTable` (routes/headsigns/delays — a transit concept).
- `SurfaceControls` + `GrainPicker` + the grain-availability clamp (grain/data-depth is a
  transit-domain concern; yesid has no grain rail).
- The per-surface feature screens + selectors + the `$lib/filters` URL codec.
- `ListingMobileFilters` is a yesid component transit does **not** yet ship; port it into
  `@yesid/ui-detail` during the extraction only if a transit surface adopts a mobile filter
  drawer (none does today — FilterGroup's own `collapsible` covers mobile clutter).

## 6. Deferred from P5.4 (owned by later slices, not this roadmap)

- The full 5-surface **SurfaceRail** left-rail refactor was **de-scoped** in P5.4d (operator
  call: the surfaces already share `SurfaceControls`/`GrainPicker` seated-sticky, only /alerts
  has real categorical filters, and each surface's grain is welded to a bespoke URL codec a
  shared rail must not own — high risk, near-zero DRY win). If a future slice wants the left-rail
  *layout*, `SurfaceControls` already forwards `sticky`+`nav` and each surface keeps its codec —
  it is a per-surface layout change, not a shared-state change.
- `--chart-stroke-*` / `--chart-dash-*` tokenization (frozen P5.2 mark internals) → post-S16.
