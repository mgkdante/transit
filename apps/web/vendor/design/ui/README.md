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
[`v0.13.2 product setup guide`](https://github.com/mgkdante/yesid.dev-design/blob/v0.13.2/docs/BUILD-A-YESID-PRODUCT.md#4-configure-ui-once-per-module-graph-at-boot)
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

The package owns the narrow badge-spec union and keeps the icon renderer private. Its number stays
at `0.75rem` across current products even where a consumer's general `text-micro` token differs.
Broader product table-of-contents helpers remain local.

### TerminalCursor

The package owns rem geometry, blink timing, and reduced-motion behavior. A product preserving
fixed geometry keeps an adapter with 8px width, 14px height, and 4px left margin. yesid.dev also
keeps its dark `accent` and light `accent-text` theme mapping locally; those semantics are not a
package mode.

### QuietModeButton

`QuietModeButton` owns the shared two-button markup, icons, minimum targets, interaction geometry,
active visuals, and reduced-motion CSS. The caller owns copy, state, persistence, locale
resolution, and both actions. `activeEffect="none"` preserves flat marks; `"glow"` adds the scoped
core/bookmark filters without selecting a product.

### CollapsibleSection

The composed section remains consumer-owned. Current products differ in header composition,
control signals, persistence, content ownership, and animation/inert policy, and a third
independent consumer has not established one shared contract. Lower-level Collapsible primitives
remain package-owned; composing them does not authorize promotion of the section controller.

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
