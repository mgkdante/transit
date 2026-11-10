<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import { formatRelativeSeconds } from '#lib/utils/time.ts';
	import { copy as MAP_COPY } from './map.copy';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { Alert } from '#lib/v1/schemas/index.ts';
	import { alertDisplayText, alertDisplayUrl, alertLanguageNotice } from '#lib/v1/alertDisplay.ts';
	import { causeLabel, effectLabel } from '#lib/v1/gtfsAlertLabels.ts';
	import { StateNotice } from '@yesid/ui/feedback';
	import type { MapSelectionDetailCopy } from './mapSelectionDetail.copy';
	import '#lib/components/surface/alert-item.css';

	interface Props {
		alerts: readonly Alert[] | null;
		alertsStale?: boolean;
		alertsAgeSeconds?: number | null;
		locale: Locale;
		t: MapSelectionDetailCopy;
		onalertselect?: (alert: Alert) => void;
		presentation?: 'detail' | 'peek-passive';
	}

	let {
		alerts,
		alertsStale = false,
		alertsAgeSeconds = null,
		locale,
		t,
		onalertselect,
		presentation = 'detail',
	}: Props = $props();
	const uid = $props.id();
	const PEEK_ALERT_CAP = 1;

	function displayAlert(alert: Alert) {
		return alertDisplayText(alert, locale);
	}
	// The same severity marks as the alert items on line and stop pages.
	function severityGlyph(severity: Alert['severity']): string {
		return severity === 'critical' ? '◆' : severity === 'high' ? '▲' : '●';
	}
</script>

