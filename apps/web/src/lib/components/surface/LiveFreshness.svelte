<!--
  LiveFreshness — the live-tier freshness chip.

  A compact "EN DIRECT · il y a 12 s" badge for live surfaces: a pulsing status
  dot (green when fresh, amber/caution + no pulse when stale), the LIVE label,
  the relative build age, and a "stale" note when the feed is behind. The caller
  passes the live store's freshness fields; this primitive only renders them.

  DOCTRINE: the dot encodes a DATA verdict (fresh vs stale) on the dataviz status
  scale via StatusDot's StatusCode aspects (on_time / late→caution), never
  --primary. a11y: the dot carries an sr-only label; freshness is text + colour.
  Intrinsic bilingual vocabulary lives in a local Record<Locale>.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale } from '$lib/i18n';
	import { formatRelative } from '$lib/utils/time';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	interface LiveFreshnessProps {
		/** ISO 8601 (UTC) build timestamp of the live tier, or null when unknown. */
		generatedUtc: string | null;
		/** Age of the build in seconds, or null when unknown. */
		ageSeconds: number | null;
		/** True when the feed is behind the freshness budget. */
		isStale: boolean;
		/** UI language for the intrinsic labels. */
		locale: Locale;
		/** Optional extra classes on the chip. */
		class?: string;
	}

	let {
		generatedUtc,
		ageSeconds,
		isStale,
		locale,
		class: className,
	}: LiveFreshnessProps = $props();

	type Labels = { readonly live: string; readonly stale: string; readonly unknown: string };
	const L: Record<Locale, Labels> = {
		fr: { live: 'EN DIRECT', stale: 'obsolète', unknown: 'inconnu' },
		en: { live: 'LIVE', stale: 'stale', unknown: 'unknown' },
	};
	const t = $derived(L[locale]);

	const relative = $derived(generatedUtc ? formatRelative(generatedUtc, locale) : t.unknown);
</script>

<span
	class={cn('live-freshness', className)}
	data-slot="live-freshness"
	data-stale={isStale}
	data-age-seconds={ageSeconds ?? undefined}
>
	<StatusDot color={isStale ? 'caution' : 'on_time'} pulse={!isStale} label={t.live} />
	<span class="live-freshness-label">{t.live}</span>
	<span class="live-freshness-age">{relative}</span>
	{#if isStale}
		<span class="live-freshness-stale">· {t.stale}</span>
	{/if}
</span>

<style>
	.live-freshness {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.live-freshness-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.live-freshness-age {
		color: var(--muted-foreground);
	}
	.live-freshness-stale {
		color: var(--dataviz-status-late);
	}
</style>
