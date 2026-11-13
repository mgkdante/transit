<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
	import { isInService, vehicleServiceCopy } from '#lib/v1/live/vehicleService.ts';
	import { transitDisplay } from '#lib/site/transitDisplayContext.ts';
	const { line } = transitDisplay();
	import type { Locale } from '#lib/i18n/index.ts';
	import { AbsentValue, MaybeValue } from '#lib/components/edge/index.ts';
	import {
		stopNameFallback,
		liveAbsenceReason,
		readLiveAbsenceContext,
	} from '#lib/site/absence.ts';
	import { routeHasNoLiveData } from '#lib/v1/providers.ts';
	import { STATUS_LABELS } from '#lib/v1/enumLabels.ts';
	import type { MapHoverPeek } from './mapHoverPeek';
	import { STATUS_GLYPH, statusVar } from '#lib/components/dataviz/tokens.ts';
	import { delayMeasurement } from '#lib/site/delayPresentation.ts';
	import MapDetailAlerts from './MapDetailAlerts.svelte';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import { formatAge } from './mapSelectionDetail.logic';

	interface Props {
		peek: MapHoverPeek;
		locale: Locale;
	}

	let { peek, locale }: Props = $props();
	const absenceContext = readLiveAbsenceContext();
	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const kindLabel = $derived(
		peek.kind === 'vehicle' ? t.bus : peek.kind === 'route' ? t.route : t.stop,
	);
	const title = $derived(
		peek.kind === 'stop' && peek.nameAbsent ? stopNameFallback(peek.id, locale) : peek.title,
	);
	const vehicleAbsence = $derived(
		liveAbsenceReason('vehicle-delay', {
			...absenceContext(),
			notReporting: peek.kind === 'vehicle' && peek.notReportingAgeS != null,
			unsupported:
				peek.kind === 'vehicle' &&
				routeHasNoLiveData(absenceContext().providerId, peek.route?.type),
		}),
	);
</script>

<!-- A glance at what the pointer is on: the same header and fact rows as the
     detail panel, cut to what helps decide whether to open it. Passive: no
     controls, no live region. -->
