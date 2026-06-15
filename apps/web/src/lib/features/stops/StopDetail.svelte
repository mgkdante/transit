<!--
  StopDetail — tabbed detail for one stop (slice-9.3).

  Composes the surface spine's EntityDetail scaffold over four canonical tabs:

    next         LIVE  — the live store's per-stop departures board
                         (live.index.byStopId.get(id)), with a freshness chip.
    schedule    STATIC — the static stop's scheduled[] (route + headsign + times).
    info        STATIC — position, code, accessibility + routes served.
    reliability HISTORIC— per-period OTP/delay (→ ReliabilityPane) + by-route
                         median-delay breakdown.

  Static + historic reads use createResource (browser-side, reactive to `id`);
  the live tier uses createLiveStore (start on mount, stop on destroy). Each pane
  fail-soft via ResourceBoundary / EdgeState — never invent data, never crash.

  Reads locale via getLocale(); copy is co-located in stops.copy.ts. Domain
  vocabulary inside the spine (OTP / delay / LIVE) lives in the primitives.
  Tokens only; --primary interactive-only.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import {
		getStop,
		getStopReliability,
		createLiveStore,
		getV1Context,
		type StopFile,
		type StopReliability,
		type StopDeparture,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		EntityDetail,
		ResourceBoundary,
		ReliabilityPane,
		LiveFreshness,
		type ReliabilityPeriodVM,
	} from '$lib/components/surface';
	import { EdgeState } from '$lib/components/edge';
	import { layout } from '$lib/nav';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { formatUtc } from '$lib/utils/time';
	import { detailCopy } from './stops.copy';

	interface StopDetailProps {
		/** The stop id from the route param. */
		id: string;
	}

	let { id }: StopDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(detailCopy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	type TabKey = 'next' | 'schedule' | 'info' | 'reliability';
	const tabs = $derived([
		{ key: 'next', label: t.tabs.next },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'info', label: t.tabs.info },
		{ key: 'reliability', label: t.tabs.reliability },
	] as const satisfies readonly { key: TabKey; label: string }[]);
	let active = $state<TabKey>('next');

	// --- live tier: per-stop departures board --------------------------------
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});
	// Departures for THIS stop from the authoritative per-stop board. null before
	// the first tick (skeleton); [] is a real "no upcoming departures" verdict.
	const departures = $derived<readonly StopDeparture[] | null>(
		live.departures ? (live.index.byStopId.get(id) ?? []) : null,
	);

	// --- static tier: stop detail (info + schedule) --------------------------
	const stop = createResource(() => getStop(id));

	// --- historic tier: stop reliability -------------------------------------
	const reliability = createResource(() => getStopReliability(id));

	/** Map raw historic periods → the shared ReliabilityPane view-model. */
	function toPeriods(r: StopReliability): ReliabilityPeriodVM[] {
		return (r.periods ?? []).map((p) => ({
			grain: p.grain,
			otpPct: p.otp_pct ?? null,
			delayMin: p.median_delay_min ?? null,
			severePct: p.severe_pct ?? null,
		}));
	}

	/** A departure's delay caption — fail-soft when delay is absent. */
	function delayLabel(delayMin: number | null | undefined): string {
		if (delayMin == null || delayMin === 0) return t.next.onTime;
		return delayMin > 0 ? t.next.late(delayMin) : t.next.early(Math.abs(delayMin));
	}
</script>

