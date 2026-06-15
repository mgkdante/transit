<script lang="ts">
	// Self-hosted variable fonts (side-effect imports) BEFORE app.css.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';

	let { children } = $props();
</script>

<div class="app-shell circuit-grid">
	<main id="main">
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		min-height: 100svh;
		background-color: var(--background);
	}
</style>
