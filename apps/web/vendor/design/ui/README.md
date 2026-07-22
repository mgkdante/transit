# @yesid/ui

Source-shipped Svelte 5 UI primitives. Transit is the wave-1 behavior and styling baseline. Consumers import individual families so unused primitives stay out of their bundle.

**Last updated:** 2026-07-17

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

`Combobox` preserves Transit's 44px minimum tap target through
`var(--size-tap-min)`. Products must define `--size-tap-min: 44px` in their
application CSS. Product copy, placeholders, labels, and options stay in the
caller; see [`PARITY-NOTES.md`](PARITY-NOTES.md#combobox-wave-4-promotion).

Because the package ships source, a Tailwind consumer must scan `@yesid/ui/src`. For a workspace consumer whose stylesheet is under `apps/web/src`, add:

```css
@source "../../../packages/ui/src";
```

For a separately installed package, point the same directive at the installed source, for example `@source "../node_modules/@yesid/ui/src";`. The path is relative to the stylesheet containing the directive.

## v0.7 public component contracts

These contracts shipped in `v0.7.0` and remain current in `v0.7.1`. They refine the historical extraction behavior recorded in [`PARITY-NOTES.md`](PARITY-NOTES.md) without rewriting that history.

- `ButtonProps` and `BadgeProps` discriminate on `href`. `null` or `undefined` selects the button/span branch; any string, including `href=""`, selects the anchor branch. Each branch exposes its real element ref, events, and attributes. Anchor-only attributes are rejected on button/span branches, and button-only attributes are rejected on the Button anchor branch except for the wrapper-owned disabled-link API.
- Fixed-content brand components (`ChevronToggle`, `SectionLabel`, `StopLabel`, and `TerminalCursor`) do not accept `children`; their named prop types are exported from `@yesid/ui/brand`. `CollapsibleContent` still accepts consumer children, but it does not expose bits-ui's lower-level `child` render hook because the wrapper owns that hook for its animation scaffold.
- `Combobox` accepts an optional bindable `value?: string | null` and bindable `open`. It forwards the selected root behavior props and calls `onValueChange`, `onOpenChange`, and `onOpenChangeComplete` once per committed change. The input shows the typed query while searching and the current selected label otherwise, including after an external value update. Closing resets the transient query; clearing commits `null`; a disabled Combobox disables its clear control.
- `Separator` has a discriminated surface. The `default` variant delegates to `bits-ui` and keeps its `child`, `children`, and `decorative` contract. `hazard` and `gradient` render native wrapper-owned divs, accept native div attributes, and reject those delegated-only props. Custom variants consume `orientation` instead of leaking it to the DOM, apply `maxWidth`, forward the outer ref, and preserve or default `data-slot` on that same outer element.
- Sheet exports named prop types for Root, Trigger, Close, Portal, Content, Overlay, Header, Footer, Title, and Description. `SheetContentProps.portalProps` excludes portal children because Content owns the portal body. `closeLabel` owns the close button's accessible copy and defaults to `"Close"`; callers provide localized copy when needed.
- `ToggleGroupProps` preserves bits-ui's `type="single"`/string and `type="multiple"`/string-array discrimination while keeping `value` bindable and forwarding the correctly typed callback. The implementation uses branch-specific bindings rather than a `never` cast. `ToggleGroupItemProps.value` is a required input, not a bindable output; `ref` remains bindable and snippet children remain supported.

## v0.7 public cn configuration

Primitives merge their package classes with the caller's `class` prop. The package uses one module-level merger and exposes a boot-time configuration hook:

```ts
// Run before mounting the first Svelte component.
import { configureUi, type ConfigureUiResult } from '@yesid/ui/cn';

const result: ConfigureUiResult = configureUi({
	vocab: {
		text: ['console-label'],
		colors: ['metric-healthy', 'metric-warning'],
	},
});
// A fresh, unlocked module graph returns 'initialized'.
```

```svelte
<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
</script>

<Badge class="text-metric-warning">Needs attention</Badge>
```

`configureUi` is single-assignment per loaded ESM module graph. Its v0.7 return
type is observable public API:

```ts
export type ConfigureUiResult = 'initialized' | 'unchanged';
```

The first explicit call in an unlocked graph stores its semantic configuration
and returns `'initialized'`. Omitted configuration, omitted vocabulary fields,
and empty arrays all mean the zero-configuration default. Vocabulary arrays are
deduped and compared without regard to order, so a semantically equivalent
repeat returns `'unchanged'`. A conflicting repeat throws and leaves the first
merger untouched. There is no reset API.

Calling `configureUi` is optional. The first `cn` use, including a primitive's
first class merge, locks the zero-configuration default. A later empty
`configureUi()` call then returns `'unchanged'`; a later custom configuration
throws. Products with custom vocabulary must therefore initialize before any
primitive renders.

Use one shared initializer imported by both SvelteKit `hooks.client.ts`
(`ClientInit`) and `hooks.server.ts` (`ServerInit`). Do not initialize from a
root layout instance script. See
[`docs/BUILD-A-YESID-PRODUCT.md`](../../docs/BUILD-A-YESID-PRODUCT.md#4-configure-ui-once-per-module-graph-at-boot)
for the complete hook pattern.

The state boundary is the loaded ESM module graph, not an account or an entire
deployment. Separately bundled package copies, the browser bundle, and each SSR
worker have independent state. HMR can recreate a module graph and therefore
recreate its configuration state; the boot hook initializes the replacement
graph again.

Configuration is fixed application vocabulary only. Never derive it from a
request, tenant, user, locale, or other runtime-scoped data.

Package-owned `tailwind-variants` definitions use the base `twMergeConfig`, which keeps the primitive's own brand vocabulary deterministic. A primitive then passes the generated variant classes and the caller's `class` value to the dynamically configured `cn`; this second merge is where consumer vocabulary is applied.

A provider/context API is deferred. The v0.7 contract has no
runtime-scoped configuration and no provider requirement; primitives remain
import-only mechanical ports. A `cn` prop on every component remains rejected:
it would pollute every public API and call site with plumbing unrelated to the
component being used.

There are no consumer checks or app conditionals in the package. A third product extends the vocabulary once at boot, scans the package source in Tailwind, and imports the same primitives as every other consumer.
