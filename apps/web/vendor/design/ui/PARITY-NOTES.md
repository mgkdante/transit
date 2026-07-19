# @yesid/ui parity notes (waves 1, 2, and 4)

Transit is the package baseline for wave 1. Its current primitive behavior and classes were ported as-is, with only package import-path changes. Differences found in yesid.dev were recorded here; no yesid.dev behavior was merged into the package and no consumer conditional was added.

**Last updated:** 2026-07-17

Comparison snapshot:

- Transit: `transit/apps/web/src/lib/components/ui/`
- yesid.dev: `yesid.dev/apps/web/src/lib/components/ui/`
- Families reviewed: badge, button, card, collapsible, resizable, scroll-area, separator, tabs, toggle, toggle-group, sheet, skeleton, combobox (originally line-combobox)

Both consumers currently use `bits-ui ^2.16.3`, `clsx ^2.1.1`, `svelte ^5.54.0`, `tailwind-merge ^3.5.0`, `tailwind-variants ^3.2.2`, and `paneforge ^1.0.2`. Transit also supplies `@lucide/svelte ^1.18.0` for Sheet and `@yesid/motion` for Button.

## Prospective v0.7.0 U1 contract (not parity history)

The adoption matrix and detailed family notes below preserve the extraction and wave-promotion snapshots. Their present-tense wording describes those historical comparison points. U1 does not rewrite that evidence; it prospectively tightens the shared package contract for `v0.7.0` as follows:

- Button and Badge now use discriminated native-element props. `href == null` selects the button/span branch; every string, including the empty string, selects the anchor branch. Refs, events, and element-only attributes follow the rendered element.
- Fixed-content `ChevronToggle`, `SectionLabel`, `StopLabel`, and `TerminalCursor` reject `children` and export their prop types. `CollapsibleContent` keeps consumer `children` but hides the low-level `child` hook that its wrapper uses internally.
- Combobox makes its nullable selection optional and bindable, adds bindable `open`, forwards the selected bits-ui root behavior props and lifecycle callbacks, and keeps display text synchronized with external selection changes. Its local query still resets on close, and disabled state reaches the clear control.
- Separator separates the delegated bits-ui default contract from the native hazard/gradient contracts. Custom variants no longer advertise or leak delegated-only props; they preserve native div attributes, outer refs, `data-slot`, and applied `maxWidth`.
- Sheet exports named types for every direct and wrapped public part. Content's nested `portalProps` cannot replace its owned portal children, and `closeLabel` supplies caller-owned accessible close copy with `"Close"` as the fallback.
- Toggle Group preserves the single/string and multiple/string-array prop union without a `never` cast. Root `value` remains bindable; Item `value` is a required input and only its element ref is bindable.

These are API-honesty and state-wiring changes, not a claim that either consumer has completed adoption or visual verification. The historical record starts with the matrix below.

## Adoption matrix

