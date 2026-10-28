# @yesid/ui

Source-shipped Svelte 5 primitives and promoted brand components. The package owns reusable
rendering mechanics; consumers own product copy, policy, state, persistence, routing, and every
recorded compatibility seam. Consumers import individual families so unused primitives stay out
of their bundle.

```svelte
<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
	import { Button } from '@yesid/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '@yesid/ui/card';
	import { Combobox, type ComboboxOption } from '@yesid/ui/combobox';
</script>

<Card>
	<CardHeader><CardTitle>Queue status</CardTitle></CardHeader>
	<CardContent><Badge>Ready</Badge></CardContent>
	<Button>Open queue</Button>
</Card>
```

## Source scanning and application tokens

Because the package ships source, a Tailwind consumer must scan `@yesid/ui/src`. For a workspace
consumer whose stylesheet is under `apps/web/src`, add:

```css
@source "../../../packages/ui/src";
```

For a separately installed package, point the directive at the installed source, for example
`@source "../node_modules/@yesid/ui/src";`. The path is relative to the stylesheet containing
the directive.

`Combobox` preserves a 44px minimum tap target through `var(--size-tap-min)`. Products must define
`--size-tap-min: 44px` in application CSS. Product copy, placeholders, labels, options, and
localized prefixes always stay in the caller.

## Current public component contracts

### Rendered-element ownership

`ButtonProps` and `BadgeProps` discriminate on `href`. `null` or `undefined` selects the
button/span branch; any string, including `href=""`, selects the anchor branch. Each branch
exposes its real element ref, events, and attributes. Anchor-only attributes are rejected on the
button/span branches. Button-only attributes are rejected on the Button anchor branch except for
the wrapper-owned disabled-link API.

Fixed-content `ChevronToggle`, `SectionLabel`, `StopLabel`, and `TerminalCursor` reject `children`
and export named prop types from `@yesid/ui/brand`. `CollapsibleContent` keeps consumer children
but hides the low-level bits-ui `child` hook because the wrapper owns its animation scaffold.

### Combobox

`Combobox` accepts an optional bindable `value?: string | null` and bindable `open`. It forwards
the supported root behavior props and invokes `onValueChange`, `onOpenChange`, and
`onOpenChangeComplete` once per committed change. The input shows the typed query while searching
and the selected label otherwise, including after an external value update. Closing resets the
transient query; clearing commits `null`; disabled state reaches the clear control.

The caller supplies the option catalogue, stable values, visible labels, optional glyphs and
sublabels, precomputed search haystacks, a pure fold function, and all accessible copy. Filtering
uses token-AND matching over the caller's folded haystack. The package does not import product
locale or copy modules.

### Separator

`Separator` has a discriminated surface. The `default` variant delegates to bits-ui and retains
its `child`, `children`, and `decorative` contract. `hazard` and `gradient` render native
wrapper-owned divs, accept native div attributes, and reject delegated-only props. Custom
variants consume `orientation` instead of leaking it to the DOM, apply `maxWidth`, forward the
outer ref, and preserve or default `data-slot` on that outer element.

The package gradient default uses `var(--width-content)` and its labels use the shared station
label vocabulary. A product preserving `var(--container-content)` or its own mono label
typography passes the width or keeps that typography locally. Consumer hazard-color and band-
thickness guards remain product acceptance tests.

### Sheet

Sheet exports named prop types for Root, Trigger, Close, Portal, Content, Overlay, Header, Footer,
Title, and Description. `SheetContentProps.portalProps` excludes portal children because Content
owns the portal body. `closeLabel` owns the close button's accessible copy and defaults to
`"Close"`; callers supply localized copy where required.

### Toggle Group

`ToggleGroupProps` preserves bits-ui's `type="single"`/string and
`type="multiple"`/string-array discrimination while keeping `value` bindable and forwarding the
correct callback type. `ToggleGroupItemProps.value` is a required input; only the element ref is
bindable, and snippet children remain supported.

## UI configuration

Primitives merge package classes with the caller's `class` prop. The package uses one
module-level merger and exposes a boot-time configuration hook:

```ts
import { configureUi, type ConfigureUiResult } from '@yesid/ui/cn';

const result: ConfigureUiResult = configureUi({
	vocab: {
		text: ['console-label'],
		colors: ['metric-healthy', 'metric-warning'],
	},
});
```

