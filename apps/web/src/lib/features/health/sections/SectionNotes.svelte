<!--
  SectionNotes — the pipeline-notes list: one label + verbatim methodology string
  per published key with no /metrics card. The parent passes the FULL derived note
  list (iterated off the whole published dict), so no key is dropped. Mechanical
  move out of HealthStatus.svelte. Stands DOWN (parent guards) when the list empty.
-->
<script lang="ts">
	import { TypedInformationCard } from '$lib/components/shared';
	import type { PipelineNote } from '../selectors/provenanceViews';
	import type { HealthCopy } from '../health.copy';

	interface SectionNotesProps {
		notes: readonly PipelineNote[];
		copy: HealthCopy;
	}
	let { notes, copy }: SectionNotesProps = $props();
	const t = $derived(copy.pipelineNotes);
</script>

<div class="health-block" data-slot="notes-section">
	<p class="health-note">{t.note}</p>
	<ul class="health-notes-list" aria-label={t.listLabel} data-slot="pipeline-notes">
		{#each notes as note (note.key)}
			<li class="health-note-item">
				<TypedInformationCard kind={note.kind} label={note.label}>
					<p class="health-note-text">{note.text}</p>
				</TypedInformationCard>
			</li>
		{/each}
	</ul>
</div>

<style>
	.health-note {
		margin: 0;
		color: var(--foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}
	/* Kept local alongside the local base rule above: the scoped base (0,2,0) would
	   otherwise shadow the shared sheet's unscoped desktop override (0,1,0) — a
	   section keeping a local override of any property the shared @media sets must
	   keep its local @media too (S5-028 B-1). */
	@media (min-width: 1024px) {
		.health-note {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
	.health-notes-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	.health-note-item {
		min-width: 0;
	}
	.health-note-text {
		margin: 0;
		font-family: inherit;
		font-size: inherit;
		line-height: inherit;
		color: var(--foreground);
		overflow-wrap: anywhere;
	}
</style>
