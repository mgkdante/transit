<script lang="ts">
	import { known, absent, liveAbsenceReason, readLiveAbsenceContext } from '#lib/site/absence.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import { AbsentValue } from '#lib/components/edge/index.ts';
	import { delayKnownLabel, delayTone } from './mapSelectionDetail.logic';
	import type { MapSelectionDetailCopy } from './mapSelectionDetail.copy';

	interface Props {
		delay: number | null | undefined;
		locale: Locale;
		t: MapSelectionDetailCopy;
		ctx?: { stale?: boolean; metro?: boolean };
	}

	let { delay, locale, t, ctx = {} }: Props = $props();

	const absenceContext = readLiveAbsenceContext();
	const m = $derived(
		delay != null
			? known(delay)
			: absent<number>(
					liveAbsenceReason('prediction-delay', {
						...absenceContext(),
						notReporting: ctx.stale,
						unsupported: ctx.metro,
					}),
				),
	);
</script>

{#if m.known}
	<span class="map-delay-tag" data-tone={delayTone(m.value)}>
		{delayKnownLabel(m.value, t)}
	</span>
{:else}
	<AbsentValue reason={m.reason} {locale} params={m.params} />
{/if}

<style>
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