<EntityDetail kicker={t.kicker} {tabs} bind:active>
	{#snippet header()}
		<StopLabel stop={id} label={stop.data?.name ?? `#${id}`} />
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'next'}
			<!-- LIVE: per-stop departures board. Skeleton until the first tick. -->
			{#if departures == null}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{:else}
				<div class="stop-next">
					<div class="stop-next-head">
						<SectionLabel text={t.next.heading} variant="station" />
						<LiveFreshness
							generatedUtc={live.generatedUtc}
							ageSeconds={live.ageSeconds}
							isStale={live.isStale}
							{locale}
						/>
					</div>
					{#if departures.length === 0}
						<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
					{:else}
						<ul class="stop-departures">
							{#each departures as d, i (`${d.trip ?? d.route ?? 'dep'}-${d.eta_utc}-${i}`)}
								<li class="stop-departure">
									<span class="stop-departure-route">{d.route ?? t.next.route}</span>
									<span class="stop-departure-eta">{formatUtc(d.eta_utc, locale)}</span>
									<span class="stop-departure-delay">{delayLabel(d.delay_min)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{:else if key === 'schedule'}
			<!-- STATIC: scheduled service grouped by route. -->
			<ResourceBoundary
				resource={stop}
				lang={locale}
				isEmpty={(s: StopFile | null) => (s?.scheduled?.length ?? 0) === 0}
			>
				{#snippet children(s: StopFile | null)}
					<div class="stop-schedule">
						<SectionLabel text={t.schedule.heading} variant="station" />
						{#each s?.scheduled ?? [] as entry, i (`${entry.route}-${entry.headsign ?? i}`)}
							<div class="stop-schedule-route">
								<div class="stop-schedule-route-head">
									<span class="stop-schedule-route-code">{entry.route}</span>
									{#if entry.headsign}
										<span class="stop-schedule-headsign">{entry.headsign}</span>
									{/if}
								</div>
								{#if (entry.times?.length ?? 0) > 0}
									<ul class="stop-schedule-times">
										{#each (entry.times ?? []).slice(0, 24) as time, ti (`${time}-${ti}`)}
											<li class="stop-schedule-time">{time}</li>
										{/each}
										{#if (entry.times?.length ?? 0) > 24}
											<li class="stop-schedule-time-more" aria-hidden="true">
												{t.schedule.moreTimes((entry.times?.length ?? 0) - 24)}
											</li>
										{/if}
									</ul>
								{/if}
							</div>
						{/each}
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'info'}
			<!-- STATIC: position, code, accessibility + routes served. -->
			<ResourceBoundary resource={stop} lang={locale}>
				{#snippet children(s: StopFile | null)}
					{#if s == null}
						<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
					{:else}
						<div class="stop-info">
							<div class="stop-info-metrics">
								<MetricDisplay
									value={`${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}
									label={t.info.position}
									size="sm"
								/>
								{#if s.code}
									<MetricDisplay value={s.code} label={t.info.code} size="sm" />
								{/if}
								{#if s.wheelchair != null}
									<MetricDisplay
										value={s.wheelchair ? t.info.wheelchairYes : t.info.wheelchairNo}
										label={t.info.wheelchair}
										size="sm"
									/>
								{/if}
							</div>
							{#if (s.routes_served?.length ?? 0) > 0}
								<div class="stop-info-routes">
									<SectionLabel text={t.info.routesServed} variant="metric" />
									<ul class="stop-info-route-chips">
										{#each s.routes_served ?? [] as route (route)}
											<li><Badge variant="tag" size="sm">{route}</Badge></li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'reliability'}
			<!-- HISTORIC: per-period OTP/delay + by-route median breakdown. -->
			<ResourceBoundary
				resource={reliability}
				lang={locale}
				isEmpty={(r: StopReliability | null) => r == null || (r.periods?.length ?? 0) === 0}
			>
				{#snippet children(r: StopReliability | null)}
					{#if r != null}
						<div class="stop-reliability">
							<ReliabilityPane periods={toPeriods(r)} {locale} delayLabelKind="median" />
							{#if (r.by_route?.length ?? 0) > 0}
								<div class="stop-reliability-routes">
									<SectionLabel text={t.reliability.byRoute} variant="metric" />
									<ul class="stop-reliability-route-list">
										{#each r.by_route ?? [] as br (br.route)}
											<li class="stop-reliability-route">
												<span class="stop-reliability-route-code">{br.route}</span>
												<span class="stop-reliability-route-delay">
													{br.median_delay_min == null
														? '—'
														: `${br.median_delay_min.toFixed(1)} min`}
												</span>
											</li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.stop-next {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.stop-next-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.stop-departures {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.stop-departure {
		display: flex;
		align-items: baseline;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.stop-departure:last-child {
		border-bottom: none;
	}
	.stop-departure-route {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-body);
		color: var(--accent-text);
		flex-shrink: 0;
		min-width: 3ch;
	}
	.stop-departure-eta {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		flex: 1 1 auto;
	}
	.stop-departure-delay {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		flex-shrink: 0;
	}

	.stop-schedule,
	.stop-info,
	.stop-reliability {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.stop-schedule-route {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-schedule-route-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.stop-schedule-route-code {
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--accent-text);
	}
	.stop-schedule-headsign {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stop-schedule-times {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
	}
	.stop-schedule-time {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.stop-schedule-time-more {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	.stop-info-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.stop-info-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-info-route-chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.stop-reliability-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-route-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.stop-reliability-route {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.875rem;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.stop-reliability-route:last-child {
		border-bottom: none;
	}
	.stop-reliability-route-code {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--foreground);
	}
	.stop-reliability-route-delay {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
