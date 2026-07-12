<!--
  SectionNotReported — the receipt's NOT-REPORTED lines list (S13, NEW · the operator item).

  Pure presenter of selectNotReportedLines: lines scheduled today yet never seen in the
  live feed ('silent = scheduled but never appeared', distinct from an explicit
  cancellation). Mirrors the S9 SectionReporting silent-lines list — each row is a ranked
  link to /lines/[id]; list > listitem > link (the <li> owns the listitem role, the <a>
  the interactivity + accessible name, the inner RankedRow is `bare`). The bar rides
  RankedRow/SeverityBar on the FIXED absolute NOT_REPORTED_DOMAIN (doctrine-coded).

  SHOWN/TOTAL HONESTY (DB4): the pre-cap total drives a "showing N of M" note when the
  list is capped. Mounted by the orchestrator only when hasData — an ABSENT list is
  honest-absence upstream, never an empty list reading as 'every line reported'. A
  receipt line-group below the frame (WEB4 documented hoist — a list breaks the tile
  metaphor).
-->
<script lang="ts">
	import { RankedRow } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { NOT_REPORTED_DOMAIN, type NotReportedVM } from '../selectors/notReportedLines';

	interface SectionNotReportedProps {
		list: NotReportedVM;
		heading: string;
		caveat: string;
		/** "Showing 50 of 200" — rendered only when the list is capped below the total. */
		shownOfTotal: (shown: number, total: number) => string;
		headingLevel?: 2 | 3;
	}
	let { list, heading, caveat, shownOfTotal, headingLevel = 2 }: SectionNotReportedProps = $props();

	// Show the shown/total note only when the pre-cap total exceeds the shown rows.
	const truncated = $derived(list.total != null && list.total > list.shown);
</script>

<section class="receipt-not-reported" data-slot="receipt-not-reported" aria-label={heading}>
	<SectionHeading level={headingLevel} overline={heading} />
	<p class="receipt-not-reported-caveat" data-slot="receipt-not-reported-caveat">{caveat}</p>
	{#if truncated}
		<p class="receipt-not-reported-note" data-slot="receipt-shown-of-total">
			{shownOfTotal(list.shown, list.total ?? list.shown)}
		</p>
	{/if}
	<ul class="receipt-not-reported-list" role="list" aria-label={heading}>
		{#each list.rows as row (row.key)}
			<li class="receipt-not-reported-item">
				<a
					class="receipt-not-reported-link"
					href={row.href}
					data-sveltekit-preload-data="hover"
					data-slot="not-reported-link"
					aria-label={row.ariaLabel}
				>
					<RankedRow
						bare
						rank={row.rank}
						title={row.title}
						subtitle={row.subtitle}
						severity={row.severity}
						value={row.value}
						domain={NOT_REPORTED_DOMAIN}
						display={row.display}
					/>
				</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	.receipt-not-reported {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.receipt-not-reported-caveat,
	.receipt-not-reported-note {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.receipt-not-reported-list {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.5rem 1.25rem;
		max-width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.receipt-not-reported-item {
		display: block;
	}
	.receipt-not-reported-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.receipt-not-reported-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (min-width: 1024px) {
		.receipt-not-reported-list {
			grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
		}
	}
</style>
