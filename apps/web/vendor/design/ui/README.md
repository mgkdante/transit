# @yesid/ui

Source-shipped Svelte 5 UI primitives. Transit is the wave-1 behavior and styling baseline. Consumers import individual families so unused primitives stay out of their bundle.

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

## DESIGN: internal cn configuration

Primitives merge their package classes with the caller's `class` prop. The package uses one module-level merger and exposes a boot-time configuration hook:

```ts
// Run before mounting the first Svelte component.
import { configureUi } from '@yesid/ui/cn';

configureUi({
	vocab: {
		text: ['console-label'],
		colors: ['metric-healthy', 'metric-warning'],
	},
});
```

```svelte
<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
</script>

<Badge class="text-metric-warning">Needs attention</Badge>
```

`configureUi()` is optional. With no call, or after calling it with no arguments, the merger uses the base brand text and color vocabulary from `createCn`. This is the zero-configuration default.

Configuration must happen before the first primitive render. It is last-write-wins, static application configuration scoped to one loaded ESM module instance. Two separately bundled copies of `@yesid/ui` have separate configuration state. Do not derive vocabulary from request, tenant, user, or other request-scoped data. The API is for a product's fixed Tailwind vocabulary, not runtime theming.

Package-owned `tailwind-variants` definitions use the base `twMergeConfig`, which keeps the primitive's own brand vocabulary deterministic. A primitive then passes the generated variant classes and the caller's `class` value to the dynamically configured `cn`; this second merge is where consumer vocabulary is applied.

Svelte context was rejected because it would require providers and instance-level lookups inside every primitive. That changes the structure and runtime behavior of what should remain import-only mechanical ports. A `cn` prop on every component was also rejected: it pollutes every public API and call site, and makes a future third consumer carry plumbing unrelated to the component it wants to use.

There are no consumer checks or app conditionals in the package. A third product extends the vocabulary once at boot, scans the package source in Tailwind, and imports the same primitives as every other consumer.
