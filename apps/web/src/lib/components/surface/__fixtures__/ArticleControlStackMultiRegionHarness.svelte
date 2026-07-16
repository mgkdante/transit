<script lang="ts">
	import ArticleControlStack from '../ArticleControlStack.svelte';
</script>

<ArticleControlStack>
	{#snippet secondary()}
		<button type="button">Window</button>
		<button type="button">Delay channel</button>
	{/snippet}
</ArticleControlStack>