| Family | yesid.dev status | Adoption work for zero visual/behavior change | Existing evidence or conflict |
| --- | --- | --- | --- |
| Badge | Same public surface, different merge config and type classes | Preserve yesid.dev's smaller type where required through consumer classes or a local adapter | No co-located primitive test |
| Button | Same core surface; yesid.dev adds `conversion` and lacks press motion | Keep the marketing-only conversion behavior outside the shared package; decide deliberately whether yesid.dev adopts `pressBounce` | yesid.dev has 12 co-located tests and source guards; two tests require `conversion` |
| Card | yesid.dev exports Root only and uses a bevel plus hover shadow | Keep the bevel/shadow in a yesid.dev wrapper or consumer style; adopt Transit subparts separately | Hard conflict: yesid.dev requires the bevel while Transit tests forbid any Card shadow or edge highlight |
| Collapsible | Root/Trigger match; Content behavior differs | Verify forced mounting, extra DOM, inert state, and transition behavior before replacing yesid.dev Content | Transit consumer test source-locks the animation contract |
| Resizable | Same API, different interaction chrome | Preserve yesid.dev's neutral handle and large grip radius locally if exact appearance is required | No co-located primitive test |
| Scroll Area | Same API and effective styling | Remove or retain yesid.dev's inert marker hook only if a consumer selector starts using it | No co-located primitive test |
| Separator | Same API; content-width token and label typography differ | Alias/override the width token and preserve yesid.dev label styling where required | yesid.dev source guards lock hazard tokens and stripe thickness |
| Tabs | Same exports and variants; active-state implementation and geometry differ | Package fixes the dead bits-ui v2 selector; visually compare rail height, padding, shadow, underline position, and type | Package ports Transit's two co-located selector tests |
| Toggle | Same API; type, foreground, invalid state, and merge config differ | Preserve yesid.dev invalid-state styling and type/color choices locally if still required | No co-located primitive test |
| Toggle Group | Family-local implementation matches | Review only inherited Toggle styling | No co-located primitive test |
| Sheet | Missing from yesid.dev | New surface for yesid.dev; no legacy behavior to preserve | No co-located primitive test |
| Skeleton | Missing from yesid.dev | New surface for yesid.dev; no legacy behavior to preserve | No co-located primitive test |
| Combobox | Missing from yesid.dev | Wave 4 promotes the Transit source under a generic public name; Transit adopts through explicit import, type, component, and DOM-hook renames | Three package tests adapted from Transit consumer coverage |

## Detailed family differences

### Badge

