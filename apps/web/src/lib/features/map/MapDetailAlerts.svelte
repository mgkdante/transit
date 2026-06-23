<!--
  MapDetailAlerts — the severity-coded alerts rail shared by every selection detail
  (vehicle / route / stop). Stands down to a quiet "no alerts" note when empty, never
  blank-hides. Self-contained: owns its markup + scoped styling.
-->
<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '$lib/i18n';
	import type { Alert } from '$lib/v1/schemas';
	import { alertDisplayText } from './mapAlerts';
	import { causeLabel, effectLabel } from './gtfsAlertLabels';
	import type { MapSelectionDetailCopy } from './mapSelectionDetail.copy';

	interface Props {
		alerts: readonly Alert[];
		locale: Locale;
		t: MapSelectionDetailCopy;
		compact?: boolean;
		onalertselect?: (alert: Alert) => void;
	}

	let { alerts, locale, t, compact = false, onalertselect }: Props = $props();

	function displayAlert(alert: Alert): string {
		return alertDisplayText(alert, locale);
	}
</script>

<section class="map-alerts" aria-label={t.alerts}>
	<h3>{t.alerts}</h3>
	{#if alerts.length > 0}
		<ul>
			{#each alerts.slice(0, compact ? 2 : 4) as alert (alert.id)}
				{@const cause = causeLabel(alert.cause, locale)}
				{@const effect = effectLabel(alert.effect, locale)}
				<li data-severity={alert.severity}>
					<button
						type="button"
						class="map-alert-button"
						aria-label={t.selectAlert(displayAlert(alert))}
						onclick={() => onalertselect?.(alert)}
					>
						{displayAlert(alert)}
						<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
					</button>
					{#if cause || effect}
						<dl class="map-alert-meta">
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
				</li>
			{/each}
		</ul>
	{:else}
		<p>{t.noAlerts}</p>
	{/if}
</section>

<style>
	/* ── Alerts — severity-coded signage rail ─────────────────── */
	.map-alerts {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.map-alerts h3 {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-alerts h3::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}
	.map-alerts ul {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-alerts li {
		--alert-tone: var(--dataviz-severity-high);
		position: relative;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--alert-tone) 32%, var(--border) 68%);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--alert-tone) 9%, var(--card));
		padding: 0.5rem 0.6rem 0.5rem 0.85rem;
		font-size: var(--text-small);
		color: var(--foreground);
		overflow: hidden;
	}
	/* Severity rail down the leading edge. */
	.map-alerts li::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--alert-tone);
	}
	.map-alerts li[data-severity='critical'] {
		--alert-tone: var(--dataviz-severity-critical);
	}
	.map-alerts li[data-severity='high'] {
		--alert-tone: var(--dataviz-severity-high);
	}
	.map-alerts li[data-severity='watch'] {
		--alert-tone: var(--dataviz-severity-watch);
	}
	.map-alert-button {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0;
		color: inherit;
		font: inherit;
		line-height: 1.35;
		text-align: left;
		background: transparent;
		border: 0;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.map-alert-button :global(svg) {
		flex: none;
		opacity: 0.55;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.map-alert-button:hover {
		color: var(--primary);
	}
	.map-alert-button:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.map-alert-button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* Cause / effect metadata — a labeled mono caption line under the headline.
	   Each entry is a small uppercase caption + value pill, tinted by the alert's
	   own severity tone so it reads as part of the same signage block. */
	.map-alert-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.6rem;
		margin: 0.5rem 0 0;
	}
	.map-alert-meta div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
	}
	.map-alert-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--alert-tone) 70%, var(--muted-foreground));
	}
	.map-alert-meta dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
	}
	/* Empty state — quiet, distinct from an active alert. */
	.map-alerts p {
		margin: 0;
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-md);
		background: var(--muted);
		padding: 0.55rem 0.7rem;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	@media (prefers-reduced-motion: reduce) {
		.map-alert-button,
		.map-alert-button :global(svg) {
			transition: none;
		}
		.map-alert-button:hover :global(svg) {
			transform: none;
		}
	}
</style>
