<script lang="ts">
	import { cn } from '$lib/utils';

	export interface ListingHeaderStat {
		label: string;
		value: string | null;
	}

	export interface ListingHeaderStatsProps {
		label: string;
		stats: readonly ListingHeaderStat[];
		unknownLabel?: string;
		class?: string;
	}

	let {
		label,
		stats,
		unknownLabel = 'Not available',
		class: className,
	}: ListingHeaderStatsProps = $props();
</script>

<dl
	class={cn('listing-header-stats', className)}
	aria-label={label}
	data-slot="listing-header-stats"
>
	{#each stats as stat (stat.label)}
		<div class="listing-header-stat" data-slot="listing-header-stat">
			<dt>{stat.label}</dt>
			<dd data-unknown={stat.value === null ? 'true' : undefined}>
				{#if stat.value === null}
					<span class="sr-only">{unknownLabel}</span><span aria-hidden="true">&mdash;</span>
				{:else}
					{stat.value}
				{/if}
			</dd>
		</div>
	{/each}
</dl>

<style>
	.listing-header-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(8rem, 100%), 1fr));
		gap: 0.625rem 1rem;
		width: 100%;
		min-width: 0;
		margin: 0;
	}

	.listing-header-stat {
		min-width: 0;
		border-top: 1px solid var(--border);
		padding-top: 0.375rem;
	}

	dt,
	dd {
		margin: 0;
	}

	dt {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 700;
		color: var(--accent-text);
		letter-spacing: 0.02em;
		line-height: 1.25;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	dd {
		margin-top: 0.125rem;
		font-family: var(--font-heading);
		font-size: var(--text-stat-value);
		font-variant-numeric: tabular-nums;
		font-weight: 900;
		color: var(--foreground);
		line-height: 1;
		overflow-wrap: anywhere;
	}

	dd[data-unknown='true'] {
		color: var(--muted-foreground);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		clip-path: inset(50%);
	}
</style>
