<script lang="ts">
	import type { VerdictResult } from '$lib/v1/verdict';

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
	}
	.verdict__ban {
		font-family: var(--font-heading);
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
	}
</style>