`ConfigureUiResult = 'initialized' | 'unchanged'` is observable public API. `configureUi` is
single-assignment per loaded ESM module graph. The first explicit call in an unlocked graph stores
its semantic configuration and returns `'initialized'`. Omitted fields and empty arrays mean the
zero-configuration default. Vocabulary arrays are deduplicated and order-insensitive, so an
equivalent repeat returns `'unchanged'`. A conflicting repeat throws without replacing the first
merger. There is no reset API.

The first `cn` use, including a primitive's first class merge, locks the zero-configuration
default. Products with custom vocabulary must initialize before any primitive renders. Use one
shared initializer imported by both SvelteKit `hooks.client.ts` (`ClientInit`) and
`hooks.server.ts` (`ServerInit`), not a root layout instance script. See the
[`v0.13.3 product setup guide`](https://github.com/mgkdante/yesid.dev-design/blob/v0.18.0/docs/BUILD-A-YESID-PRODUCT.md#4-configure-ui-once-per-module-graph-at-boot)
for the complete hook pattern.

The state boundary is the loaded ESM module graph. Browser and SSR bundles, separately bundled
package copies, workers, and HMR-recreated graphs have independent state. Configuration is fixed
application vocabulary only. Never derive it from a request, tenant, user, locale, or other
runtime-scoped value. A provider/context API and per-component `cn` plumbing remain intentionally
outside the public contract.

Package-owned `tailwind-variants` definitions use the base `twMergeConfig` so package vocabulary
is deterministic. The second `cn` merge is where consumer vocabulary applies. There are no app
checks or consumer conditionals in either stage.

## Primitive family seams

These seams are part of the adoption contract. They identify what the package owns and what a
consumer must retain locally to avoid an unreviewed visual or behavior change.

### Badge

The package owns the shared variants, sizes, rendered-element split, and merge configuration.
Consumer typography may still resolve named tokens differently. In particular, a product that
must preserve its existing number-badge size keeps the relevant class or adapter locally.
`TocBadge` pins its number to `0.75rem` so current products and Gallery agree without changing the
general Badge token contract.

### Button

The package owns the common variants, element split, disabled-link behavior, and `pressBounce`
wiring. The yellow conversion CTA is product behavior, not a shared variant: yesid.dev retains
its conversion signage colors and conversion-only lift/glow in a local wrapper or variant.
The package baseline uses `text-control` for the base and `cta-sm` sizes and `text-caption` for
`xs`. yesid.dev intentionally omits the shared `pressBounce` action and keeps `text-sm` for the
base, `text-xs` for `xs`, and `text-small` for `cta-sm` in its local adapter. Adoption must
preserve that motion absence, local typography, and the product tests rather than adding an
app-specific package branch.

### Card

The shared Card is a flat surface with no bevel or outer shadow; interaction may add a restrained
one-pixel rise and reduced motion removes that transform. Transit tests require the no-shadow,
no-edge-highlight contract. yesid.dev requires an inset `edge-highlight` bevel and hover
`shadow-section`, so that product keeps those rules in a wrapper or local style. This is a hard
consumer conflict, not a package variant.

### Collapsible

`CollapsibleContent` force-mounts by default, adds the grid/clip scaffold, marks closed content
`inert` and `aria-hidden`, and transitions grid rows plus opacity with `--duration-slow` and
`--ease-default`. Reduced motion removes the transition. A consumer replacing a transparent
Content wrapper must account for the extra DOM, forced mounting, closed-state semantics, and both
animation directions.

### Resizable

The package owns pane and group behavior plus the interactive handle baseline. A product that
requires a neutral handle, larger grip radius, or its established marker hooks keeps that chrome
locally. Marker classes with no selector are not by themselves a reason to fork package behavior.

### Scroll Area

Root, viewport binding, axes, scrollbars, thumb, corner, and forwarded props are shared. Current
consumer marker-class and transparent-border spelling differences have no visual effect and do
not create a package variant. Add an adapter only if a live consumer selector establishes one.

### Tabs

The package targets bits-ui's real `data-state="active"` selector and rejects the dead
`data-active:` form. A product may keep its rail height, padding, active shadow, underline
position, and typography locally. Adoption requires visual comparison of those geometry and
active-state details rather than treating the import replacement as sufficient proof.

### Toggle

The package owns the shared pressed state, geometry, icons, disabled behavior, and merge
configuration. Consumer-specific resting foreground, typography, and invalid-state border/ring
rules remain local when required. Toggle Group inherits those Toggle styling decisions while
retaining the typed value contract above.

### Sheet and Skeleton

Sheet's bottom side is the mobile-first default; its overlay, focusable close control, animation,
and side geometry are package-owned. Skeleton is decorative (`aria-hidden="true"`) and its pulse
stops under reduced motion. A product with no prior local family treats first use as a new
product-level visual and accessibility decision, not proof supplied by the package.

### Combobox compatibility

The package public name and DOM hooks are `Combobox`, `ComboboxOption`, `ComboboxProps`, and
`data-slot="combobox"`; no `LineCombobox` compatibility alias exists. Consumers preserve their
caller-provided copy and change imports, types, component names, and any DOM-hook selector
together. The value, options, filtering, glyph, markup, and accessibility behavior do not depend
on a product name.

## Brand components and composed patterns

### BlueprintShell

Nested SVG text normalization is controlled by `normalizeTextFont`. The default normalizes to
`var(--font-mono)`; a consumer preserving presentation-attribute behavior passes `false`. Source
guards compare numeric CSS meaning rather than lexical forms such as `0.30` versus `0.3`.

### ChevronToggle and SectionLabel

These components own their shared SVG/classes and label styles. Both Chevron directions retain
the established 90-degree open rotation. Equivalent class ordering is not a consumer seam.

### StopLabel

The component supports an optional label and heading element and defaults `prefix` to `ARRÊT`.
Locale tables and locale selection stay in the product; the consumer passes the resolved prefix.
No product locale type or copy table enters the package.

### MetroStation

`MetroStation` accepts an optional `roundel` snippet receiving the zero-padded station number.
Omitting it renders the package roundel. A yesid.dev adapter supplies its local number Badge and
preserves the established 2rem roundel and `0.8125rem` text without introducing an app switch.

### StickyPanel

The package owns the shared sticky panel and bindable element ref. yesid.dev's compatibility
adapter keeps `surface-3`, removes the package shadow, and attaches the app-local `scrollChain`
action through that ref with cleanup on unmount. `scrollChain`, Lenis policy, and product surface
semantics do not enter `@yesid/ui`.

### TocBadge

The package owns the narrow badge-spec union and renders icons with the public `SectionIcon`. Its
number stays at `0.75rem` across current products even where a consumer's general `text-micro`
token differs.

### TerminalCursor

The package owns rem geometry, blink timing, and reduced-motion behavior. A product preserving
fixed geometry keeps an adapter with 8px width, 14px height, and 4px left margin. yesid.dev also
keeps its dark `accent` and light `accent-text` theme mapping locally; those semantics are not a
package mode.

### QuietModeButton

`QuietModeButton` owns the shared two-button markup, icons, minimum targets, interaction geometry,
active visuals, and reduced-motion CSS. The caller owns copy and locale resolution. State and both
actions default to the shared `quietMode` store; pass `enabled`, `remembered`, `onToggle`, and
`onRememberToggle` to control it instead. `activeEffect="none"` preserves flat marks; `"glow"` adds
the scoped core/bookmark filters without selecting a product.

### ThemeToggle

`ThemeToggle` is a `role="switch"` signal lamp bound to the shared `theme` store. The caller
supplies one fixed `label`; `aria-checked` carries the state.

### CollapsibleSection

A card with a toggle header, an optional index badge, `icon` and `headerActions` snippets, and an
`anchor` that emits `data-toc` for the TOC family. It follows the shared `quietMode` store by
default; pass `quiet={false}` when another owner already applies it. `sectionKey` stores the
reader's open/closed choice for the tab under `persisted:<sectionKey>`. Quiet mode changes what a
keyed section shows without overwriting that choice. `openSignal` is a product counter: each
change opens the section like a reader click and is stored, so never feed it
`quietMode.openSignal`.

### TocNav, TocPill, and toc helpers

Both take a `TocEntry[]` and an `activeId`; the page owns the active id. `TocNav` is the desktop
list inside a `CollapsibleSection` and skips entries marked `rail`. `TocPill` is the mobile pill
and drawer, hidden at the desktop breakpoint; the caller supplies `openAria` and `closeAria`, and
`onNavigate` defaults to `navigateToc`. `observeActiveToc` reports the active id from
`[data-section-index]` and `[data-toc]` targets, and `onTocNavigate` belongs in `afterNavigate`.
`landTocFragments()` is opt-in for apps whose layout does not already land same-page fragment
links; start it next to `observeActiveToc` and run its cleanup on unmount.

### CornerMarks, StatusDot, MetricDisplay, SectionHeading, and SectionIcon

Stateless atoms. `CornerMarks` draws four corner ticks and needs a positioned parent. `StatusDot`
takes a signal aspect (`orange` to `lunar`) or a data status (`early` to `unknown`), with
optional `pulse` and `ring`. `MetricDisplay` renders `value` and `label`; the `absent` snippet
replaces an empty value and `info` follows the label, so absence text and tooltips stay with the
caller. `SectionHeading` takes `heading` or `overline`, plus `number`, `headingAccent`, and an
`explainer` snippet. `SectionIcon` is the closed `SectionIconName` set that `TocBadge` also uses.

### FilterGroup, FilterSection, FilterSummary, and SearchInput

The listing filter family; every label comes from the caller. `FilterGroup` is a single choice
with an "All" reset (`allLabel`) mapped to `null`; choosing the active item again clears it
unless `allowDeselect={false}`. With `collapsible` it gets a header toggle, and `persistKey`
keeps its open state under `persisted:<persistKey>`. `FilterSection` wraps one block of a filter
panel with the dashed rule. `FilterSummary` shows `countLabel.singular` or `countLabel.plural`
(each with a `{count}` placeholder) by the plural rule of `locale`, plus a `clearLabel` button.
`SearchInput` is the listing search field; `label` is its accessible name.

## Listing frame

`@yesid/ui/layout` exports `ListingFrame`, the listing page template. From 1024px it adds a
vertical edge title (`edgeTitle`, default `heading`) and an accent rail beside the page and hides
the `heading` h1 visually. The header renders the `blueprint` snippet behind `heading`,
`subtitle` and an optional `description`, with an optional `aside` beside them on desktop.
`onHeaderMount(header, frame)` runs once on mount for header motion such as a scroll scrub; return
its cleanup.

The filter column holds the `search` snippet and a panel with the `filters` snippet. From 1024px
the panel is always shown and the column is sticky. Below 1024px a button labelled `filterLabel`
opens it, and `filterPersistKey` keeps that state under `persisted:<filterPersistKey>`. The panel
never uses `inert`; a closed panel is `visibility: hidden` below 1024px only. So from 1024px the
filters are visible and reachable by keyboard before hydration and without JavaScript, and below
1024px opening them needs JavaScript. Wheel scrolling in the sticky column chains to the page
through `scrollChain`.

The frame reads `--chrome-offset`, the height of the fixed site chrome, to pull the header under
it and to park the sticky column below it. It falls back to `0px`.

## Detail frame and article header

`DetailFrame` is the detail and article page template: the `header` snippet, a hazard rule, an
optional `toolbar` band, then a grid of an optional left rail, the center (`children`, with an
optional `summary` on top) and an optional right rail, then `after`. `left` and `right` render in
frame asides that stick below the chrome at `--detail-rail-top` (default `--chrome-offset`) and
hide below 1024px, unless `leftMobile` keeps the left one. `rail` replaces the left cell with the
caller's own element, such as a rail that becomes a sheet on mobile. `railScroll` caps rails to the
viewport with internal scrolling; `paneOwnedRail` stacks the left rail above the center. With
both rails the grid is `1fr 2fr 1fr`, or uses `measure` as the center maximum. With `toc` the
frame tracks the active entry (bind `activeId`), lands same-page fragments when `landFragments` is
set, and shows `TocPill` below 1024px unless `rail` is set. Keep `afterNavigate(onTocNavigate)` in
the app. The root takes ordinary attributes such as `class`, `style` and `data-testid`.

`ArticleHeader` is the header those pages share: back link, optional `category`, the `title` with
its `highlight` keyword in the accent, `subtitle`, `meta` (pending state included), and `actions`
and `controls` snippets. `watermark`, `edgeLeft`, `edgeRight` and the `decorations` snippet draw
decorative chrome; `--article-deco-opacity` sets how strongly it reads. The `canvas` snippet
receives the header element once bound (undefined before and during SSR), for a background canvas.
Like `ListingFrame`, it expects the page to pad its top by `--chrome-offset` and pulls itself under
the chrome.

## Site footer and error page

`SiteFooter` renders the hazard strip, the `brand` snippet with a `tagline`, one labelled
navigation per entry in `groups` (`navLabel` when the accessible name differs from the heading;
`external` links open in a new tab with `rel="noopener noreferrer"`, and `me` adds `rel="me"` for
the owner's own profiles; `after` adds controls
such as a consent button inside the group), and a status row with `statusStart`, a live lamp
(`liveLabel` for screen readers) and today's date. `data-in-view` reports whether it is on
screen.

`ErrorPage` is the error route body: hazard rule, `ErrorIllustration`, `label`, `heading`, `body`,
optional `detail`, `suggestions` in a navigation named `suggestionsLabel`, and a terminal line when
`statusNote` is given. For 404 the scene's sign shows the code; other statuses announce the code
with `role="alert"`. The app keeps its copy and `<svelte:head>`.

## Site root and shared state

`@yesid/ui/layout` exports `SiteRoot`, the app root. On mount it adopts the theme applied by the
app's pre-paint script, restores quiet mode, and starts Lenis through `@yesid/motion`; it cleans
up on unmount and renders no element of its own. Props:

- `smoothScroll` (default `true`): `false` leaves native scrolling.
- `scroller`: `{ wrapper, content }` selectors for an element scroller. `content` must wrap the
  whole scrolling flow. Omit it to scroll the window.
- `quietModeKey`: the localStorage key for the remembered quiet-mode default, `quiet-mode` by
  default.

The app keeps its pre-paint script, which reads the `theme` key and sets `data-theme` before
first paint, and its own navigation, scroll-restoration, and analytics handling.

`@yesid/ui/state` exports the stores that `SiteRoot` initializes:

- `theme`: `current`, `isDark`, `set`, `toggle`, `init`. Dark is the default, system preference
  is ignored, the choice persists under `theme`, `data-theme` is set on `<html>`, `meta[name=
  "theme-color"]` follows `--background`, and a `themechange` event fires on `document`.
- `quietMode`: `enabled`, `remembered`, `closeSignal`, `openSignal`, `set`, `toggle`,
  `rememberCurrent`, `forgetDefault`, `init`. Sections close on `closeSignal` and reopen on
  `openSignal`. `init` closes them when a default is remembered and never issues an open.
- `desktop`: a Svelte `MediaQuery` at the `breakpoint.desktop-min` token (1024px). It is false
  during SSR.

`persisted(key, initial)` is not initialized by `SiteRoot`. It returns tab-scoped state in
`sessionStorage` under `persisted:<key>`: it survives reloads and navigation within the tab and
resets in a new tab. `bind:value={state.value}` works directly. Values must be `LocaleFree`
(strings, numbers, booleans, null, and arrays of those), so store ids and flags, never translated
text. During SSR it returns the seed.

## Base stylesheet

`@yesid/ui/base.css` is the base layer both products share: resets, the dark variant, selection,
focus ring, scrollbar, circuit grid, shared keyframes, label styles and `.glass-chrome`. It imports
`@yesid/tokens/theme.css`, which provides the Tailwind theme and the semantic color utilities
(`bg-primary`, `text-muted-foreground` and the rest). It uses Tailwind v4 directives, so import it
from the app stylesheet after Tailwind:

```css
@import 'tailwindcss';
@import '@yesid/ui/base.css';
```

Like every package stylesheet, it is opt-in; no JavaScript import loads it.

## Adoption verification contract

Package behavior, installed-payload integrity, and product acceptance are separate attestations.
For every exact-tag adoption:

1. Run the vendored `tools/adopt.ts --check` against the schema-2 receipt.
2. Retarget direct-source assertions to the durable package source or the product adapter that now
   owns the behavior. Do not delete a product-specific assertion merely because its old local
   primitive path disappeared.
3. Preserve yesid.dev's conversion Button, Card bevel, Separator, BlueprintShell, MetroStation,
   StickyPanel, TerminalCursor, locale-prefix, and `scrollChain` tests where those seams apply.
4. Preserve Transit's flat Card, no-glow, Collapsible animation, and other consumer-owned guards.
5. Regenerate consumer-owned token outputs and run the consumer's vendor checks, tests, typecheck,
   gates, and production build.
6. Compare affected behavior in the browser across relevant themes, responsive sizes,
   accessibility states, and reduced motion.

Package tests and Gallery browser checks remain required upstream, but neither proves that an
external consumer retained its product-specific behavior. This installed guide is the durable
owner for the package/consumer UI seams and verification duties listed above.

## Commands, failures, and release implications

```sh
bun run --cwd packages/ui test
bun run --cwd packages/ui check
bun run api:check
```

An import/type failure points to a public interface or consumer-tooling mismatch. A package test
failure belongs to shared rendering mechanics; a Gallery failure belongs to neutral integration;
a product-only visual or policy failure stays in that product. Do not cure one layer by moving
its policy into another.

Source, public-interface, compatibility-documentation, or README changes alter the coordinated
release payload. Use [`RELEASING.md`](https://github.com/mgkdante/yesid.dev-design/blob/v0.18.0/RELEASING.md), regenerate the API report only for
public-interface changes, and preserve consumer seams through separate adoption verification.