<article class="map-hover-peek" data-kind={peek.kind}>
	<header class="peek-header">
		<p class="peek-kind">{kindLabel}</p>
		<h2 class="peek-title">{title}</h2>
	</header>

	{#if peek.kind === 'vehicle'}
		<p class="peek-lede" data-slot="peek-lede">
			{#if peek.route}
				<Badge variant="tag" size="xs" class="peek-route-tag">{t.route} {line(peek.route.id)}</Badge
				>
				<span class="peek-lede-item"
					>{peek.route.longName ?? `${t.route} ${line(peek.route.id)}`}</span
				>
				{#if peek.route.labelInferred}<AbsentValue reason="inferred" {locale} />{/if}
			{:else}
				<AbsentValue reason={vehicleAbsence} {locale} />
			{/if}
		</p>
		{#if peek.notReportingAgeS != null}
			<AbsentValue
				reason="last-seen"
				params={{
					age: t.ago(formatAge(peek.notReportingAgeS)),
				}}
				{locale}
				class="map-peek-stale"
			/>
		{/if}
		<dl class="peek-facts">
			<div>
				<dt>{t.status}</dt>
				<dd class="map-peek-status">
					{#if !isInService({ trip: peek.tripId })}{vehicleServiceCopy[locale].status}{:else}
						{#if peek.delayMin != null || peek.status !== 'unknown'}
							<!-- The panel's status mark: a coloured glyph before the plain label. -->
							<span class="peek-status" data-status={peek.status}
								><span
									class="peek-status-glyph"
									aria-hidden="true"
									style={`--glyph: ${statusVar(peek.status)}`}>{STATUS_GLYPH[peek.status]}</span
								>
								{STATUS_LABELS[locale][peek.status]}</span
							>
							<span aria-hidden="true">·</span>
						{/if}
						<span class="map-peek-delay">
							<MaybeValue
								value={delayMeasurement(peek.delayMin)}
								reason={vehicleAbsence}
								{locale}
							/>
						</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt>{t.nextStop}</dt>
				<dd>
					{#if peek.nextStop}
						{#if peek.nextStop.nameAbsent}
							{stopNameFallback(peek.nextStop.id, locale)}
						{:else}
							{peek.nextStop.name}
						{/if}
					{:else}
						<AbsentValue
							reason={liveAbsenceReason('next-stop', {
								...absenceContext(),
								notReporting: peek.notReportingAgeS != null,
								scheduleMissing: peek.nextStopAbsence === 'not-in-schedule',
								unsupported: routeHasNoLiveData(absenceContext().providerId, peek.route?.type),
							})}
							{locale}
						/>
					{/if}
				</dd>
			</div>
		</dl>
	{:else if peek.kind === 'route'}
		<p class="peek-lede" data-slot="peek-lede">
			<span class="peek-lede-item">{peek.longName ?? `${t.route} ${peek.title}`}</span>
			{#if peek.labelInferred}<AbsentValue reason="inferred" {locale} />{/if}
		</p>
		<dl class="peek-facts">
			<div>
				<dt>{t.direction}</dt>
				<dd>
					{#if peek.directionLabel}{peek.directionLabel}{:else}<AbsentValue
							reason="not-in-schedule"
							{locale}
						/>{/if}
				</dd>
			</div>
			<div>
				<dt>{t.liveBuses}</dt>
				<dd>
					{#if peek.visibleVehicleCount === 0 && routeHasNoLiveData(absenceContext().providerId, peek.type)}
						<AbsentValue reason="metro-no-realtime" {locale} />
					{:else}{t.visibleBuses(peek.visibleVehicleCount)}{/if}
				</dd>
			</div>
		</dl>
	{:else}
		<dl class="peek-facts">
			<div>
				<dt>{t.stopCode}</dt>
				<dd class="peek-data">{peek.code ?? peek.id}</dd>
			</div>
			<div>
				<dt>{t.approaching}</dt>
				<dd>{t.vehicleCount(peek.vehicleCount)}</dd>
			</div>
			<div>
				<dt>{t.departuresLabel}</dt>
				<dd>
					{peek.departureCount == null
						? t.departuresUnavailable
						: t.departures(peek.departureCount)}
				</dd>
			</div>
		</dl>
	{/if}

	{#if peek.alerts && peek.alerts.length > 0}<MapDetailAlerts
			alerts={peek.alerts}
			{locale}
			{t}
			presentation="peek-passive"
		/>{/if}
</article>

<style>
	.map-hover-peek {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		min-width: 14rem;
		font-family: var(--font-body);
		color: var(--foreground);
	}
	/* The detail panel's header: kind label over the name in the heading face. */
	.peek-header {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}
	.peek-kind {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.peek-title {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-heading);
		font-size: var(--text-card-title);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.01em;
		font-variant-numeric: tabular-nums;
	}
	.peek-lede {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		min-width: 0;
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.peek-lede :global(.peek-route-tag) {
		font-family: var(--font-mono);
		white-space: nowrap;
	}
	.peek-lede-item {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	/* Label | value rows, the panel's fact grid at glance density. */
	.peek-facts {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0;
		border-top: 1px solid var(--border-subtle);
	}
	.peek-facts > div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		column-gap: 0.75rem;
		align-items: baseline;
		padding-block: 0.375rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.peek-facts > div:last-child {
		border-bottom: 0;
	}
	dt {
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	dd {
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--text-small);
		line-height: 1.4;
	}
	.map-peek-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}
	.peek-status-glyph {
		margin-inline-end: 0.25rem;
		font-family: var(--font-mono);
		font-weight: 800;
		color: var(--glyph);
	}
	.map-peek-delay,
	.peek-data {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.map-peek-delay {
		color: var(--muted-foreground);
	}
</style>
