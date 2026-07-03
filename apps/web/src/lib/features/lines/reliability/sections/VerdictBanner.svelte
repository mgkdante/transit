<!--
  VerdictBanner — the §0 at-a-glance answer: a big-aggregate number (BAN) coloured by the
  reliability band, beside the plain-language two-sided verdict sentence.

  TEXT-LED by design (research pass-2): the sentence carries the probability content (the
  Deterministic Construal Error — readers get the number right 94% as text vs ~36% from any
  graphic), so the BAN is a redundant glance cue and is aria-hidden (the screen reader reads
  the sentence once). The band colour rides the dataviz STATUS scale (never --primary) and is
  ALWAYS paired with the band word in the sentence — colour is never the sole channel
  (WCAG 1.4.1). When there's no percentage to read the verdict says "still measuring" with no
  BAN, so this doubles as §0's honest empty state.
-->
<script lang="ts">
	import type { VerdictResult } from '../selectors/verdict';

	let { result }: { result: VerdictResult } = $props();

	const STATUS_COLOR: Record<VerdictResult['status'], string> = {
		reliable: 'var(--dataviz-status-on-time)',
		patchy: 'var(--dataviz-status-late)',
		unreliable: 'var(--dataviz-status-severe)',
		tentative: 'var(--dataviz-status-unknown)',
		absent: 'var(--muted-foreground)',
	};
	const color = $derived(STATUS_COLOR[result.status]);
</script>

<div
	class="verdict"
	data-slot="verdict"
	data-status={result.status}
	style={`--verdict-accent: ${color}`}
>
	{#if result.ban}
		<span class="verdict__ban" aria-hidden="true">{result.ban}</span>
	{/if}
	<p class="verdict__sentence">{result.sentence}</p>
</div>

<style>
	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1.25rem;
		/* §C4 P7: the former 3px band-colour left-stripe is retired — it was a
		   REDUNDANT, non-text cue; the band colour still rides the BAN + the band
		   word in the sentence, so no signal is lost. */
	}
	.verdict__ban {
		font-family: var(--font-heading);
		/* Reads preattentively — large, but ≤2.5× the body so WCAG 1.4.4 Resize holds. */
		font-size: var(--text-display);
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		letter-spacing: var(--tracking-tight);
		color: var(--verdict-accent, var(--foreground));
	}
	.verdict__sentence {
		flex: 1 1 18rem;
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-subheading);
		line-height: 1.45;
		color: var(--foreground);
		/* Cap the measure for readability (research: ~45–75ch). */
		max-inline-size: 60ch;
	}
</style>
