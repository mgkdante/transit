<script lang="ts">
	import { isInService, vehicleServiceCopy } from '#lib/v1/live/vehicleService.ts';
	import { stopDisplayName } from '#lib/site/transitDisplay.ts';
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	const { line } = transitDisplay();
	import { liveAbsenceReason, readLiveAbsenceContext } from '#lib/site/absence.ts';
	const absenceContext = readLiveAbsenceContext();
	import { tick } from 'svelte';
	import { Button } from '@yesid/ui/button';
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import type { Chip } from '#lib/filters/index.ts';
	import type { Alert } from '#lib/v1/schemas/index.ts';
	import { AbsentValue, MaybeValue } from '#lib/components/edge/index.ts';
	import {
		STATUS_GLYPH,
		occupancyGlyph,
		occupancyVar,
		statusVar,
	} from '#lib/components/dataviz/tokens.ts';
	import { delayMeasurement } from '#lib/site/delayPresentation.ts';
	import { routeHasNoLiveData } from '#lib/v1/providers.ts';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from '#lib/v1/enumLabels.ts';
	import type { MapSelection, MapSelectionDetail } from './mapSelectionSession.svelte';
	import type { SelectionPresence, SelectionSourceHealth } from './mapSelectionSession.svelte';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import {
		detailActions,
		detailIdentity,
		directionLabel,
		formatAge,
		timeLabel,
	} from './mapSelectionDetail.logic';
	import MapDelayTag from './MapDelayTag.svelte';
	import MapDetailAlerts from './MapDetailAlerts.svelte';
	import DetailAttributeGrid from './detail/DetailAttributeGrid.svelte';
	import DetailBusRow from './detail/DetailBusRow.svelte';
	import DetailFactAction from './detail/DetailFactAction.svelte';
	import DetailInlineAction from './detail/DetailInlineAction.svelte';
	import DetailLede from './detail/DetailLede.svelte';
	import DetailRouteButton from './detail/DetailRouteButton.svelte';
	import DetailSection from './detail/DetailSection.svelte';
	import DetailStopRow from './detail/DetailStopRow.svelte';

	const localizeHref = getLocalizeHref();

	interface Props {
		detail: MapSelectionDetail | null;
		occupancyAvailable?: boolean;
		locale: Locale;
		timeZone?: string;
		onselect?: (selection: MapSelection) => void;
		onpreview?: (selection: MapSelection | null) => void;
		onfilter?: (chip: Chip) => void;
		onalertselect?: (alert: Alert) => void;
		alertsStale?: boolean;
		alertsAgeSeconds?: number | null;
		notReporting?: { ageS: number } | null;
		selectionPresence?: SelectionPresence | null;
		selectionSourceHealth?: SelectionSourceHealth | null;
		onrefresh?: () => void;
		presentation?: 'body' | 'identity' | 'action';
	}

	let {
		occupancyAvailable = true,
		detail,
		locale,
		timeZone,
		onselect,
		onpreview,
		onfilter,
		onalertselect,
		alertsStale = false,
		alertsAgeSeconds = null,
		notReporting = null,
		selectionPresence = null,
		selectionSourceHealth = null,
		onrefresh,
		presentation = 'body',
	}: Props = $props();

	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const seqUnknownAria = $derived(t.sequenceUnknown);
	const action = $derived(detail ? detailActions(detail, locale, line) : null);
	const identityKind = $derived(
		detail?.kind === 'vehicle' ? t.bus : detail?.kind === 'route' ? t.route : t.stop,
	);
	const identityTitle = $derived.by(() => {
		if (!detail) return '';
		if (detail.kind === 'vehicle') return detail.vehicle.id;
		if (detail.kind === 'route') return line(detail.id);
		return detailIdentity(detail, locale, line);
	});
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
	<span class="detail-identity" data-slot="detail-identity" data-kind={detail?.kind}
		>{#if detail}<span class="detail-identity-kind">{identityKind}</span>
			<span class="detail-identity-title">{identityTitle}</span>{:else}<span
				class="detail-identity-title">{t.alertLink}</span
			>{/if}</span
	>
{:else if presentation === 'action' && action}
	<DetailInlineAction href={localizeHref(action.href, locale)} label={action.label} />
{:else if presentation === 'body' && detail}
	<article
		bind:this={detailElement}
		class="map-selection-detail"
		data-kind={detail.kind}
		data-slot="detail-body"
	>
		{#if detail.kind === 'vehicle'}
			{#if detail.vehicle.route}<DetailLede
					><DetailRouteButton
						label={`${t.route} ${line(detail.vehicle.route)}`}
						ariaLabel={t.selectRoute(line(detail.vehicle.route))}
						onclick={() => selectRoute(detail.vehicle.route)}
					/>{#if detail.route?.long}<span class="detail-lede-item">{detail.route.long}</span
						>{/if}</DetailLede
				>{/if}
		{:else if detail.kind === 'stop'}
			<DetailLede
				><span class="detail-lede-item detail-lede-data"
					>{t.stopCode} {detail.stop.code ?? detail.stop.id}</span
				><span class="detail-lede-item">{t.vehiclesHeading(detail.vehicles.length)}</span
				></DetailLede
			>
		{:else if detail.route.long || detail.direction}
			<DetailLede
				>{#if detail.route.long}<span class="detail-lede-item">{detail.route.long}</span
					>{/if}{#if detail.direction}<span class="detail-lede-item"
						>{directionLabel(detail, locale)}</span
					>{/if}</DetailLede
			>
		{/if}

		<div class="detail-status-band" data-slot="detail-status-band">
			{#if selectionPresence === 'missing-grace'}
				<p class="detail-source-state" data-source-health={selectionSourceHealth ?? 'stale'}>
					<span
						>{selectionSourceHealth === 'retrying'
							? t.detailRetrying
							: selectionSourceHealth === 'failed'
								? t.detailFailed
								: t.detailStale}</span
					>
					{#if selectionSourceHealth === 'retrying' || selectionSourceHealth === 'failed'}
						<Button
							variant="ghost"
							size="sm"
							class="detail-source-retry min-h-11"
							type="button"
							onclick={() => onrefresh?.()}>{t.retry}</Button
						>
					{/if}
				</p>
			{/if}

			{#if detail.kind === 'vehicle'}
				{@const absence = liveAbsenceReason('vehicle-delay', {
					...absenceContext(),
					notReporting: notReporting != null,
					unsupported: routeHasNoLiveData(absenceContext().providerId, detail.routeType),
				})}
				<DetailAttributeGrid>
					<div>
						<dt>{t.status}</dt>
						{#if !isInService(detail.vehicle)}<dd>{vehicleServiceCopy[locale].status}</dd>{:else}
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
								{#if detail.vehicle.delay_min != null || detail.vehicle.status !== 'unknown'}
									<span aria-hidden="true">·</span>
								{/if}
								<span class="detail-delay-measurement">
									<MaybeValue
										value={delayMeasurement(detail.vehicle.delay_min)}
										reason={absence}
										{locale}
									/>
								</span>
							</dd>
							<DetailFactAction
								kind="filter"
								label={t.filterStatus(STATUS_LABELS[locale][detail.vehicle.status])}
								onclick={() => onfilter?.({ kind: 'status', value: detail.vehicle.status })}
							/>
						{/if}
					</div>
					<div>
						<dt>{t.nextStop}</dt>
						<dd>
							<MaybeValue
								present={detail.nextStop != null}
								reason={liveAbsenceReason('next-stop', {
									...absenceContext(),
									notReporting: notReporting != null,
									unsupported: routeHasNoLiveData(absenceContext().providerId, detail.routeType),
									scheduleMissing: detail.nextStopAbsence === 'not-in-schedule',
								})}
								{locale}>{stopDisplayName(detail.nextStop!.name)}</MaybeValue
							>
						</dd>
						{#if detail.nextStop}<DetailFactAction
								kind="open"
								label={t.selectStop(stopDisplayName(detail.nextStop.name))}
								onclick={() => selectStop(detail.nextStop!.id)}
							/>{/if}
					</div>
					<div>
						<dt>ETA</dt>
						<dd class="detail-data-value">
							<MaybeValue
								value={detail.nextStops[0]?.etaUtc
									? timeLabel(detail.nextStops[0].etaUtc, locale, timeZone)
									: null}
								variant="compact"
								reason={liveAbsenceReason('trip-prediction', {
									...absenceContext(),
									notReporting: notReporting != null,
								})}
								{locale}
							/>
						</dd>
					</div>
					<div>
						<dt>{t.trip}</dt>
						<dd class="detail-data-value">
							{#if detail.vehicle.trip}{detail.vehicle.trip}{:else}<AbsentValue
									reason={absence}
									{locale}
								/>{/if}
						</dd>
						{#if detail.vehicle.trip}<DetailFactAction
								kind="filter"
								label={t.filterTrip(detail.vehicle.trip)}
								onclick={() => filterTrip(detail.vehicle.trip)}
							/>{/if}
					</div>
					{#if occupancyAvailable}<div>
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
								<MaybeValue
									present={detail.vehicle.occupancy != null}
									reason={liveAbsenceReason('occupancy', {
										...absenceContext(),
										notReporting: notReporting != null,
										unsupported: routeHasNoLiveData(absenceContext().providerId, detail.routeType),
									})}
									{locale}>{OCCUPANCY_LABELS[locale][detail.vehicle.occupancy!]}</MaybeValue
								>
							</dd>
							{#if detail.vehicle.occupancy != null}<DetailFactAction
									kind="filter"
									label={t.filterCrowding(OCCUPANCY_LABELS[locale][detail.vehicle.occupancy])}
									onclick={() =>
										detail.kind === 'vehicle' &&
										detail.vehicle.occupancy != null &&
										onfilter?.({ kind: 'occupancy', value: detail.vehicle.occupancy })}
								/>{/if}
						</div>{/if}
				</DetailAttributeGrid>
				{#if notReporting}<AbsentValue
						reason="last-seen"
						params={{
							age: t.ago(formatAge(notReporting.ageS)),
						}}
						{locale}
						class="map-not-reporting"
					/>{/if}
			{:else if detail.kind === 'stop'}
				<DetailAttributeGrid>
					<div>
						<dt>{t.departuresLabel}</dt>
						<dd>
							{detail.departures == null
								? t.departuresUnavailable
								: t.departures(detail.departures.length)}
						</dd>
					</div>
				</DetailAttributeGrid>
			{:else}
				<DetailAttributeGrid
					><div>
						<dt>{t.liveBuses}</dt>
						<dd>
							{#if detail.vehicles.length === 0 && routeHasNoLiveData(absenceContext().providerId, detail.route.type)}
								<AbsentValue reason="metro-no-realtime" {locale} />
							{:else}{t.visibleBuses(detail.vehicles.length)}{/if}
						</dd>
					</div></DetailAttributeGrid
				>
			{/if}
		</div>

		<MapDetailAlerts
			alerts={detail.alerts}
			{alertsStale}
			{alertsAgeSeconds}
			{locale}
			{t}
			{onalertselect}
		/>
		{#if detail.kind === 'vehicle'}
			{#if detail.nextStops.length > 0}
				<DetailSection title={t.nextStops} count={detail.nextStops.length} slot="detail-next-stops"
					><ol class="detail-row-list">
						{#each detail.nextStops as stop (stop.id)}<li>
								<DetailStopRow
									{stop}
									{timeZone}
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
				<DetailSection
					title={t.pastStops}
					count={detail.pastStops.length}
					slot="detail-past-stops"
					collapsed
					><ol class="detail-row-list">
						{#each detail.pastStops as stop (stop.id)}<li>
								<DetailStopRow
									{stop}
									{timeZone}
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
			{#if detail.departures && detail.departures.length > 0}
				<DetailSection title={t.departures(detail.departures.length)} slot="detail-departures"
					><ol class="map-departures">
						{#each detail.departures.slice(0, 3) as departure (departure.trip ?? `${departure.route}:${departure.eta_utc}`)}
							{@const departureKey = departure.trip ?? `${departure.route}:${departure.eta_utc}`}
							<li data-departure-key={departureKey}>
								<span class="map-departure-what"
									>{#if departure.route}<DetailRouteButton
											label={`${t.route} ${line(departure.route)}`}
											ariaLabel={t.selectDepartureRoute(line(departure.route))}
											focusKey={`departure:${departureKey}:route`}
											onclick={() => selectRoute(departure.route)}
										/>{/if}{#if departure.trip}<Button
											variant="ghost"
											size="sm"
											type="button"
											class="map-departure-trip"
											data-detail-focus-key={`departure:${departureKey}:trip`}
											aria-label={t.filterTrip(departure.trip)}
											onclick={() => filterTrip(departure.trip)}>{t.trip} {departure.trip}</Button
										>{/if}</span
								><span class="map-departure-when"
									><time>{timeLabel(departure.eta_utc, locale, timeZone)}</time><MapDelayTag
										delay={departure.delay_min}
										{locale}
										{t}
									/></span
								>
							</li>
						{/each}
					</ol></DetailSection
				>
			{/if}
			{#if detail.routeTimes.length > 0}<DetailSection
					title={t.routes}
					count={detail.routeTimes.length}
					slot="detail-route-times"
					>{#each detail.routeTimes as route (route.route)}<div class="map-route-times">
							<p class="map-route-times-head">
								<DetailRouteButton
									label={`${t.route} ${line(route.route)}`}
									ariaLabel={t.selectRoute(line(route.route))}
									onclick={() => selectRoute(route.route)}
								/>{#if route.headsign}<span class="map-route-times-headsign">{route.headsign}</span
									>{/if}
							</p>
							<details data-slot="detail-schedule-tail">
								<summary>{t.nextTimes}</summary>
								<p>{t.pastTimes}: {route.pastTimes.join(', ')}</p>
								<p>{t.nextTimes}: {route.futureTimes.join(', ')}</p>
							</details>
						</div>{/each}</DetailSection
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
								{departure.route ? line(departure.route) : departure.route}
								{timeLabel(departure.eta_utc, locale, timeZone)}
							</li>{/each}
					</ol></DetailSection
				>{/if}
			{#if detail.vehicles.length > 0}<DetailSection
					title={t.liveBuses}
					count={detail.vehicles.length}
					slot="detail-live-buses"
					><ol class="detail-row-list">
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}<li>
								<DetailBusRow
									{vehicle}
									{timeZone}
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
			{#if detail.vehicles.length > 0}<DetailSection
					title={t.liveBuses}
					count={detail.vehicles.length}
					slot="detail-live-buses"
					><ol class="detail-row-list">
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}<li>
								<DetailBusRow
									{vehicle}
									{locale}
									{timeZone}
									{t}
									onselect={selectVehicle}
									{onpreview}
								/>
							</li>{/each}
					</ol></DetailSection
				>{/if}
			{#if detail.directions.length > 0}<DetailSection title={t.stops} slot="detail-stops"
					>{#each detail.directions as direction (direction.variantKey)}<div class="map-direction">
							<h4>{direction.label}</h4>
							<ol class="detail-row-list">
								{#each direction.stops as stop (stop.id)}<li>
										<DetailStopRow
											{stop}
											{timeZone}
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
	/* One column that never outgrows the panel: every child shrinks to it. */
	:global(.map-selection-detail) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--foreground);
	}
	.detail-identity {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}
	.detail-identity-kind {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.detail-identity-title {
		min-width: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-heading);
		font-size: var(--text-card-title);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.01em;
		color: var(--foreground);
	}
	.detail-identity[data-kind='vehicle'] .detail-identity-title,
	.detail-identity[data-kind='route'] .detail-identity-title {
		font-variant-numeric: tabular-nums;
	}
	:global(.map-selection-detail > [data-slot='detail-meta']) {
		margin-block-end: -0.75rem;
	}
	:global(.detail-state-glyph) {
		margin-inline-end: 0.25rem;
		font-family: var(--font-mono);
		font-weight: 800;
		color: var(--glyph);
	}
	:global(.detail-delay-measurement),
	:global(.map-selection-detail .detail-data-value) {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	:global(.detail-delay-measurement) {
		color: var(--muted-foreground);
	}
	:global(.detail-status-band) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
	}
	:global(.detail-source-state) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
		margin: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	:global(.detail-source-state[data-source-health]) {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 38%, var(--border) 62%);
		background: color-mix(in srgb, var(--dataviz-status-late) 7%, var(--card) 86%);
	}
	:global(.detail-source-retry) {
		min-block-size: var(--size-tap-min);
	}
	:global(.map-selection-detail ol) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	:global(.map-departures li) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0 0.75rem;
		min-width: 0;
		border-bottom: 1px solid var(--border-subtle);
	}
	:global(.map-departures li:last-child) {
		border-bottom: 0;
	}
	:global(.map-departure-what),
	:global(.map-departure-when) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.625rem;
		min-width: 0;
	}
	:global(.map-departure-when) {
		margin-inline-start: auto;
		font-size: var(--text-caption);
	}
	:global(.map-departure-when time) {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
	}
	:global(.map-departure-trip) {
		min-block-size: var(--size-tap-min);
		height: auto;
		padding-inline: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		white-space: normal;
	}
	:global(.map-departure-trip:hover) {
		color: var(--primary);
	}
	:global(.map-route-times) {
		display: grid;
		border-bottom: 1px solid var(--border-subtle);
	}
	:global(.map-route-times:last-child) {
		border-bottom: 0;
	}
	:global(.map-route-times-head) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.75rem;
		margin: 0;
	}
	:global(.map-route-times-headsign) {
		min-width: 0;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	:global(.map-selection-detail [data-slot='detail-schedule-tail']) {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	:global(.map-selection-detail [data-slot='detail-schedule-tail'] > summary) {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		cursor: pointer;
		list-style: none;
	}
	:global(
		.map-selection-detail [data-slot='detail-schedule-tail'] > summary::-webkit-details-marker
	) {
		display: none;
	}
	/* The same disclosure chevron as collapsed detail sections. */
	:global(.map-selection-detail [data-slot='detail-schedule-tail'] > summary::after) {
		width: 0.375rem;
		height: 0.375rem;
		border-right: 1.5px solid currentcolor;
		border-bottom: 1.5px solid currentcolor;
		transform: translateY(-0.125rem) rotate(45deg);
		content: '';
	}
	:global(.map-selection-detail [data-slot='detail-schedule-tail'][open] > summary::after) {
		transform: translateY(0.125rem) rotate(225deg);
	}
	:global(.map-selection-detail [data-slot='detail-schedule-tail'] > summary:hover) {
		color: var(--foreground);
	}
	:global(.map-selection-detail [data-slot='detail-schedule-tail'] > p) {
		margin: 0 0 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
	:global(.map-direction) {
		display: grid;
		gap: 0.25rem;
	}
	:global(.map-direction + .map-direction) {
		margin-top: 1rem;
	}
	:global(.map-direction h4) {
		margin: 0;
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--muted-foreground);
	}
	@container right-panel (min-width: 34rem) {
		:global(.map-selection-detail [data-ladder-expand='560'] [data-ladder-content]) {
			visibility: visible;
			block-size: auto;
		}
	}
	:global(.map-selection-detail button) {
		text-align: left;
	}
	:global(.map-selection-detail button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
