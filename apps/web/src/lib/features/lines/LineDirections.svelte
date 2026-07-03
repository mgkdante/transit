<!--
  LineDirections — the per-line DIRECTIONS list (slice-S6 de-monolith, extracted
  from RouteDetail's Detail pane). The operator's loved layout: each direction is
  a column of its ordered stops, and the two directions lay SIDE-BY-SIDE once the
  pane is wide enough — a self-contained @container so the bidirectional split
  drives off THIS component's width, never the viewport (a single-direction route
  collapses to one column via auto-fit, never a lonely half).

  Each stop is a link into its detail page carrying the live readout: the soonest
  predicted arrival on this route (from the live trips) + the approaching bus's
  on-time status, or an honest "no live bus" when nothing is currently predicting
  it — never a fabricated time. The delay reading + tone come from the shared
  delayPresentation helpers (identical to the current-buses roster).

  Caller (RouteDetail) owns the section head (label + freshness) + the honest-
  absence note above this; this component renders ONLY the directions list (and
  nothing when the route carries no directions). Copy + locale are passed in.
-->
<script lang="ts" module>
	import type { RouteFile, StopPrediction } from '$lib/v1';
	import type { Locale } from '$lib/i18n';
	import type { RouteDetailCopy } from './lines.copy';

	export interface LineDirectionsProps {
		/** The static route file's directions (each with its ordered stops). */
		directions: RouteFile['directions'];
		/** Per-stop soonest predicted arrival, derived from the live trips on the route. */
		predictions: ReadonlyMap<string, StopPrediction>;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** Co-located route-detail copy for the active locale. */
		copy: RouteDetailCopy;
	}
</script>

<script lang="ts">
	import { localizeHref } from '$lib/i18n';
	import { routeFor } from '$lib/nav';
	import { stopNameFallback } from '$lib/site/absence';
	import { formatUtc } from '$lib/utils/time';
	import { delayLabel, delayTone } from '$lib/site/delayPresentation';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let { directions, predictions, locale, copy }: LineDirectionsProps = $props();

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });
</script>

{#if (directions ?? []).length > 0}
	<!-- container-type rides this PARENT wrapper; the side-by-side grid targets its
	     DESCENDANT .line-directions list (never this same element — the self-target
	     trap). At ≥44rem of CONTAINER width the two directions lay side-by-side
	     (auto-fit collapses to one column for a single-direction route). -->
	<div class="line-directions-pane" data-slot="line-directions">
		<ul class="line-directions">
			{#each directions ?? [] as dir, di (di)}
				<li class="line-direction">
					<span class="line-direction-head">
						<span class="line-direction-name">
							{dir.headsign ?? copy.direction(dir.dir)}
						</span>
						<span class="line-direction-meta">
							{copy.stopsCount((dir.stops ?? []).length)}
						</span>
					</span>
					{#if (dir.stops ?? []).length > 0}
						<ol class="line-stops">
							{#each dir.stops ?? [] as stop, si (stop.id + '-' + si)}
								{@const prediction = predictions.get(stop.id) ?? null}
								<li class="line-stop">
									<a
										class="line-stop-link"
										href={stopHref(stop.id)}
										aria-label={copy.viewStop(stop.name ?? stopNameFallback(stop.id, locale))}
									>
										<span class="line-stop-seq">{stop.seq}</span>
										<span class="line-stop-name"
											>{stop.name ?? stopNameFallback(stop.id, locale)}</span
										>
										<span class="line-stop-live">
											{#if prediction}
												{#if prediction.etaUtc}
													<time class="line-stop-eta" datetime={prediction.etaUtc}>
														{timeLabel(prediction.etaUtc)}
													</time>
												{:else}
													<span class="line-stop-eta">{copy.approaching}</span>
												{/if}
												<span class="line-stop-delay" data-tone={delayTone(prediction.delayMin)}>
													{delayLabel(prediction.delayMin, copy)}
												</span>
											{:else}
												<span class="line-stop-nolive">{copy.noLiveBus}</span>
											{/if}
										</span>
										<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
									</a>
								</li>
							{/each}
						</ol>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* ── Both directions side-by-side when the pane is wide (@container) ──────────
	   container-type rides .line-directions-pane (the PARENT); the grid targets its
	   DESCENDANT .line-directions list. At ≥44rem of CONTAINER width the two
	   directions lay side-by-side (auto-fit collapses to a single column when only
	   one direction exists, so a single-direction route never gets a lonely half
	   column). Drives off this pane's width, not the viewport. */
	.line-directions-pane {
		container-type: inline-size;
		container-name: line-directions;
	}
	.line-directions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	@container line-directions (min-width: 44rem) {
		.line-directions {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
			gap: 1.5rem 2rem;
			align-items: start;
		}
	}
	.line-direction {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.line-direction-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.line-direction-name {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-subheading);
		color: var(--foreground);
	}
	.line-direction-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.line-stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.line-stop {
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.line-stop:last-child {
		border-bottom: none;
	}
	/* Each stop is a link into its detail page: seq · name + live readout · chevron. */
	.line-stop-link {
		display: grid;
		grid-template-columns: 2ch minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		width: calc(100% + 1rem);
		margin-inline: -0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.line-stop-seq {
		min-width: 2ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		text-align: right;
	}
	.line-stop-name {
		font-size: var(--text-body);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-out);
	}
	/* Live readout: soonest predicted arrival + the approaching bus's status, or an
	   honest "no live bus" placeholder when nothing is currently predicting. */
	.line-stop-live {
		grid-column: 2;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.line-stop-eta {
		font-weight: 600;
		color: var(--foreground);
	}
	.line-stop-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-weight: 600;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.line-stop-delay::before {
		content: '';
		width: 0.4rem;
		height: 0.4rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.line-stop-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.line-stop-delay[data-tone='none']::before {
		display: none;
	}
	.line-stop-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.line-stop-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.line-stop-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.line-stop-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	.line-stop-nolive {
		color: var(--muted-foreground);
	}
	.line-stop-link :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.line-stop-link:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.line-stop-link:hover .line-stop-name {
		color: var(--primary);
	}
	.line-stop-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	@media (prefers-reduced-motion: reduce) {
		.line-stop-link,
		.line-stop-name,
		.line-stop-link :global(svg) {
			transition: none;
		}
		.line-stop-link:hover :global(svg) {
			transform: none;
		}
	}
</style>
