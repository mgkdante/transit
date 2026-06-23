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
	import { cn } from '$lib/utils';
	import type { Locale } from '$lib/i18n';
	import { describeAbsence, type AbsenceReasonKey } from '$lib/site/absence';

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

{#if variant === 'inline'}
	<span
		class={cn('absent-value absent-value--inline', className)}
		data-slot="absent-value"
		data-variant="inline"
		data-tone={d.tone}
		aria-label={ariaLabel}
	>
		<!-- Subtle unknown glyph, the calm middle dot, decorative (text carries meaning). -->
		<span class="absent-value-glyph" aria-hidden="true">·</span>
		<span class="absent-value-label">{d.label}</span>
		<span class="absent-value-sep" aria-hidden="true">·</span>
		<span class="absent-value-why">{d.why}</span>
	</span>
{:else}
	<div
		class={cn('absent-value absent-value--block', className)}
		data-slot="absent-value"
		data-variant="block"
		data-tone={d.tone}
		role="status"
		aria-label={ariaLabel}
	>
		<span class="absent-value-glyph" aria-hidden="true">·</span>
		<span class="absent-value-label">{d.label}</span>
		<p class="absent-value-why">{d.why}</p>
	</div>
{/if}

<style>
	/* The honest-absence accent rides the dataviz UNKNOWN scale (a DATA verdict),
	   never the semantic affordance tokens. Calm + muted by design. */
	.absent-value {
		--absent-accent: var(--dataviz-status-unknown);
		color: var(--muted-foreground);
		font-family: var(--font-body);
	}

	/* Inline: a single muted in-row value, label · why. */
	.absent-value--inline {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-size: var(--text-small);
	}
	.absent-value--inline .absent-value-label {
		font-weight: 600;
		color: var(--foreground);
	}

	/* Block: a calm centered panel, glyph + label heading + why. */
	.absent-value--block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
		padding: 1.5rem;
	}
	.absent-value--block .absent-value-label {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-body);
		color: var(--foreground);
	}
	.absent-value--block .absent-value-why {
		font-size: var(--text-small);
		color: var(--muted-foreground);
		max-width: 24rem;
		margin: 0;
	}

	/* The glyph carries the muted unknown accent (color + glyph + text). */
	.absent-value-glyph,
	.absent-value-sep {
		color: var(--absent-accent);
		font-family: var(--font-mono);
		line-height: 1;
	}
</style>
