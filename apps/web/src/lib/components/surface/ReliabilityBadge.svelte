<!--
  ReliabilityBadge — a compact at-a-glance reliability mark for a LIST ROW.

  The visible payoff of the shared lazy loader (reliabilitySnapshot.svelte.ts):
  a tiny status-dot + headline OTP% (and an optional inline sparkline) that turns
  a bare navigational row into a health reading. Used by BOTH the /lines index
  and /search result rows.

  FAIL-SOFT BY CONSTRUCTION: renders NOTHING until the loader has a real verdict
  (phase 'ready' with a non-null OTP). A row still loading, or one whose history
  404s/errors (phase 'empty'), shows no badge — never a spinner, never an error,
  never a fabricated 0% (HONESTY: a null OTP is no badge, never a zero).

  DOCTRINE: the dot + sparkline are DATA marks on the dataviz status scale
  (StatusBadge 'dot' + Sparkline colorVar), never --primary. Colour is paired
  with the StatusBadge glyph so the verdict survives monochrome / colour-blind
  reading. Intrinsic OTP vocabulary (the "% on time" a11y phrasing) is local +
  bilingual — provider-agnostic.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { StatusCode } from '$lib/v1/schemas';
	import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
	import { StatusBadge, Sparkline, statusVar } from '$lib/components/dataviz';

	interface ReliabilityBadgeProps {
		/** The reactive snapshot for this row's entity, from the lazy loader. */
		snapshot: ReliabilitySnapshot;
		/** Active locale for the intrinsic OTP a11y phrasing + number grouping. */
		locale: Locale;
		/** Render the inline OTP sparkline alongside the dot + %. Default off. */
		sparkline?: boolean;
		/** Optional extra classes on the badge. */
		class?: string;
	}

	let { snapshot, locale, sparkline = false, class: className }: ReliabilityBadgeProps = $props();

	// Intrinsic, provider-agnostic bilingual vocabulary (the screen-reader phrasing
	// + the verdict words). Kept local: this is component-intrinsic, not surface copy.
	const L = {
		en: {
			onTime: (pct: string) => `${pct} on time`,
			series: 'On-time % trend, recent days',
			verdict: { on_time: 'On time', late: 'Late', severe: 'Severe' } as Record<string, string>,
		},
		fr: {
			onTime: (pct: string) => `${pct} à l’heure`,
			series: 'Tendance ponctualité, jours récents',
			verdict: {
				on_time: 'À l’heure',
				late: 'En retard',
				severe: 'Grave',
			} as Record<string, string>,
		},
	} as const;
	const t = $derived(L[locale]);

	const nf = $derived(locale === 'fr' ? 'fr-CA' : 'en-CA');
	const pctText = $derived(
		snapshot.otpPct == null
			? null
			: `${snapshot.otpPct.toLocaleString(nf)}${locale === 'fr' ? ' %' : '%'}`,
	);

	// Only paint when we have a real verdict + OTP — the fail-soft gate.
	const show = $derived(snapshot.phase === 'ready' && snapshot.verdict != null && pctText != null);
	const verdict = $derived(snapshot.verdict as StatusCode);
	const verdictLabel = $derived(snapshot.verdict ? (t.verdict[snapshot.verdict] ?? '') : '');
	const a11y = $derived(pctText ? `${verdictLabel} · ${t.onTime(pctText)}` : verdictLabel);

	// A sparkline only when asked AND there are at least two real points to draw a
	// line between — one lone point is not a trend (honesty: no fabricated slope).
	const realCount = $derived(snapshot.series.filter((v) => v != null).length);
	const showSpark = $derived(show && sparkline && realCount >= 2);
</script>

{#if show}
	<!--
	  ONE accessible name for the whole mark: the wrapper is role="img" with the
	  composed "<verdict> · <pct> on time" aria-label, and every visible inner part
	  is aria-hidden. Without this the dot's own sr-only label + the visible %% +
	  a standalone sr-only span announced the reading THREE times to a screen reader.
	-->
	<span
		class={['reliability-badge', className].filter(Boolean).join(' ')}
		data-slot="reliability-badge"
		data-verdict={verdict}
		role="img"
		aria-label={a11y}
		title={a11y}
	>
		{#if showSpark}
			<Sparkline
				class="reliability-badge-spark"
				values={snapshot.series}
				colorVar={statusVar(verdict)}
				width={48}
				height={16}
				stroke={1.4}
				label={t.series}
				aria-hidden="true"
			/>
		{/if}
		<span aria-hidden="true" class="reliability-badge-mark">
			<StatusBadge status={verdict} mode="dot" size="sm" label={verdictLabel} />
		</span>
		<span class="reliability-badge-pct" aria-hidden="true">{pctText}</span>
	</span>
{/if}

<style>
	.reliability-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.reliability-badge :global(.reliability-badge-spark) {
		flex: none;
	}
	/* The dot wrapper is a pure a11y-hiding shell — it must not perturb the row's
	   inline-flex layout, so it collapses to its contents. */
	.reliability-badge-mark {
		display: contents;
	}
	.reliability-badge-pct {
		font-weight: 600;
	}
</style>
