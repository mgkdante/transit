<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import { liveReader } from '#lib/v1/adapter/index.ts';
	import { livePresentation } from '#lib/v1/live/livePresentation.ts';
	import { LIVE_FAMILIES, createLiveStore } from '#lib/v1/live/store.svelte.ts';
	import { getHotspots } from '#lib/v1/repositories/historic.ts';
	import { getRoutesIndex } from '#lib/v1/repositories/static.ts';
	import { createResource } from '#lib/v1/resource.svelte.ts';
	import type { Manifest } from '#lib/v1/schemas/index.ts';
	import { FreshnessStamp } from '#lib/components/surface/index.ts';
	import { fmtCount, fmtPct } from '#lib/utils/index.ts';
	import { formatDateKey } from '#lib/utils/time.ts';
	import { selectLivePulse, selectWorst, type PulseRank } from './homePulse';
	import type { HomePulseCopy } from './homePulse.copy';

	interface Props {
		readonly locale: Locale;
		readonly manifest: Manifest;
		readonly copy: HomePulseCopy;
	}

	let { locale, manifest, copy: t }: Props = $props();
	const localizeHref = getLocalizeHref();

	// The provider is fixed for this page's lifetime; switching cities remounts the page.
	const live = untrack(() => createLiveStore(manifest, liveReader, { families: ['network'] }));
	onMount(() => {
		live.start();
		return () => live.stop();
	});
	const hotspots = createResource((signal) => getHotspots({ signal }), {
		key: () => 'home-hotspots',
	});
	const routes = createResource((signal) => getRoutesIndex({ signal }), {
		key: () => 'home-routes-index',
	});

	const pulse = $derived(selectLivePulse(live.network));
	const worst = $derived(selectWorst(hotspots.data, routes.data?.routes ?? []));
	const presentation = $derived(
		livePresentation({
			familyStates: live.familyStates,
			families: LIVE_FAMILIES,
			locale,
			page: 'network',
			networkFeedAgeAtPublication: live.network?.feed_freshness_s ?? null,
		}),
	);

	const pct = (value: number | null) => fmtPct(value, { locale, suffix: '%' });
	const count = (value: number) => fmtCount(value, { locale }) ?? String(value);
	const rankHref = (rank: PulseRank) =>
		localizeHref(routeFor({ kind: rank.kind, id: rank.id }), locale);
	const tiles = $derived(
		pulse
			? [
					{ key: 'in-service', label: t.inService, value: count(pulse.inService), note: null },
					{ key: 'on-time', label: t.onTime, value: pct(pulse.onTimePct), note: t.onTimeNote },
					{
						key: 'severe-late',
						label: t.severeLate,
						value: pulse.severeLate == null ? null : count(pulse.severeLate),
						note: t.severeLateNote.replace('{n}', count(pulse.withReading)),
					},
					{
						key: 'early',
						label: t.early,
						value: pulse.early == null ? null : count(pulse.early),
						note: t.earlyNote,
					},
					{
						key: 'not-reporting',
						label: t.notReporting,
						value: count(pulse.notReporting),
						note: t.notReportingNote,
					},
				]
			: [],
	);
</script>

