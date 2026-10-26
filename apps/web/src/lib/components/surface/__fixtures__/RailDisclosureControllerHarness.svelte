<script lang="ts">
	import { onMount } from 'svelte';
	import { quietMode } from '@yesid/ui/state';
	import { createRailDisclosureController } from '../createRailDisclosureController.svelte';

	const disclosures = createRailDisclosureController({
		primary: 'rail-controller-test-primary',
		toc: 'rail-controller-test-toc',
	});

	onMount(() => quietMode.init());
</script>

<div
	data-testid="rail-controller-harness"
	data-primary-open={disclosures.isOpen('primary')}
	data-toc-open={disclosures.isOpen('toc')}
>
	<button
		type="button"
		data-testid="toggle-primary"
		onclick={() => disclosures.set('primary', !disclosures.isOpen('primary'))}
	>
		Toggle primary
	</button>
	<button
		type="button"
		data-testid="toggle-toc"
		onclick={() => disclosures.set('toc', !disclosures.isOpen('toc'))}
	>
		Toggle TOC
	</button>
	<button type="button" data-testid="close-all" onclick={() => disclosures.setAll(false)}>
		Close all
	</button>
	<button type="button" data-testid="open-all" onclick={() => disclosures.setAll(true)}>
		Open all
	</button>
	<button type="button" data-testid="quiet-toggle" onclick={() => quietMode.toggle()}>
		Toggle quiet mode
	</button>
</div>
