<script lang="ts">
	interface Props {
		label: string;
		keywords: readonly string[];
		class?: string;
	}

	let { label, keywords, class: className }: Props = $props();
</script>

<div class={className} data-slot="article-keywords">
	<p class="font-mono text-caption tracking-wide text-[var(--muted-foreground)] uppercase">
		{label}
	</p>
	<p class="mt-1 text-sm text-[var(--secondary-foreground)]">{keywords.join(' · ')}</p>
</div>
