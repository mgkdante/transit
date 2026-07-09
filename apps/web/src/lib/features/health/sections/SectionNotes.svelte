<!--
  SectionNotes — the pipeline-notes list: one label + verbatim methodology string
  per published key with no /metrics card. The parent passes the FULL derived note
  list (iterated off the whole published dict), so no key is dropped. Mechanical
  move out of HealthStatus.svelte. Stands DOWN (parent guards) when the list empty.
-->
<script lang="ts">
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
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
				<SectionLabel text={note.label} variant="metric" />
				<p class="health-note-text">{note.text}</p>
			</li>
		{/each}
	</ul>
</div>

<style>
	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
		max-width: 60ch;
	}
	.health-notes-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.health-note-item {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.health-note-text {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-detail-body-mobile);
		color: var(--muted-foreground);
		line-height: 1.8;
		max-width: 72ch;
		overflow-wrap: anywhere;
	}
	@media (min-width: 1024px) {
		.health-note,
		.health-note-text {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
</style>
