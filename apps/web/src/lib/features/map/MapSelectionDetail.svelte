<script lang="ts">
	import { tick } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { Chip } from '$lib/filters';
	import type { Alert } from '$lib/v1/schemas';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import { STATUS_GLYPH, occupancyGlyph, occupancyVar, statusVar } from '$lib/components/dataviz';
	import { ROUTE_TYPE_METRO } from '$lib/site/serviceWindow';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from '$lib/v1/enumLabels';
	import type { MapSelection, MapSelectionDetail } from './mapSelection';
	import type { SelectionPresence, SelectionSourceHealth } from './selectionGrace.svelte';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import {
		detailActions,
		detailIdentity,
		directionLabel,
		formatAge,
		timeLabel,
		vehicleFieldAbsence,
	} from './mapSelectionDetail.logic';
	import MapDelayTag from './MapDelayTag.svelte';
	import MapDetailAlerts from './MapDetailAlerts.svelte';
	import DetailAttributeGrid from './detail/DetailAttributeGrid.svelte';
	import DetailBusRow from './detail/DetailBusRow.svelte';
	import DetailInlineAction from './detail/DetailInlineAction.svelte';
	import DetailSection from './detail/DetailSection.svelte';
	import DetailStatPills from './detail/DetailStatPills.svelte';
	import DetailStopRow from './detail/DetailStopRow.svelte';

	interface Props {
		detail: MapSelectionDetail | null;
		locale: Locale;
		onselect?: (selection: MapSelection) => void;
		onpreview?: (selection: MapSelection | null) => void;
		onfilter?: (chip: Chip) => void;
		onalertselect?: (alert: Alert) => void;
		notReporting?: { ageS: number } | null;
		selectionPresence?: SelectionPresence | null;
		selectionSourceHealth?: SelectionSourceHealth | null;
		onrefresh?: () => void;
		presentation?: 'body' | 'identity' | 'action';
	}

	let {
		detail,
		locale,
		onselect,
		onpreview,
		onfilter,
		onalertselect,
		notReporting = null,
		selectionPresence = null,
		selectionSourceHealth = null,
		onrefresh,
		presentation = 'body',
	}: Props = $props();

	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const seqUnknownAria = $derived(locale === 'fr' ? 'Séquence inconnue' : 'Sequence unknown');
	const action = $derived(detail ? detailActions(detail, locale) : null);
	let detailElement = $state<HTMLElement>();

	$effect.pre(() => {
		const nextDetail = detail;
		if (!nextDetail || presentation !== 'body') return;
		const focusKey = document.activeElement?.getAttribute('data-detail-focus-key');
		if (!focusKey) return;
		void tick().then(() => {
			[...(detailElement?.querySelectorAll<HTMLElement>('[data-detail-focus-key]') ?? [])]
				.find((element) => element.dataset.detailFocusKey === focusKey)
				?.focus();
		});
	});

	function selectRoute(route: string | null | undefined): void {
		if (route) onselect?.({ kind: 'route', id: route });
	}
	function selectStop(id: string): void {
		onselect?.({ kind: 'stop', id });
	}
	function selectVehicle(id: string): void {
		onselect?.({ kind: 'vehicle', id });
	}
	function filterTrip(trip: string | null | undefined): void {
		if (trip) onfilter?.({ kind: 'trip', value: trip });
	}
</script>