{#if presentation === 'peek-passive'}
	<!-- One passive line for the hover card: the first alert, clamped, plus a count. -->
	{#if alerts && alerts.length > 0}
		{@const alert = alerts[0]}
		{@const display = displayAlert(alert)}
		{@const marker = alertLanguageNotice(display, locale)}
		<section class="map-alerts map-alerts-peek" aria-label={t.alerts}>
			<p class="map-alert map-peek-alert" data-severity={alert.severity}>
				<span class="map-alert-severity" aria-hidden="true">{severityGlyph(alert.severity)}</span
				><span class="map-peek-alert-text"
					><span lang={display.lang ?? ''}>{display.text}</span>{#if marker}<span
							class="alert-language-marker">{marker}</span
						>{/if}</span
				>{#if alerts.length > PEEK_ALERT_CAP}<span class="map-peek-alerts-more"
						>+{alerts.length - PEEK_ALERT_CAP} {t.more}</span
					>{/if}
			</p>
		</section>
	{/if}
{:else}
	<section class="map-alerts" aria-label={t.alerts}>
		<h3>
			{t.alerts}{#if alerts && alerts.length > 0}<span class="map-alerts-count"
					>{alerts.length}</span
				>{/if}
		</h3>
		{#if alertsAgeSeconds != null}
			<p class="map-alerts-age">
				{MAP_COPY[locale].alertsChecked(formatRelativeSeconds(alertsAgeSeconds, locale))}
			</p>
		{/if}
		{#if alerts == null}
			<StateNotice title={t.alertsUnavailable} glyph="○" tone="neutral" presentation="silo" />
		{:else if alerts.length > 0}
			<ul>
				{#each alerts.slice(0, 4) as alert, index (alert.id)}
					{@const cause = causeLabel(alert.cause, locale)}
					{@const effect = effectLabel(alert.effect, locale)}
					{@const display = displayAlert(alert)}
					{@const marker = alertLanguageNotice(display, locale)}
					{@const url = alertDisplayUrl(alert, locale)}
					{@const labelId = `${uid}-map-alert-label-${index}`}
					<li class="map-alert affected-alert" data-severity={alert.severity}>
						<Button
							variant="ghost"
							size="sm"
							type="button"
							class="map-alert-button"
							aria-labelledby={labelId}
							onclick={() => onalertselect?.(alert)}
						>
							<span class="affected-alert-dot" aria-hidden="true"
								>{severityGlyph(alert.severity)}</span
							>
							<span class="map-alert-text affected-alert-title">
								<span lang={display.lang ?? ''}>
									{display.text}
								</span>
								{#if marker}<span class="alert-language-marker">{marker}</span>{/if}
							</span>
							<ChevronRightIcon size={14} strokeWidth={2.25} aria-hidden="true" />
							<span id={labelId} class="sr-only">
								{t.selectAlertAction}
								<span lang={display.lang ?? ''}>
									{display.text}
								</span>
								{#if marker}<span>{marker}</span>{/if}
							</span>
						</Button>
						{#if cause || effect}
							<dl class="map-alert-meta affected-alert-meta">
								{#if cause}
									<div>
										<dt>{t.cause}</dt>
										<dd>{cause}</dd>
									</div>
								{/if}
								{#if effect}
									<div>
										<dt>{t.effect}</dt>
										<dd>{effect}</dd>
									</div>
								{/if}
							</dl>
						{/if}
						{#if url}
							<Button
								variant="ghost"
								size="sm"
								class="map-alert-link"
								href={url.href}
								hreflang={url.lang ?? undefined}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={t.alertLinkAria(url.host)}
							>
								{t.alertLink}<span class="map-alert-host">{url.host}</span><ArrowUpRightIcon
									size={13}
									strokeWidth={2.25}
									aria-hidden="true"
								/>
							</Button>
							{#if alertLanguageNotice(url, locale)}
								<span class="alert-language-marker map-alert-link-language"
									>{alertLanguageNotice(url, locale)}</span
								>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<StateNotice
				title={t.noAlerts}
				glyph="●"
				tone={alertsStale ? 'neutral' : 'positive'}
				presentation="silo"
			/>
		{/if}
	</section>
{/if}

<style>
	/* Detail alerts reuse alert-item.css (line and stop pages) at panel density. */
	:global(.map-alerts) {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	:global(.map-alerts h3) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-block-size: 2rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
	}
	:global(.map-alerts-count) {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	:global(.map-alerts-age) {
		margin: -0.375rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	:global(.map-alerts ul) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	:global(.map-alerts .map-alert) {
		--alert-tone: var(--dataviz-severity-high);
		min-width: 0;
		margin: 0;
		font-size: var(--text-small);
		color: var(--foreground);
	}
	:global(.map-alerts .map-alert[data-severity='critical']) {
		--alert-tone: var(--dataviz-severity-critical);
	}
	:global(.map-alerts .map-alert[data-severity='watch']) {
		--alert-tone: var(--dataviz-severity-watch);
	}
	:global(.map-alerts li.affected-alert) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		padding: 0.25rem 0.75rem 0.5rem;
		border-radius: var(--radius-md);
	}
	/* The hover card's one alert line: severity mark, two lines of text, a count. */
	:global(.map-alerts .map-peek-alert) {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: baseline;
		column-gap: 0.5rem;
		padding-block-start: 0.5rem;
		border-top: 1px solid var(--border-subtle);
		line-height: 1.35;
	}
	:global(.map-peek-alert .map-alert-severity) {
		margin: 0;
		color: var(--alert-tone);
	}
	:global(.map-peek-alert-text) {
		display: -webkit-box;
		min-width: 0;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	:global(.map-alert-button) {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 0.5rem;
		width: 100%;
		height: auto;
		min-block-size: var(--size-tap-min);
		padding-block: 0.5rem;
		padding-inline: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: 1.4;
		text-align: left;
		white-space: normal;
		cursor: pointer;
	}
	:global(.map-alert-button .affected-alert-dot) {
		font-size: var(--text-caption);
		line-height: 1.4;
	}
	:global(.map-alert-button .affected-alert-title) {
		font-size: var(--text-small);
		font-weight: 500;
		line-height: 1.4;
	}
	:global(.map-alert-button:hover) {
		background: transparent;
		color: var(--foreground);
	}
	:global(.map-alert-button:hover .affected-alert-title) {
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--alert-tone) 70%, transparent);
		text-underline-offset: 0.2em;
	}
	:global(.map-alert-button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	:global(.map-alert-button > svg) {
		align-self: center;
		opacity: 0.55;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	:global(.map-alert-button:hover > svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	:global(.map-alert-meta.affected-alert-meta) {
		margin: 0 0 0.25rem;
		padding-inline-start: 1.25rem;
	}
	:global(.map-alert-meta dt) {
		font-size: var(--text-micro);
	}
	:global(.map-alert-meta dd) {
		font-size: var(--text-caption);
	}
	:global(.map-alert-link) {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		gap: 0.375rem;
		min-block-size: var(--size-tap-min);
		height: auto;
		margin-inline-start: 1.25rem;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
		white-space: normal;
	}
	:global(.map-alert-link .map-alert-host) {
		color: var(--muted-foreground);
	}
	:global(.map-alert-link:hover) {
		background: transparent;
		text-decoration: underline;
	}
	:global(.map-alert-link:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	:global(.map-alert-text) {
		min-width: 0;
	}
	:global(.map-alert-severity) {
		margin-inline-end: 0.375rem;
		font-family: var(--font-mono);
		color: color-mix(in srgb, var(--alert-tone) 72%, var(--foreground) 28%);
	}
	:global(.map-peek-alerts-more) {
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	:global(.map-alerts .map-alert-link-language) {
		margin: -0.5rem 0 0 1.25rem;
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	:global(.map-alert-text .alert-language-marker) {
		margin-inline-start: 0.375rem;
		color: var(--muted-foreground);
		font-size: var(--text-caption);
		font-weight: 400;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.map-alert-button > svg) {
			transition: none;
		}
		:global(.map-alert-button:hover > svg) {
			transform: none;
		}
	}
</style>