Historical extraction snapshot: the public surface matched through `Badge`, `badgeVariants`, `BadgeVariant`, and `BadgeSize`. Both implementations rendered an anchor when `href` was truthy and a span otherwise. Variants (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`, `tag`, `tag-active`, `number`), sizes (`default`, `xs`, `sm`), attributes, and defaults matched.

Differences:

- Transit passes the base `twMergeConfig` to `tv`; yesid.dev uses the default `tailwind-variants` merge vocabulary.
- Transit `default` and `sm` use `text-caption`; yesid.dev uses `text-xs`.
- Transit `number` uses `text-micro`; yesid.dev uses literal `text-[0.75rem]`.
- Transit and yesid.dev currently define `--text-caption` as `0.8125rem`. Transit defines `--text-micro` as `0.75rem`, while yesid.dev defines it as `0.6875rem`; adopting the class without the corresponding token baseline would shrink yesid.dev's number badge.

### Button

Historical extraction snapshot: the common public surface matched through `Root`, `Button`, `buttonVariants`, `ButtonProps`, `ButtonVariant`, and `ButtonSize`. Button/anchor branching used the consumers' truthy-`href` behavior; disabled-link handling, default `type="button"`, forwarded props, variants other than `conversion`, sizes, and defaults matched.

Differences:

- Transit base type is `text-control`; yesid.dev uses `text-sm`.
- Transit `xs` uses `text-caption`; yesid.dev uses `text-xs`.
- Transit `cta-sm` uses `text-control`; yesid.dev uses `text-small`. Both named yesid.dev tokens currently resolve to `0.9375rem`, but the vocabulary class is different.
- yesid.dev alone exports the `conversion` variant: `bg-accent text-signage-bg`, accent hover, and a conversion-only CTA lift/glow compound variant. Transit intentionally omits this marketing conversion behavior.
- Transit applies `use:pressBounce` from `@yesid/motion` to both anchors and buttons. yesid.dev does not.

Test/adoption conflict:

- yesid.dev's `button.test.ts` has 12 tests through `ButtonTest.svelte`; two require the conversion signage pair and conversion CTA lift.
- `yesid.dev/apps/web/src/tests/style-regressions.test.ts` also requires the conversion variant in source and checks its consumers.
- Transit has no co-located Button test. The package must not add `conversion` merely to satisfy yesid.dev tests; yesid.dev needs a local wrapper/variant or an explicit product-level redesign.

### Card

yesid.dev exports only `Root` and `Card`. Transit additionally exports both short and prefixed names for `Content`, `Description`, `Footer`, `Header`, `Title`, and `Action`.

Transit subpart behavior/classes have no yesid.dev counterpart:

- Content: horizontal padding `px-4`, reduced to `px-3` for a small Card.
- Description: `text-small text-muted-foreground` paragraph.
- Footer: muted half-surface, top border, responsive Card padding, flex row.
- Header: container grid with Action and Description-aware tracks, responsive Card padding, and optional border-bottom padding.
- Title: heading font, `text-body`, snug leading, reduced to `text-small` in a small Card.
- Action: second grid column, spans two rows, aligned top-right.

Root differences:

- Transit adds `interactive?: boolean`, default `false`, and emits `data-interactive="true"` only when enabled.
- Transit interactive Cards rise one pixel on hover; reduced motion removes the transform.
- Transit uses `text-small`; yesid.dev uses `text-sm`.
- yesid.dev always draws an inset `edge-highlight` bevel and adds `shadow-section` on every hover.
- Transit has no bevel or outer shadow. Hover only firms the four-sided border; movement is opt-in through `interactive`.

This is a hard test conflict, not a merge candidate:

- `yesid.dev/apps/web/src/tests/style-regressions.test.ts` requires `inset 0 1px 0 var(--edge-highlight)`.
- `transit/apps/web/src/tests/card-frame-consistency.test.ts` forbids `box-shadow` and `var(--edge-highlight)` in Card.
- `transit/apps/web/src/tests/data-surface-no-glow.test.ts` also forbids shared Card glow tokens.
- `yesid.dev/apps/web/src/tests/surface-spec.test.ts` reads the local Card source directly and will need a wrapper-aware assertion or an updated source target during adoption.

### Collapsible

`Root`, `Collapsible`, `Trigger`, `Content`, their prefixed aliases, `open` binding, and Root/Trigger defaults match.

Content differences:

- yesid.dev is a transparent self-closing `bits-ui` Content wrapper.
- Transit defaults `forceMount` to `true` so close animation can finish.
- Transit uses the bits-ui child snippet to add an outer grid wrapper and inner overflow-clipping wrapper.
- Closed Transit content receives `inert` and `aria-hidden="true"`.
- Transit animates `grid-template-rows: 0fr` to `1fr` and opacity with `--duration-slow` and `--ease-default`.
- Transit disables that transition under `prefers-reduced-motion: reduce`.

`transit/apps/web/src/lib/components/shared/CollapsibleSection.test.ts` source-locks the grid, opacity, timing, and reduced-motion behavior. yesid.dev adoption must account for the extra DOM and forced-mounted closed content rather than treating this as an import-only visual substitution.

### Resizable

Exports and API match: PaneGroup, Pane, Handle, their prefixed aliases, `withHandle=false`, pane-group instance binding, direction handling, and forwarded props.

Differences:

- Transit Handle adds color transitions, primary hover/focus background, primary focus ring, and `data-[active=pointer]:bg-primary` drag feedback.
- yesid.dev Handle remains neutral `bg-border`, uses `ring-ring`, and has no primary hover or pointer-active state.
- Transit uses `focus-visible:outline-none`; yesid.dev uses `focus-visible:outline-hidden`.
- Transit grip uses `rounded-sm`; yesid.dev uses `rounded-lg`.
- yesid.dev includes `cn-resizable-handle` and `cn-resizable-panel-group` marker classes; Transit does not. No selector elsewhere in yesid.dev currently defines either marker, so they have no current visual effect.

### Scroll Area

Exports and behavior match: Root/ScrollArea, Scrollbar/ScrollAreaScrollbar, viewport ref binding, `vertical` default, `horizontal`/`both` modes, caller scrollbar classes, Thumb, Corner, and forwarded props.

Differences are non-visual today:

- yesid.dev adds a `cn-scroll-area-viewport` marker class; Transit does not. No other yesid.dev source defines it.
- yesid.dev uses `border-t-transparent`/`border-l-transparent`; Transit uses the equivalent arbitrary-value forms `border-t-[transparent]`/`border-l-[transparent]`.
- Remaining changes are class ordering and comments.

### Separator

Historical extraction snapshot: exports and API matched through `Separator`, `SeparatorVariant`, and `HazardSize`; variants `default`, `hazard`, and `gradient`; default variant, `hazardSize="md"`, `hazardAngle=-45`, orientation handling, label option, stripe periods, band thickness, animated gradient, data attributes, and reduced-motion fallback.

Differences:

- Transit gradient default `maxWidth` is `var(--width-content)`; yesid.dev uses `var(--container-content)`. yesid.dev must provide the Transit token/alias or pass its old value explicitly to avoid a width change.
- A Transit labeled hazard uses `label-station shrink-0`; yesid.dev uses only `shrink-0`.
- A Transit gradient label uses `label-station mt-2`; yesid.dev owns `mt-2 font-mono text-xs tracking-[3px] text-primary md:text-sm` directly.
- Hazard colors, stripe widths, heights, and animation behavior otherwise match.

yesid.dev source guards lock the hazard tokens and `sm/md/lg` band thickness. Those assertions read the old local source path and need retargeting or wrapper-aware checks during adoption.

### Tabs

Public surface matches: Root/Tabs, Content/TabsContent, List/TabsList, Trigger/TabsTrigger, `tabsListVariants`, and `TabsListVariant`. Root binding/defaults and the `default`/`line` List variants match.

Content difference:

- Transit uses `text-small`; yesid.dev uses `text-sm`.

List differences:

- Transit passes base `twMergeConfig` to `tv`; yesid.dev uses the default merge vocabulary.
- yesid.dev forces horizontal height `h-8`; Transit has no fixed rail height.
- Transit default rail is `bg-card shadow-card`; yesid.dev is `bg-card` plus inert marker `cn-tabs-list-variant-default`.
- Transit line rail adds `p-0`, overriding base `p-[3px]`; yesid.dev retains the base padding and adds inert marker `cn-tabs-list-variant-line`.
- No selector elsewhere in yesid.dev defines either marker.

Trigger differences:

- Transit targets bits-ui v2's real `data-state="active"` through `data-[state=active]:`; yesid.dev uses dead `data-active:` variants.
- Transit scopes active background/text/shadow to the List variant. yesid.dev's active classes are partly unscoped and include dark-only input/background/border rules.
- Transit default active shadow is `shadow-card`; yesid.dev uses `shadow-sm`, with `shadow-none` on the line variant.
- Transit line underline sits at `bottom-[-1px]`; yesid.dev uses `bottom-[-5px]`.
- Transit adds `outline-none` and uses `text-small`; yesid.dev lacks that base outline class and uses `text-sm`.

The package ports Transit's two co-located tests: one requires `data-[state=active]:`; the other forbids `data-active:`. This fixes a dead selector, but rail geometry and styling still need visual adoption review in yesid.dev.

### Toggle

Exports and API match: Root/Toggle, `toggleVariants`, `ToggleSize`, `ToggleVariant`, `ToggleVariants`; variants `default`/`outline`; sizes `default`/`sm`/`lg`; defaults; `pressed` binding; forwarded bits-ui props.

Differences:

- Transit passes base `twMergeConfig` to `tv`; yesid.dev uses the default merge vocabulary.
- Transit base type is `text-small`; yesid.dev uses `text-sm`.
- Transit adds base `text-muted-foreground`; yesid.dev has no explicit resting foreground class.
- Transit `sm` uses `text-caption`; yesid.dev uses `text-[0.8rem]`.
- yesid.dev includes invalid-state border and ring classes (`aria-invalid:*` plus dark variants); Transit omits them.
- Pressed/on state, primary interaction classes, focus ring, geometry, icons, and disabled behavior otherwise match.

### Toggle Group

Historical extraction snapshot: exports, API, and effective class sets matched through Root/ToggleGroup, Item/ToggleGroupItem, context-provided variant/size/spacing/orientation, defaults, the old bindable discriminated-union value cast, data attributes, segmented-control border joining, and gap calculation.

Only formatting, class ordering, and comment wording differ locally. Adoption differences come from the Transit `toggleVariants` used by each Item, as documented above.

### Sheet

Historical extraction snapshot: Sheet was Transit-only; yesid.dev had no Sheet family.

Transit exports direct bits-ui Dialog Root, Trigger, Close, and Portal plus wrapped Content, Overlay, Header, Footer, Title, and Description. It also exports prefixed aliases, `sheetVariants`, and `SheetSide`.

Contract/classes:

- Sides are `left`, `right`, and `bottom`; bottom is the mobile-first default.
- Content uses base popover surface/foreground, `shadow-sheet`, fixed positioning, state-driven enter/exit animation, and side-specific borders/geometry.
- Content accepts `portalProps`, requires children, always renders an Overlay, and defaults `showCloseButton` to `true`.
- The close button uses `@lucide/svelte` X, carries an `sr-only` label, and has focus/disabled behavior.
- Overlay uses the sheet z-index token and scrim token/fallback with state-driven fade.
- Header and Footer are padded column layouts; Footer uses `margin-top: auto`.
- Title uses heading font, `text-base`, snug leading, medium weight. Description uses `text-small text-muted-foreground`.
- `sheetVariants` uses the base `twMergeConfig`.

There is no yesid.dev behavior to merge. Its first adoption is a new feature and needs product-level visual/a11y verification.

### Skeleton

Transit-only; yesid.dev has no Skeleton family.

Transit exports Root/Skeleton. It renders a ref-capable div with `data-slot="skeleton"`, `aria-hidden="true"`, caller classes/children/attributes, `rounded-md`, and solid `bg-muted`. A scoped two-second opacity pulse stops entirely under reduced motion. There is no legacy yesid.dev behavior to preserve.

### Combobox (Wave 4 promotion)

Historical extraction snapshot: Combobox was Transit-only and yesid.dev had no local Combobox family. Wave 1 kept the source internal under `src/primitives/line-combobox` because the Transit name did not pass the third-consumer test. Wave 4 promoted the same behavior at `@yesid/ui/combobox` for the gallery and future products.

The generic package exports are Root/Combobox plus `ComboboxOption` and `ComboboxProps`. The API still accepts a readonly option catalogue, bindable nullable selected value, accessible labels/copy, optional placeholder, a caller-provided fold function, and a root class. No prop or option field changed. `label`, `placeholder`, `clearLabel`, and `emptyLabel` were already caller-owned, so no Transit copy entered the package and no new copy prop was required.

Behavior/classes:

- bits-ui single-select Combobox with portalled Content and roving listbox behavior.
- Local ephemeral query, caller-defined folding, and token-AND filtering against each option's precomputed search haystack.
- Optional glyph/sublabel, selected checkmark, empty state, clear control, and trigger.
- Closing resets the typed query; clearing resets both query and value.
- Tokenized card/listbox chrome, primary interaction states, and minimum tap-target sizing. The source expects the consumer variable `--size-tap-min`; Transit defines it as `44px`, and the gallery/bootstrap guide does the same.

Only names changed. Runtime state, bits-ui wiring, filtering, glyphs, copy inputs, markup shape, and CSS declarations remain the Transit implementation. The one pre-existing package adaptation remains `$lib/utils` to `../../cn/index.js`.

| Transit source name | Package name |
| --- | --- |
| `line-combobox/line-combobox.svelte` | `combobox/combobox.svelte` |
| `LineCombobox` | `Combobox` |
| `LineComboboxOption` | `ComboboxOption` |
| `LineComboboxProps` | `ComboboxProps` |
| `line-combobox` class and `data-slot` prefix | `combobox` |
| `Root` | `Root` (unchanged) |

Transit has three rendered call sites. Its separate adoption change applies this map:

| Transit call site | Old | New |
| --- | --- | --- |
| `features/stops/StopsIndex.svelte` line picker | `$lib/components/ui/line-combobox`, `LineCombobox`, `LineComboboxOption`, and `[data-slot='line-combobox']` | `@yesid/ui/combobox`, `Combobox`, `ComboboxOption`, and `[data-slot='combobox']` |
| `features/alerts/sections/AlertFilters.svelte` line picker | `$lib/components/ui/line-combobox`, `LineCombobox`, `LineComboboxOption` | `@yesid/ui/combobox`, `Combobox`, `ComboboxOption` |
| `features/alerts/sections/AlertFilters.svelte` stop picker | `$lib/components/ui/line-combobox`, `LineCombobox`, `LineComboboxOption` | `@yesid/ui/combobox`, `Combobox`, `ComboboxOption` |

The shared import/type rename also reaches `features/alerts/selectors/entityOptions.ts`; it is supporting code, not a fourth rendered call site. All three component instances keep their existing props unchanged.

No compatibility alias ships for `LineCombobox`: Wave 1 deliberately withheld that package subpath, so there is no published package API to preserve. Transit updates its three call sites when it takes the new tag.

The source comments inherited from Transit claim that empty-plus-blur clears and that closing restores the selected label. The implementation does not bind bits-ui's `inputValue`; existing Transit tests prove the accessible label and bound-value clear, not those display-text claims. Wave 4 does not silently repair that pre-existing behavior during a naming-only port.

## Test and source-path adoption checklist

Transit's only co-located primitive test was ported unchanged apart from its package source path: `tabs/tabs-trigger.test.ts` contains two tests. Combobox had no co-located Transit test, so `combobox/combobox.test.ts` adapts the portable consumer assertions from `StopsIndex.svelte.test.ts` and `AlertHistory.svelte.test.ts`: labelled combobox semantics, nullable bound-value clearing, and two-label-ready caller copy. It also locks the component's token-AND folded filtering and empty state. yesid.dev's local Button test/harness was not merged because it asserts yesid.dev-only conversion behavior.

When yesid.dev flips imports, update or replace direct-source assertions deliberately:

- `apps/web/src/lib/components/ui/button/button.test.ts` and `ButtonTest.svelte`
- `apps/web/src/tests/style-regressions.test.ts` for Button conversion, Card bevel, and Separator source
- `apps/web/src/tests/surface-spec.test.ts` for the local Card source
- `apps/web/src/lib/styles/__tests__/engine-fullbleed-css.test.ts` for the local Separator import string

Transit also has consumer-level guards outside the package test suite that remain part of its acceptance bar:

- `apps/web/src/tests/card-frame-consistency.test.ts`
- `apps/web/src/tests/data-surface-no-glow.test.ts`
- `apps/web/src/lib/components/shared/CollapsibleSection.test.ts`

Passing package tests alone does not prove either consumer has zero visual change. Each consumer adoption needs its own source guards, build, and browser comparison after import replacement.

## Wave 2: brand components

Transit remains the package default. Wave 2 compares these current consumer sources:

- Transit: `transit/apps/web/src/lib/components/brand/` plus `shared/TocBadge.svelte` and `shared/TerminalCursor.svelte`
- yesid.dev: `yesid.dev/apps/web/src/lib/components/brand/` plus `shared/TocBadge.svelte` and `shared/TerminalCursor.svelte`

No component imports either app's locale, copy, icon, or motion modules. Consumer copy stays in consumer code, and the app-local `scrollChain` action remains Tier 2.

### Brand adoption matrix

| Component | Package baseline | yesid.dev zero-change configuration | Verdict / remaining consumer work |
| --- | --- | --- | --- |
| BlueprintShell | Transit nested SVG text is normalized to `var(--font-mono)` | Pass `normalizeTextFont={false}` | Ported with a parity prop; retarget yesid.dev's lexical `.30`/`.50` source guard to numeric semantics |
| ChevronToggle | Implementations are behaviorally identical | Defaults or the same existing props | Ported identical; both direction classes intentionally use the same 90-degree open rotation |
| SectionLabel | Implementations are visually identical | Defaults or the same existing props | Ported identical; centered class order differs only lexically and equivalent label CSS is now component-owned |
| StopLabel | Transit optional label/heading superset, `prefix="ARRÊT"` | Pass the app-owned localized prefix, for example `prefix={STOP_WORD[locale]}` | Ported with a parity prop; no locale context or `cornerMeta.copy.ts` enters the package |
| MetroStation | Transit self-contained roundel | Pass a `roundel` snippet that renders yesid.dev's local Badge | Ported with a parity snippet; the package does not encode a consumer-specific Badge switch |
| StickyPanel | Transit card surface, card shadow, native sticky scrolling | Keep a local compatibility wrapper for `surface-3`, no shadow, and app-local `scrollChain` | Contradictory styling/behavior; package is Transit, with explicit wrapper work rather than a forced shared variant |
| TocBadge | Shared branching and icon registry; number is pinned to the consumers' effective `0.75rem` | No prop difference | Ported identical; the ten-shape icon renderer is private implementation detail, not a ninth public component |
| TerminalCursor | Transit rem geometry, `accent-text`, component-local keyframe | Keep a local CSS wrapper if fixed px geometry and theme-selected accent semantics must remain source-exact | Contradictory source styling but identical at the consumers' current 16px root/current palettes; package is Transit |

### BlueprintShell

The DOM, snippets, labels, crosshairs, opacity behavior, and root hooks match. Transit alone adds a nested SVG `<text>` rule because its assemblies name a font face the app does not register exactly. `normalizeTextFont` defaults to `true`; yesid.dev passes `false` to retain its current presentation-attribute behavior.

yesid.dev's `style-regressions.test.ts` currently regex-locks the source spellings `0.30` and `0.50`. Transit spells the computed-equivalent values `0.3` and `0.5`; adoption must retarget that guard to this package and compare numeric CSS meaning instead of string formatting.

### ChevronToggle and SectionLabel

ChevronToggle has the same props, SVG path, classes, transition tokens, and reduced-motion cutoff in both apps. Its `right` and `down` marker classes currently share the same open transform; wave 2 does not redesign that quirk.

SectionLabel has the same variants and effective classes. Transit emits `block text-center`; yesid.dev emits `text-center block`. The package keeps Transit order. The shared `.label-section`, `.label-station`, and `.label-metric` rules are internalized so a third consumer does not need either app's global stylesheet. Section tracking uses `var(--tracking-eyebrow, 0.1em)`: Transit resolves its token and yesid.dev receives its current literal value through the fallback. Existing consumer-global duplicates compute the same and can be removed during adoption.

### StopLabel

Transit supplies the useful superset: optional `label`, separator omission for the label-less form, and `as="div|h1|h2|h3"`. The package adds only the app-neutral `prefix` prop, defaulting to Transit's `ARRÊT`.

yesid.dev keeps its exhaustive `STOP` / `ARRÊT` / `PARADA` map and locale lookup app-side, then passes the selected string. `cornerMeta.copy.ts` remains app-side too; none of its locale types or copy tables are imported by `@yesid/ui`. Each consumer continues to resolve `--text-micro` through its own tokens.

### MetroStation

The pulse, delay, rail, ties, geometry, and reduced-motion behavior match. The roundel DOM does not: Transit owns a self-contained span, while yesid.dev renders its local Badge with `data-slot="badge"` and its Badge typography/border contract.

The package therefore accepts an optional `roundel` snippet receiving the zero-padded station number. Omitted means the Transit span. A yesid.dev compatibility adapter supplies its existing Badge:

```svelte
{#snippet yesidRoundel(stationNo)}
	<Badge
		variant="number"
		class="station-number-badge"
		style="background-color: var(--signage-bg); color: var(--signage-text);"
		aria-hidden="true"
	>{stationNo}</Badge>
{/snippet}

<MetroStation index={3} roundel={yesidRoundel} />
```

This preserves both DOM contracts without an app check or a yesid-named package variant.

The fixed `2rem` / `0.8125rem` selector is scoped to `[data-slot='badge'].station-number-badge`. It therefore sizes the supplied Badge exactly as yesid.dev does without overriding the Transit default's token-driven `font-size: var(--text-caption)`.

### StickyPanel

The conflict is intentional and is not a package variant. Transit uses `var(--card)` plus `var(--shadow-card)` and pure CSS scrolling. yesid.dev uses `var(--surface-3)`, no shadow, and its Lenis-aware `scrollChain`, which remains app-local under the Tier-2/rule-of-three boundary.

A yesid.dev compatibility wrapper passes a local class for the surface override and uses StickyPanel's bindable element ref to attach `scrollChain` app-side. No `scrollChain` import belongs in `@yesid/ui`; it remains a Tier-2 action in yesid.dev. This is the exact adapter:

```svelte
<script lang="ts">
	import { StickyPanel, type StickyPanelProps } from '@yesid/ui/brand';
	import { scrollChain } from '$lib/motion/actions/scrollChain.js';

	type Props = Omit<StickyPanelProps, 'class' | 'ref'>;

	let { children, top = '6rem', ...rest }: Props = $props();
	let panel = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!panel) return;
		const lifecycle = scrollChain(panel);
		return () => lifecycle?.destroy?.();
	});
