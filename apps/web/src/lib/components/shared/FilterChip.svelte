<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
	import { Button, type ButtonProps } from '@yesid/ui/button';
	let { children, ...props }: ButtonProps = $props();
</script>

<Button
	variant="ghost"
	size="sm"
	{...props}
	class={['transit-filter-chip', props.class].filter(Boolean).join(' ')}
	><Badge variant="tag-active" size="xs" class="transit-filter-chip-badge"
		>{@render children?.()}</Badge
	></Button
>

<style>
	:global(.transit-filter-chip) {
		min-block-size: var(--size-tap-min);
		min-inline-size: var(--size-tap-min);
	}
	:global(.transit-filter-chip-badge) {
		width: 100%;
		min-block-size: calc(var(--spacing) * 7);
		padding-inline: calc(var(--spacing) * 2);
		background: var(--muted);
		color: var(--foreground);
		border-color: var(--border-subtle);
		height: auto;
		min-width: 0;
		justify-content: space-between;
		white-space: normal;
		border-radius: var(--radius-sm);
	}
</style>
