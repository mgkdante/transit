<script lang="ts">
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import CollapsibleSection from '../CollapsibleSection.svelte';

	const SECTIONS = [
		{ dataSection: 'verdict', eyebrow: 'AT A GLANCE', question: 'Can I trust this line?' },
		{
			dataSection: 'when-to-ride',
			eyebrow: 'WHEN TO RIDE',
			question: 'When should I take this line?',
		},
		{ dataSection: 'the-wait', eyebrow: 'THE WAIT', question: 'How long will I wait?' },
		{ dataSection: 'run-and-fit', eyebrow: 'RUN AND FIT', question: 'Will I make my trip?' },
		{ dataSection: 'worst-stops', eyebrow: 'WORST STOPS', question: 'Where does it fail?' },
	] as const;
</script>

<QuietModeButton />
{#each SECTIONS as section, index (section.dataSection)}
	<CollapsibleSection {...section} number={index + 1}>
		<p data-testid={`reliability-section-body-${section.dataSection}`}>Rider answer</p>
	</CollapsibleSection>
{/each}