<div class="pulse-live" data-slot="home-pulse-live">
	<FreshnessStamp variant="live" presentation={presentation.stamp} {locale} />
	{#if pulse}
		<dl class="pulse-tiles">
			{#each tiles as tile (tile.key)}
				<div class="pulse-tile" data-pulse={tile.key}>
					<dt>{tile.label}</dt>
					<dd>
						<span class="pulse-value" class:pulse-value--absent={tile.value == null}
							>{tile.value ?? t.notMeasured}</span
						>
						{#if tile.note}<span class="pulse-note">{tile.note}</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{:else if live.familyStates.network.health.state === 'failed-no-data'}
		<p class="pulse-absent" role="status">{t.liveUnavailable}</p>
	{:else}
		<div class="pulse-tiles pulse-tiles--loading" aria-hidden="true">
			{#each [0, 1, 2, 3, 4] as i (i)}<div class="pulse-tile"></div>{/each}
		</div>
	{/if}
</div>

<div class="pulse-worst" data-slot="home-pulse-worst">
	{#if worst}
		<p class="pulse-worst-note">
			{t.worstNote.replace('{date}', worst.through ? formatDateKey(worst.through, locale) : '—')}
		</p>
		<div class="pulse-worst-lists">
			{@render rankList(t.worstLines, worst.lines, 'lines')}
			{@render rankList(t.worstStops, worst.stops, 'stops')}
		</div>
		<a class="pulse-more" href={localizeHref('/hotspots', locale)}>{t.allHotspots} →</a>
	{:else if hotspots.settled}
		<p class="pulse-absent" role="status">{t.worstUnavailable}</p>
	{/if}
</div>

{#snippet rankList(title: string, ranks: readonly PulseRank[], key: string)}
	<section class="pulse-rank" aria-labelledby={`pulse-${key}`}>
		<h3 id={`pulse-${key}`}>{title}</h3>
		{#if ranks.length}
			<ol>
				{#each ranks as rank (rank.id)}
					<li>
						<a href={rankHref(rank)}>
							<span class="pulse-rank-name"
								>{#if rank.kind === 'line'}<span class="pulse-route">{rank.label}</span
									>{#if rank.detail}<span class="pulse-rank-detail">{rank.detail}</span
										>{/if}{:else}{rank.label}{/if}</span
							>
							{#if rank.severePct != null}<span class="pulse-rank-rate"
									>{t.severeRate.replace('{pct}', pct(rank.severePct) ?? '')}</span
								>{/if}
						</a>
					</li>
				{/each}
			</ol>
		{:else}
			<p class="pulse-absent">{t.worstUnavailable}</p>
		{/if}
	</section>
{/snippet}

<style>
	.pulse-live,
	.pulse-worst {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.pulse-tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		margin: 0;
		background: var(--border-subtle);
		border: 1px solid var(--border-subtle);
	}
	.pulse-tile {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		min-height: 5.5rem;
		padding: 0.875rem 1rem;
		background: var(--card);
	}
	.pulse-tile:first-child {
		grid-column: 1 / -1;
	}
	.pulse-tile dt {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.pulse-tile dd {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
	}
	.pulse-value {
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.pulse-value--absent {
		font-size: var(--text-body);
		color: var(--muted-foreground);
	}
	.pulse-note,
	.pulse-worst-note {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.pulse-tiles--loading .pulse-tile {
		background: color-mix(in srgb, var(--card) 70%, transparent);
	}
	.pulse-absent {
		margin: 0;
		color: var(--secondary-foreground);
		font-size: var(--text-small);
	}
	.pulse-worst-lists {
		display: grid;
		gap: 1.25rem;
	}
	.pulse-rank h3 {
		margin: 0 0 0.5rem;
		font-family: var(--font-heading);
		font-size: var(--text-body);
		font-weight: 800;
	}
	.pulse-rank ol {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: pulse-rank;
	}
	.pulse-rank li {
		counter-increment: pulse-rank;
	}
	.pulse-rank a {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		min-height: 44px;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--foreground);
		text-decoration: none;
	}
	.pulse-rank a::before {
		content: counter(pulse-rank);
		flex: none;
		width: 1.25rem;
		font-family: var(--font-mono);
		color: var(--muted-foreground);
	}
	.pulse-rank a:hover {
		color: var(--accent-text);
	}
	.pulse-rank a:focus-visible,
	.pulse-more:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
	.pulse-rank-name {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}
	.pulse-route {
		flex: none;
		font-family: var(--font-heading);
		font-weight: 800;
	}
	.pulse-rank-detail {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted-foreground);
		font-size: var(--text-small);
	}
	.pulse-rank-rate {
		flex: none;
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--secondary-foreground);
	}
	.pulse-more {
		align-self: flex-start;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		color: var(--accent-text);
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}
	@media (min-width: 640px) {
		.pulse-worst-lists {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 2rem;
		}
	}
	@media (--desktop-min) {
		.pulse-tiles {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.pulse-tile:first-child {
			grid-column: auto;
		}
	}
</style>
