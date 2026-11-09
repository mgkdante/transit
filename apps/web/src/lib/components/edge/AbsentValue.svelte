<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import { describeAbsence, type AbsenceReasonKey } from '#lib/site/absence.ts';
	import { StateNotice } from '@yesid/ui/feedback';

	type Variant = 'inline' | 'row' | 'block' | 'compact';

	export interface AbsentValueProps {
		reason: AbsenceReasonKey;
		locale: Locale;
		params?: Readonly<Record<string, string | number>>;
		variant?: Variant;
		class?: string;
		disclosure?: boolean;
	}

	let {
		reason,
		locale,
		params,
		variant = 'inline',
		disclosure = true,
		class: className,
	}: AbsentValueProps = $props();

	const reasonId = $props.id();
	const d = $derived(describeAbsence(reason, locale, params));

	const ariaLabel = $derived(`${d.label}, ${d.why}`);
</script>

{#if variant === 'compact'}
	<span
		class={['compact-absence', className]}
		data-slot="absent-value"
		data-variant="compact"
		data-density="compact"
		data-tone={d.tone}
		aria-label={ariaLabel}
		title={disclosure ? undefined : d.why}
	>
		{#if disclosure}
			<button
				type="button"
				popovertarget={reasonId}
				aria-label={ariaLabel}
				aria-describedby={reasonId}>{d.label}</button
			>
			<span id={reasonId} popover="auto" class="absence-reason">{d.why}</span>
		{:else}{d.label}{/if}
	</span>
{:else}
	<StateNotice
		title={d.label}
		body={d.why}
		glyph="·"
		presentation={variant === 'row' ? 'row' : variant === 'block' ? 'silo' : 'pill'}
		tone="neutral"
		role={variant === 'block' ? 'status' : undefined}
		aria-live={variant === 'block' ? 'polite' : undefined}
		aria-label={ariaLabel}
		class={className}
		data-slot="absent-value"
		data-variant={variant === 'block' ? 'block' : 'inline'}
		data-density={variant === 'inline' ? 'chip' : variant}
		data-tone={d.tone}
	/>
{/if}

<style>
	.compact-absence {
		display: inline-flex;
		max-inline-size: 100%;
		min-inline-size: 0;
		color: var(--muted-foreground);
		font-size: var(--text-micro);
		line-height: 1.4;
		white-space: nowrap;
	}
	.compact-absence button {
		min-inline-size: 0;
		/* A full-size tap target that keeps the stat cell's line height:
		   the negative block margins cancel the extra height in layout. */
		min-block-size: 2.75rem;
		margin-block: calc((1lh - 2.75rem) / 2);
		overflow: hidden;
		text-overflow: ellipsis;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		white-space: inherit;
		cursor: help;
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
	}
	.compact-absence button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.absence-reason {
		max-inline-size: min(24rem, calc(100vw - 2rem));
		margin: auto;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--foreground);
		font-size: var(--text-small);
		line-height: 1.5;
		white-space: normal;
		overflow-wrap: normal;
		word-break: normal;
	}
</style>
