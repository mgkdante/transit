<!--
  AbsentValue — the reusable VISUAL primitive for HONEST ABSENCE (slice-S5.1).

  The one calm, muted "this value is unknown, and here is why" surface, reused
  app-wide for a missing FIELD. It is a PURE renderer: it contains ZERO business
  logic — it never infers a reason, never holds a data rule. It takes a typed
  reason (from $lib/site/absence, the logic layer), calls describeAbsence to get
  { label, why, tone }, and renders the calm muted state. All the "what does this
  reason mean / which copy / which language" decisions live in the logic layer.

  Variants
    inline  a muted in-row value, "Delay unknown · not reported", for a single
            absent cell in a list/table row. The middle dot separates the terse
            label from the why (never an em dash).
    block   a calm centered block (EdgeState language) for a whole panel that has
            no value: the muted label as a heading + the why beneath.

  DOCTRINE: tone is "unknown", so the accent rides the dataviz unknown scale
  (--dataviz-status-unknown), never --primary/--destructive — an honest absence is
  NOT an error. Tokens, no hex. data-slot for styling/testing hooks. The subtle
  glyph is aria-hidden (meaning carried by the text); an aria-label states the full
  "label, why" so AT announces the honest absence. Reduced-motion safe (static).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { describeAbsence, type AbsenceReasonKey } from '$lib/site/absence';
	import StateNotice from './StateNotice.svelte';

	type Variant = 'inline' | 'block';

	export interface AbsentValueProps {
		/** The typed absence reason (from the logic layer). */
		reason: AbsenceReasonKey;
		/** UI language. */
		locale: Locale;
		/** Copy params (e.g. { first: '06:00' } / { age: '3 min ago' }) interpolated by the resolver. */
		params?: Readonly<Record<string, string | number>>;
		/** inline (muted in-row value) or block (calm centered panel). Defaults to inline. */
		variant?: Variant;
		/** Optional extra classes on the root. */
		class?: string;
	}

	let { reason, locale, params, variant = 'inline', class: className }: AbsentValueProps = $props();

	// The ONLY call into the logic layer: resolve the render-ready copy + tone.
	// No branching on `reason` here — the resolver owns that.
	const d = $derived(describeAbsence(reason, locale, params));

	// The full honest readout for AT: "label, why" (the visible glyph is decorative).
	const ariaLabel = $derived(`${d.label}, ${d.why}`);
</script>

<StateNotice
	title={d.label}
	body={d.why}
	glyph="·"
	presentation={variant === 'inline' ? 'pill' : 'silo'}
	tone="neutral"
	role={variant === 'block' ? 'status' : undefined}
	ariaLive={variant === 'block' ? 'polite' : undefined}
	{ariaLabel}
	class={className}
	data-slot="absent-value"
	data-variant={variant}
	data-tone={d.tone}
/>
