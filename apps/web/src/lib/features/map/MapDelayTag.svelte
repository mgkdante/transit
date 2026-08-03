<!--
  MapDelayTag — one delay cell, reused at every site (vehicle, next stops, live buses,
  buses to a stop, departures, route-times). KNOWN → the coloured delay tag (on-time
  only for 0); ABSENT → the honest absence routed through the unknown-data layer
  (AbsentValue), never "No delay" and never reading as on-time. The null-honesty rule
  (delay==null is NOT on-time) lives in mapSelectionDetail.logic.delayMaybe.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { AbsentValue } from '$lib/components/edge';
	import { delayKnownLabel, delayMaybe, delayTone } from './mapSelectionDetail.logic';
	import type { MapSelectionDetailCopy } from './mapSelectionDetail.copy';

	interface Props {
		delay: number | null | undefined;
		locale: Locale;
		t: MapSelectionDetailCopy;
		/** Reason context: `metro` (route_type 1, no realtime) and `stale` (the focused
		 *  vehicle's own fix has gone quiet) pick the honest absence reason. */
		ctx?: { stale?: boolean; metro?: boolean };
	}

	let { delay, locale, t, ctx = {} }: Props = $props();

	const m = $derived(delayMaybe(delay, ctx));
</script>

{#if m.known}
	<span class="map-delay-tag" data-tone={delayTone(m.value)}>
		{delayKnownLabel(m.value, t)}
	</span>
{:else}
	<AbsentValue reason={m.reason} {locale} params={m.params} />
{/if}

<style>
	/* ── Delay tone tag — colour-codes early / on-time / late ─── */
	.map-delay-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: inherit;
		font-weight: 600;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.map-delay-tag::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.map-delay-tag[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.map-delay-tag[data-tone='none']::before {
		display: none;
	}
	.map-delay-tag[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.map-delay-tag[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.map-delay-tag[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.map-delay-tag[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
</style>
