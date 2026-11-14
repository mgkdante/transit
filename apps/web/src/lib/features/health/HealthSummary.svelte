<script lang="ts">
	import { untrack } from 'svelte';
	import type { Locale } from '#lib/i18n/index.ts';
	import { liveReader } from '#lib/v1/adapter/index.ts';
	import { createLiveStore, type LiveStore } from '#lib/v1/live/store.svelte.ts';
	import { getV1Runtime } from '#lib/v1/runtime.ts';
	import type { DataHealth, HistoricAvailabilityIndex, Manifest } from '#lib/v1/schemas/index.ts';
	import { recordGate, recordStamp } from '#lib/v1/stamp.ts';
	import { healthSummary } from './selectors/healthSummary';

	interface Props {
		manifest?: Manifest;
		dataHealth: DataHealth | null;
		historyIndex: HistoricAvailabilityIndex | null;
		gaps: readonly string[];
		locale: Locale;
	}
	let { manifest, dataHealth, historyIndex, gaps, locale }: Props = $props();

	// Line 1 reads the live store, so its age and staleness match every live stamp on the site.
	const clock = getV1Runtime().clock;
	$effect(() => clock.subscribe());
	let live = $state.raw<LiveStore | null>(null);
	const provider = $derived(manifest?.provider);
	$effect(() => {
		if (!provider) return;
		const store = untrack(() => createLiveStore(manifest!, liveReader, { families: ['vehicles'] }));
		live = store;
		store.start();
		return () => store.stop();
	});
	const health = $derived(live?.familyStates.vehicles.health);
	// After the first answer, a failure or retry keeps an unknown age rather than blanking the line.
	const known = $derived(health && health.state !== 'never-loaded' ? health : null);
	const lines = $derived(
		healthSummary(
			{
				live: known ?? null,
				record: recordStamp({ manifest: manifest ?? null, historyIndex }),
				gate: recordGate(dataHealth),
				gaps,
			},
			locale,
			manifest?.tz,
		),
	);
</script>

<div class="health-summary" data-slot="health-summary" aria-busy={provider != null && !known}>
	<p>{lines.live ?? ''}</p>
	<p>{lines.record ?? ''}</p>
	<p>{lines.doubt ?? ''}</p>
</div>

<style>
	.health-summary {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		font-size: var(--text-reading);
		line-height: 1.7;
		color: var(--foreground);
	}
	.health-summary p {
		margin: 0;
	}
	.health-summary p:empty {
		display: none;
	}
	/* Lines 1 and 3 wait for live data: hold their space so nothing below moves. */
	.health-summary[aria-busy='true'] p:not(:nth-child(2)) {
		display: block;
		min-block-size: 3.4em;
	}
	@media (--desktop-min) {
		.health-summary {
			font-size: var(--text-reading-desktop);
		}
		.health-summary[aria-busy='true'] p:not(:nth-child(2)) {
			min-block-size: 1.7em;
		}
	}
</style>
