<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { AbsentValue } from '$lib/components/edge';
	import { routeModeHint } from '$lib/search/stopMode';
	import { stopNameFallback } from '$lib/site/absence';
	import { ROUTE_TYPE_METRO } from '$lib/site/serviceWindow';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from '$lib/v1/enumLabels';
	import type { MapHoverPeek } from './mapHoverPeek';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import { delayKnownLabel, formatAge, vehicleFieldAbsence } from './mapSelectionDetail.logic';

	interface Props {
		peek: MapHoverPeek;
		locale: Locale;
	}

	let { peek, locale }: Props = $props();
	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);
	const vehicleAbsence = $derived(
		vehicleFieldAbsence({
			stale: peek.kind === 'vehicle' && peek.notReportingAgeS != null,
			metro: peek.kind === 'vehicle' && peek.route?.type === ROUTE_TYPE_METRO,
		}),
	);
</script>

<article class="map-hover-peek" data-kind={peek.kind}>
	<header>
		<p>{peek.kind === 'vehicle' ? t.bus : peek.kind === 'route' ? t.route : t.stop}</p>
		<h2>
			{peek.kind === 'stop' && peek.nameAbsent ? stopNameFallback(peek.id, locale) : peek.title}
		</h2>
	</header>

	{#if peek.kind === 'vehicle'}
		<div class="map-peek-id">
			<span>{t.bus}</span>
			<strong>{peek.id}</strong>
		</div>
		{#if peek.notReportingAgeS != null}
			<p class="map-peek-stale">
				{t.notReporting} · {t.lastPosition(formatAge(peek.notReportingAgeS))}
			</p>
		{/if}
		<dl>
			<div>
				<dt>{t.route}</dt>
				<dd>
					{#if peek.route}
						<span>{peek.route.id}</span>
						<span>{peek.route.longName}</span>
						{#if peek.route.labelInferred}<AbsentValue reason="inferred" {locale} />{/if}
						{#if peek.route.type != null}
							<span>{routeModeHint(peek.route.type).tag ?? peek.route.type}</span>
						{/if}
					{:else}
						<AbsentValue reason={vehicleAbsence} {locale} />
					{/if}
				</dd>
			</div>
			<div>
				<dt>{t.status}</dt>
				<dd>{STATUS_LABELS[locale][peek.status]}</dd>
			</div>
			<div>
				<dt>{t.crowding}</dt>
				<dd>
					{#if peek.occupancy != null}
						{OCCUPANCY_LABELS[locale][peek.occupancy]}
					{:else}
						<AbsentValue reason={vehicleAbsence} {locale} />
					{/if}
				</dd>
			</div>
			<div>
				<dt>{t.delay}</dt>
				<dd>
					{#if peek.delayMin != null}
						{delayKnownLabel(peek.delayMin, t)}
					{:else}
						<AbsentValue reason={vehicleAbsence} {locale} />
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
						<AbsentValue reason={peek.nextStopAbsence} {locale} />
					{/if}
				</dd>
			</div>
		</dl>
	{:else if peek.kind === 'route'}
		<div class="map-peek-id">
			<span>{t.route}</span>
			<strong>{peek.id}</strong>
		</div>
		<dl>
			<div>
				<dt>{t.route}</dt>
				<dd>
					{peek.longName}
					{#if peek.labelInferred}<AbsentValue reason="inferred" {locale} />{/if}
				</dd>
			</div>
			<div>
				<dt>Type</dt>
				<dd>{routeModeHint(peek.type).tag ?? peek.type}</dd>
			</div>
		</dl>
		<p class="map-peek-count">{t.visibleBuses(peek.visibleVehicleCount)}</p>
	{:else}
		<div class="map-peek-id">
			<span>{t.stopCode}</span>
			<strong>{peek.code ?? peek.id}</strong>
		</div>
		<p class="map-peek-count">{t.vehiclesHeading(peek.vehicleCount)}</p>
	{/if}
</article>

<style>
	.map-hover-peek {
		display: flex;
		min-width: 14rem;
		flex-direction: column;
		gap: 0.75rem;
		font-family: var(--font-body);
		color: var(--foreground);
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	header p,
	.map-peek-id span,
	dt {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	h2 {
		margin: 0;
		font-size: var(--text-h4);
		line-height: 1.15;
	}
	.map-peek-id {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.map-peek-id strong {
		font-family: var(--font-mono);
		color: var(--accent-text);
	}
	.map-peek-stale {
		margin: 0;
		padding: 0.5rem 0.625rem;
		border: 1px solid color-mix(in srgb, var(--dataviz-severity-watch) 35%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--dataviz-severity-watch) 8%, var(--card));
		font-size: var(--text-caption);
	}
	dl {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.625rem 0.875rem;
		margin: 0;
	}
	dl > div {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
	}
	dd {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.1rem;
		margin: 0;
		font-size: var(--text-small);
		overflow-wrap: anywhere;
	}
	.map-peek-count {
		margin: 0;
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