{#if presentation === 'identity'}
	<span data-slot="detail-identity"
		>{detail ? detailIdentity(detail, locale) : locale === 'fr' ? 'Détails' : 'Details'}</span
	>
{:else if presentation === 'action' && action}
	<DetailInlineAction href={action.href} label={action.label} />
{:else if presentation === 'body' && detail}
	<article
		bind:this={detailElement}
		class="map-selection-detail"
		data-kind={detail.kind}
		data-slot="detail-body"
	>
		<!-- D1: identity is supplied by the desktop/mobile shell through detailIdentity(). -->
		<div class="detail-status-band" data-slot="detail-status-band">
			{#if selectionPresence === 'missing-grace'}
				<p class="detail-source-state" data-source-health={selectionSourceHealth ?? 'stale'}>
					{selectionSourceHealth === 'retrying'
						? t.detailRetrying
						: selectionSourceHealth === 'failed'
							? t.detailFailed
							: t.detailStale}
					{#if selectionSourceHealth === 'retrying' || selectionSourceHealth === 'failed'}
						<button class="detail-retry" type="button" onclick={() => onrefresh?.()}
							>{t.retry}</button
						>
					{/if}
				</p>
			{/if}

			{#if detail.kind === 'vehicle'}
				{@const absence = vehicleFieldAbsence({
					stale: notReporting != null,
					metro: detail.routeType === ROUTE_TYPE_METRO,
				})}
				<DetailAttributeGrid>
					<div>
						<dt>{t.status}</dt>
						<dd>
							<span
								class="detail-state-glyph"
								data-m6d-glyph-kind="status"
								data-m6d-glyph-code={detail.vehicle.status}
								aria-hidden="true"
								style={`--glyph: ${statusVar(detail.vehicle.status)}`}
								>{STATUS_GLYPH[detail.vehicle.status]}</span
							>
							{#if detail.vehicle.delay_min != null || detail.vehicle.status !== 'unknown'}
								{STATUS_LABELS[locale][detail.vehicle.status]}
							{/if}
							{#if detail.vehicle.delay_min !== 0}
								{#if detail.vehicle.delay_min != null || detail.vehicle.status !== 'unknown'}
									<span aria-hidden="true">·</span>
								{/if}
								<MapDelayTag
									delay={detail.vehicle.delay_min}
									{locale}
									{t}
									ctx={{
										stale: notReporting != null,
										metro: detail.routeType === ROUTE_TYPE_METRO,
									}}
								/>
							{/if}
						</dd>
						<button
							type="button"
							class="detail-fact-action"
							aria-label={t.filterStatus(STATUS_LABELS[locale][detail.vehicle.status])}
							onclick={() => onfilter?.({ kind: 'status', value: detail.vehicle.status })}
							>{locale === 'fr' ? 'Filtrer' : 'Filter'}</button
						>
					</div>
					<div>
						<dt>{t.nextStop}</dt>
						<dd>
							<MaybeValue present={detail.nextStop != null} reason={detail.nextStopAbsence} {locale}
								>{detail.nextStop!.name}</MaybeValue
							>
						</dd>
						{#if detail.nextStop}<button
								type="button"
								class="detail-fact-action"
								aria-label={t.selectStop(detail.nextStop.name)}
								onclick={() => selectStop(detail.nextStop!.id)}>{t.stop}</button
							>{/if}
					</div>
					<div>
						<dt>ETA</dt>
						<dd>
							<MaybeValue
								value={detail.nextStops[0]?.etaUtc
									? timeLabel(detail.nextStops[0].etaUtc, locale)
									: null}
								reason="no-prediction"
								{locale}
							/>
						</dd>
					</div>
					<div>
						<dt>{t.trip}</dt>
						<dd>
							{#if detail.vehicle.trip}<button
									type="button"
									class="detail-fact-action"
									aria-label={t.filterTrip(detail.vehicle.trip)}
									onclick={() => filterTrip(detail.vehicle.trip)}>{detail.vehicle.trip}</button
								>{:else}<AbsentValue reason={absence} {locale} />{/if}
						</dd>
					</div>
					<div>
						<dt>{t.crowding}</dt>
						<dd>
							<span
								class="detail-state-glyph"
								data-m6d-glyph-kind="crowding"
								data-m6d-glyph-code={detail.vehicle.occupancy ?? 'nodata'}
								aria-hidden="true"
								style={`--glyph: ${detail.vehicle.occupancy ? occupancyVar(detail.vehicle.occupancy) : 'var(--muted-foreground)'}`}
								>{occupancyGlyph(detail.vehicle.occupancy)}</span
							>
							<MaybeValue present={detail.vehicle.occupancy != null} reason={absence} {locale}
								>{OCCUPANCY_LABELS[locale][detail.vehicle.occupancy!]}</MaybeValue
							>
						</dd>
						{#if detail.vehicle.occupancy != null}<button
								type="button"
								class="detail-fact-action"
								aria-label={t.filterCrowding(OCCUPANCY_LABELS[locale][detail.vehicle.occupancy])}
								onclick={() =>
									detail.kind === 'vehicle' &&
									detail.vehicle.occupancy != null &&
									onfilter?.({ kind: 'occupancy', value: detail.vehicle.occupancy })}
								>{locale === 'fr' ? 'Filtrer' : 'Filter'}</button
							>{/if}
					</div>
				</DetailAttributeGrid>
			{:else if detail.kind === 'stop'}
				<DetailAttributeGrid>
					<div>
						<dt>{t.departures(3)}</dt>
						<dd>
							{detail.departures == null
								? t.departuresUnavailable
								: t.departures(Math.min(3, detail.departures.length))}
						</dd>
					</div>
				</DetailAttributeGrid>
			{:else}
				<DetailAttributeGrid
					><div>
						<dt>{t.liveBuses}</dt>
						<dd>{t.visibleBuses(detail.vehicles.length)}</dd>
					</div></DetailAttributeGrid
				>
			{/if}
		</div>

		<MapDetailAlerts alerts={detail.alerts} {locale} {t} {onalertselect} />
		{#if detail.kind === 'vehicle'}
			<DetailStatPills>
				<span class="detail-pill">{t.bus} {detail.vehicle.id}</span>
				{#if detail.vehicle.route}<button
						type="button"
						class="detail-pill"
						aria-label={t.selectRoute(detail.vehicle.route)}
						onclick={() => selectRoute(detail.vehicle.route)}
						>{t.route} {detail.vehicle.route}</button
					>{/if}
			</DetailStatPills>
			{#if notReporting}<AbsentValue
					reason="last-seen"
					params={{
						age:
							locale === 'fr'
								? `il y a ${formatAge(notReporting.ageS)}`
								: `${formatAge(notReporting.ageS)} ago`,
					}}
					{locale}
					class="map-not-reporting"
				/>{/if}
			{#if detail.nextStops.length > 0}
				<DetailSection title={t.nextStops} slot="detail-next-stops"
					><ol>
						{#each detail.nextStops as stop (stop.id)}<li>
								<DetailStopRow
									{stop}
									{locale}
									{t}
									{seqUnknownAria}
									onselect={selectStop}
									{onpreview}
								/>
							</li>{/each}
					</ol></DetailSection
				>
			{/if}
			{#if detail.pastStops.length > 0}
				<DetailSection title={t.pastStops} slot="detail-past-stops" collapsed
					><ol>
						{#each detail.pastStops as stop (stop.id)}<li>
								<DetailStopRow
									{stop}
									{locale}
									{t}
									{seqUnknownAria}
									onselect={selectStop}
									{onpreview}
								/>
							</li>{/each}
					</ol></DetailSection
				>
			{/if}
		{:else if detail.kind === 'stop'}
			<DetailStatPills
				><span class="detail-pill">{t.stopCode} {detail.stop.code ?? detail.stop.id}</span><span
					class="detail-pill">{t.vehiclesHeading(detail.vehicles.length)}</span
				></DetailStatPills
			>
			{#if detail.departures && detail.departures.length > 0}
				<DetailSection title={t.departures(detail.departures.length)} slot="detail-departures"
					><ol class="map-departures">
						{#each detail.departures.slice(0, 3) as departure (departure.trip ?? `${departure.route}:${departure.eta_utc}`)}
							{@const departureKey = departure.trip ?? `${departure.route}:${departure.eta_utc}`}
							<li data-departure-key={departureKey}>
								{#if departure.route}<button
										type="button"
										data-detail-focus-key={`departure:${departureKey}:route`}
										aria-label={t.selectDepartureRoute(departure.route)}
										onclick={() => selectRoute(departure.route)}>{t.route} {departure.route}</button
									>{/if}{#if departure.trip}<button
										type="button"
										data-detail-focus-key={`departure:${departureKey}:trip`}
										aria-label={t.filterTrip(departure.trip)}
										onclick={() => filterTrip(departure.trip)}>{t.trip} {departure.trip}</button
									>{/if}<time>{timeLabel(departure.eta_utc, locale)}</time><MapDelayTag
									delay={departure.delay_min}
									{locale}
									{t}
								/>
							</li>
						{/each}
					</ol></DetailSection
				>
			{/if}
			{#if detail.routeTimes.length > 0}<DetailSection
					title={t.routes}
					slot="detail-route-times"
					ladderMin={420}
					>{#each detail.routeTimes as route (route.route)}<p>
							{t.route}
							{route.route}{route.headsign ? ` · ${route.headsign}` : ''}
						</p>
						<details data-slot="detail-schedule-tail">
							<summary>{t.nextTimes}</summary>
							<p>{t.pastTimes}: {route.pastTimes.join(', ')}</p>
							<p>{t.nextTimes}: {route.futureTimes.join(', ')}</p>
						</details>{/each}</DetailSection
				>{/if}
			{#if detail.departures && detail.departures.length > 3 && action}<DetailSection
					title={`+${detail.departures.length - 3} ${t.more}`}
					slot="detail-more-departures"
					collapsed
					ladderExpand={560}
					inlineAction={{
						href: action.href,
						label: `+${detail.departures.length - 3} ${t.more}`,
						dataSlot: 'detail-more-departures-action',
					}}
					><ol>
						{#each detail.departures.slice(3) as departure (departure.trip ?? `${departure.route}:${departure.eta_utc}`)}<li
							>
								{departure.route}
								{timeLabel(departure.eta_utc, locale)}
							</li>{/each}
					</ol></DetailSection
				>{/if}
			{#if detail.vehicles.length > 0}<DetailSection title={t.liveBuses} slot="detail-live-buses"
					><ol>
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}<li>
								<DetailBusRow
									{vehicle}
									etaUtc={detail.departures?.find((departure) => departure.trip === vehicle.trip)
										?.eta_utc ?? null}
									{locale}
									{t}
									onselect={selectVehicle}
									{onpreview}
								/>
							</li>{/each}
					</ol></DetailSection
				>{/if}
		{:else}
			<DetailStatPills
				><span class="detail-pill">{detailIdentity(detail, locale)}</span
				>{#if detail.route.long}<span class="detail-pill">{detail.route.long}</span
					>{/if}{#if detail.direction}<span class="detail-pill"
						>{directionLabel(detail, locale)}</span
					>{/if}</DetailStatPills
			>
			{#if detail.vehicles.length > 0}<DetailSection title={t.liveBuses} slot="detail-live-buses"
					><ol>
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}<li>
								<DetailBusRow {vehicle} {locale} {t} onselect={selectVehicle} {onpreview} />
							</li>{/each}
					</ol></DetailSection
				>{/if}
			{#if detail.directions.length > 0}<DetailSection title={t.stops} slot="detail-stops"
					>{#each detail.directions as direction (direction.variantKey)}<div>
							<h4>{direction.label}</h4>
							<ol>
								{#each direction.stops as stop (stop.id)}<li>
										<DetailStopRow
											{stop}
											{locale}
											{t}
											{seqUnknownAria}
											onselect={selectStop}
											{onpreview}
										/>
									</li>{/each}
							</ol>
						</div>{/each}</DetailSection
				>{/if}
		{/if}
	</article>
{/if}

<style>
	.map-selection-detail {
		display: grid;
		gap: 1rem;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--foreground);
	}
	.detail-fact-action {
		display: inline-flex;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		justify-content: flex-start;
		padding-inline: 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		color: var(--primary);
		background: transparent;
	}
	.detail-fact-action:hover {
		background: var(--muted);
	}
	.detail-fact-action:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.detail-state-glyph {
		margin-inline-end: 0.25rem;
		font-family: var(--font-mono);
		font-weight: 800;
		color: var(--glyph);
	}
	.detail-status-band {
		display: grid;
		gap: 0.5rem;
	}
	.detail-source-state {
		margin: 0;
		padding: 0.5rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		color: var(--muted-foreground);
	}
	.detail-source-state[data-source-health] {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 38%, var(--border) 62%);
		background: color-mix(in srgb, var(--dataviz-status-late) 7%, var(--card) 86%);
	}
	.detail-retry {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		margin-left: 0.5rem;
		padding-inline: 0.75rem;
		border-radius: var(--radius-md);
		color: var(--foreground);
	}
	.map-selection-detail ol {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-departures li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		min-width: 0;
	}
	.map-departures button {
		display: inline-flex;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		padding-block: 0.5rem;
		padding-inline: 0.75rem;
	}
	/* List-item display preserved: the ::marker triangle is the affordance. */
	.map-selection-detail :global([data-slot='detail-schedule-tail'] > summary) {
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		padding-block: 0.5rem;
		cursor: pointer;
	}
	@container right-panel (width < 26.25rem) {
		.map-selection-detail :global([data-slot='detail-meta'].detail-stat-pills) {
			display: none;
		}
		.map-selection-detail :global([data-ladder-min='420']) {
			display: none;
		}
	}
	@container right-panel (min-width: 34rem) {
		.map-selection-detail :global([data-ladder-expand='560'] [data-ladder-content]) {
			visibility: visible;
			block-size: auto;
		}
	}
</style>