</script>

<StickyPanel bind:ref={panel} class="yesid-sticky-panel" {top} {children} {...rest} />

<style>
	:global(.yesid-sticky-panel.yesid-sticky-panel.yesid-sticky-panel) {
		background: var(--surface-3);
		box-shadow: none;
	}
</style>
```

The repeated class raises specificity above the package's scoped `.panel` rule without `!important`. The parity fixture renders this structure, proves the action receives the bound panel, and proves `destroy()` runs on unmount.

### TocBadge

The two consumer implementations are mechanically equivalent. The package owns only the narrow `TocBadgeSpec` union and keeps the identical ten-shape SectionIcon renderer private. It does not pull either app's broader `toc.ts` helpers into the package.

One dependency-level parity fix is required: Transit resolves Badge's `text-micro` to `0.75rem`, while yesid.dev's Badge uses literal `text-[0.75rem]`; the gallery/yesid token named `text-micro` is `0.6875rem`. TocBadge therefore applies literal `text-[0.75rem]` to its number Badge so all three current renderings remain 12px without changing the wave-1 Badge contract.

### TerminalCursor

Transit is self-contained: rem geometry, `accent-text`, a local `terminal-blink` keyframe, and a reduced-motion cutoff. yesid.dev uses equivalent 8px/14px/4px geometry at a 16px root, app-global `blink`, dark `accent`, and light `accent-text`. The current palettes compute to the same visible color, but the source contracts diverge under root scaling or future palette changes.

Wave 2 keeps Transit as-is and exposes standard class/HTML-attribute forwarding. yesid.dev retains fixed-pixel and theme-selected semantics with this exact local adapter:

```svelte
<script lang="ts">
	import { TerminalCursor } from '@yesid/ui/brand';
