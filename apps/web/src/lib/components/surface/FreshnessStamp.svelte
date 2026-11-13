<script lang="ts">
	import { stampText, type RecordStamp } from '#lib/v1/stamp.ts';
	import { cn } from '#lib/utils/index.ts';
	import { type Locale } from '#lib/i18n/index.ts';
	import type { StampPresentation } from '#lib/v1/live/livePresentation.ts';

	import { StatusDot } from '@yesid/ui/brand';

	type Variant = 'live' | 'updated' | 'record';

	export interface FreshnessStampProps {
		presentation?: StampPresentation;
		stamp?: RecordStamp;
		timeZone?: string;
		variant?: Variant;
		locale: Locale;
		label?: string;
		class?: string;
	}

	let {
		presentation,
		stamp,
		timeZone,
		variant = 'live',
		locale,
		label,
		class: className,
	}: FreshnessStampProps = $props();

	type Labels = {
		readonly live: string;
		readonly updated: string;
		readonly stale: string;
	};
	const L: Record<Locale, Labels> = {
		fr: { live: 'EN DIRECT', updated: 'Mis à jour', stale: 'obsolète' },
		en: { live: 'LIVE', updated: 'Updated', stale: 'stale' },
	};
	const t = $derived(L[locale]);
	const displayLabel = $derived(
		label ?? presentation?.label ?? (variant === 'live' ? t.live : t.updated),
	);
</script>

{#if variant === 'record' && stamp}
	{@const text = stampText(stamp, locale, timeZone)}
	{#if text}<span
			class={cn('freshness-stamp', className)}
			data-slot="freshness-stamp"
			data-form="record"><time datetime={stamp.publishedOn ?? undefined}>{text}</time></span
		>{/if}
{:else if variant === 'live' && presentation}
	<span
		class={cn('freshness-stamp freshness-stamp--live', className)}
		data-slot="freshness-stamp"
		data-variant="live"
		data-form="live"
		data-stale={presentation.isStale}
		data-degraded={presentation.degraded ? 'true' : undefined}
		data-age-seconds={presentation.ageSeconds ?? undefined}
	>
		<StatusDot
			color={presentation.isStale || presentation.degraded ? 'caution' : 'on_time'}
			label={displayLabel}
		/>
		<span class="freshness-stamp-label">{displayLabel}</span>
		<time class="freshness-stamp-age" datetime={presentation.generatedUtc ?? undefined}
			>{presentation.ageText}</time
		>
		{#if presentation.isStale}
			<span class="freshness-stamp-stale">· {t.stale}</span>
		{/if}
	</span>
{:else if presentation}
	<span
		class={cn('freshness-stamp freshness-stamp--updated', className)}
		data-slot="freshness-stamp"
		data-variant="updated"
		data-age-seconds={presentation.ageSeconds ?? undefined}
		aria-live="polite"
	>
		<StatusDot color="unknown" aria-hidden="true" />
		<span class="freshness-stamp-label">{displayLabel}</span>
		<time class="freshness-stamp-age" datetime={presentation.generatedUtc ?? undefined}
			>{presentation.ageText}</time
		>
	</span>
{/if}

<style>
	.freshness-stamp {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.freshness-stamp--live .freshness-stamp-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--accent-text) 70%, var(--foreground));
	}
	.freshness-stamp--updated .freshness-stamp-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.freshness-stamp-age {
		color: var(--muted-foreground);
	}
	.freshness-stamp--updated .freshness-stamp-age {
		color: var(--foreground);
	}
	.freshness-stamp-stale {
		white-space: nowrap;
		color: var(--dataviz-status-late);
	}
</style>
