<script lang="ts">
	import ArticleSectionStack from '../ArticleSectionStack.svelte';
</script>

<ArticleSectionStack class="fixture-stack">
	<div data-slot="card" class="section-card" data-testid="direct-card">Direct</div>
	<section data-testid="section-wrapper">
		<div data-slot="card" class="section-card" data-testid="section-card">Section wrapped</div>
	</section>
	<a href="#wrapped" data-testid="anchor-wrapper">
		<div data-slot="card" class="section-card" data-testid="anchor-card">Anchor wrapped</div>
	</a>
	<div data-testid="component-wrapper">
		<section data-testid="component-root">
			<div data-slot="card" class="section-card" data-testid="component-card">
				Component wrapped
			</div>
		</section>
	</div>
</ArticleSectionStack>
