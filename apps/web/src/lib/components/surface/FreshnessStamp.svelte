<script lang="ts">
	import { liveStamp, stampText, type LiveStamp, type RecordStamp } from '#lib/v1/stamp.ts';
	import { cn } from '#lib/utils/index.ts';
	import { type Locale } from '#lib/i18n/index.ts';
	import type { StampPresentation } from '#lib/v1/live/livePresentation.ts';

	import { StatusDot } from '@yesid/ui/brand';

	type Variant = 'live' | 'updated' | 'record';

	export interface FreshnessStampProps {
		presentation?: StampPresentation;
		stamp?: LiveStamp | RecordStamp;
		subject?: 'data' | 'alerts';
		timeZone?: string;
		variant?: Variant;
		locale: Locale;
		label?: string;
		class?: string;
	}

	let {
		presentation,
		stamp,
		subject = 'data',
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
	const live = $derived(
		stamp?.form === 'live'
			? stamp
			: presentation
				? liveStamp({ ...presentation, subject, notResponding: presentation.ageLabel != null })
				: null,
	);
</script>

{#if variant === 'record' && stamp?.form === 'record'}
	{@const text = stampText(stamp, locale, timeZone)}
	{#if text}<span
			class={cn('freshness-stamp', className)}
			data-slot="freshness-stamp"
			data-form="record"><time datetime={stamp.publishedOn ?? undefined}>{text}</time></span
		>{/if}
{:else if variant === 'live' && live}
	<span
		class={cn('freshness-stamp freshness-stamp--live', className)}
		data-slot="freshness-stamp"
		data-variant="live"
		data-form="live"
		data-subject={live.subject}
		data-state={live.state}
		data-stale={live.state === 'behind' ||
			live.state === 'not-responding' ||
			(presentation?.isStale ?? false)}
		data-degraded={presentation?.degraded ? 'true' : undefined}
		data-age-seconds={live.ageSeconds ?? undefined}
	>
		<StatusDot
			color={live.state === 'unknown'
				? 'unknown'
				: live.state === 'current' && !presentation?.degraded
					? 'on_time'
					: 'caution'}
			aria-hidden="true"
		/>
		<time class="freshness-stamp-age" datetime={live.generatedUtc ?? undefined}
			>{stampText(live, locale, timeZone)}</time
		>
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
	.freshness-stamp--updated .freshness-stamp-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.freshness-stamp--live .freshness-stamp-age {
		min-inline-size: 0;
		max-inline-size: 100%;
	}
	.freshness-stamp-age {
		color: var(--muted-foreground);
	}
	.freshness-stamp--updated .freshness-stamp-age,
	.freshness-stamp--live .freshness-stamp-age {
		color: var(--foreground);
	}
</style>