</script>

<TerminalCursor class="yesid-terminal-cursor" />

<style>
	:global(.yesid-terminal-cursor.yesid-terminal-cursor.yesid-terminal-cursor) {
		width: 8px;
		height: 14px;
		margin-left: 4px;
		background: var(--accent);
	}

	:global([data-theme='light'] .yesid-terminal-cursor.yesid-terminal-cursor.yesid-terminal-cursor),
	:global(.theme-light .yesid-terminal-cursor.yesid-terminal-cursor.yesid-terminal-cursor) {
		background: var(--accent-text);
	}
</style>
```

The package's blink timing and reduced-motion behavior are already visually equal. The wrapper fixture locks the conflicting geometry and dark/light colors without adding DOM.

### Brand test and adoption checklist

Transit co-located tests are preserved with import-path edits only for StopLabel and TocBadge. The private icon renderer carries its existing Transit DOM test as dependency coverage. Package parity tests cite current yesid.dev source lines for BlueprintShell, StopLabel, MetroStation, StickyPanel, TocBadge, and TerminalCursor. Test-only yesid.dev wrapper fixtures prove StickyPanel action setup/cleanup and the exact StickyPanel/TerminalCursor CSS conflicts.

Consumer adoption still needs these app-side changes and proofs:

- Retarget direct local-source assertions, including yesid.dev BlueprintShell/MetroStation guards and Transit ChevronToggle's CollapsibleSection source guard.
- Keep yesid.dev locale tests around the app-owned StopLabel prefix adapter.
- Keep yesid.dev `scrollChain` behavior tests against the app action; the package fixture covers adapter setup/cleanup, while the app test remains responsible for wheel-boundary behavior.
- Run each consumer's full tests/check/build plus dark/light/reduced-motion browser comparison after import replacement. Package and gallery verification alone do not prove a future cascade.
