<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale } from '$lib/i18n';
	import { formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { freshnessAgeSeconds } from '$lib/v1/freshness';
	import { sharedClock } from '$lib/stores';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	type Variant = 'live' | 'updated';

	export interface FreshnessStampProps {
		generatedUtc: string | null;
		ageSeconds?: number | null;
		ageLabel?: string | null;
		isStale?: boolean;
		degraded?: boolean;
		variant?: Variant;
		locale: Locale;
		label?: string;
		class?: string;
	}

	let {
		generatedUtc,
		ageSeconds = undefined,
		ageLabel = null,
		isStale = false,
		degraded = false,
		variant = 'live',
		locale,
		label,
		class: className,
	}: FreshnessStampProps = $props();

	$effect(() => sharedClock.subscribe());

	type Labels = {
		readonly live: string;
		readonly updated: string;
		readonly stale: string;
		readonly unknown: string;
	};
	const L: Record<Locale, Labels> = {
		fr: { live: 'EN DIRECT', updated: 'Mis à jour', stale: 'obsolète', unknown: 'inconnu' },
		en: { live: 'LIVE', updated: 'Updated', stale: 'stale', unknown: 'unknown' },
	};
	const t = $derived(L[locale]);
	const displayLabel = $derived(label ?? (variant === 'live' ? t.live : t.updated));

	const effectiveAge = $derived<number | null>(
		ageSeconds !== undefined
			? ageSeconds
			: freshnessAgeSeconds(generatedUtc, sharedClock.serverNow),
	);

	const ABSOLUTE_AFTER_S = 86_400;
	const relative = $derived.by(() => {
		if (ageLabel != null) return ageLabel;
		if (effectiveAge == null) return t.unknown;
		if (effectiveAge >= ABSOLUTE_AFTER_S && generatedUtc) {
			return formatUtc(generatedUtc, locale, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZoneName: 'short',
			});
		}
		return formatRelativeSeconds(effectiveAge, locale);
	});
</script>

{#if variant === 'live'}
	<span
		class={cn('freshness-stamp freshness-stamp--live', className)}
		data-slot="freshness-stamp"
		data-variant="live"
		data-stale={isStale}
		data-degraded={degraded ? 'true' : undefined}
		data-age-seconds={effectiveAge ?? undefined}
	>
		<StatusDot color={isStale || degraded ? 'caution' : 'on_time'} label={displayLabel} />
		<span class="freshness-stamp-label">{displayLabel}</span>
		<time class="freshness-stamp-age" datetime={generatedUtc ?? undefined}>{relative}</time>
		{#if isStale}
			<span class="freshness-stamp-stale">· {t.stale}</span>
		{/if}
	</span>
{:else}
	<span
		class={cn('freshness-stamp freshness-stamp--updated', className)}
		data-slot="freshness-stamp"
		data-variant="updated"
		data-age-seconds={effectiveAge ?? undefined}
		aria-live="polite"
	>
		<StatusDot color="unknown" aria-hidden="true" />
		<span class="freshness-stamp-label">{displayLabel}</span>
		<time class="freshness-stamp-age" datetime={generatedUtc ?? undefined}>{relative}</time>
	</span>
{/if}

<style>
	.freshness-stamp {
		display: inline-flex;
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
		color: var(--dataviz-status-late);
	}
</style>
