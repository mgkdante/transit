<script lang="ts">
	import { Button, type ButtonProps } from '@yesid/ui/button';
	let { checked, children, ...props }: ButtonProps & { checked: boolean } = $props();
</script>

<Button
	variant="ghost"
	size="sm"
	{...props}
	role="checkbox"
	aria-checked={checked}
	data-on={checked}
	class={['transit-checkbox-row', props.class].filter(Boolean).join(' ')}
>
	{@render children?.()}
</Button>

<style>
	:global(.transit-checkbox-row) {
		min-block-size: var(--size-tap-min);
		min-inline-size: var(--size-tap-min);
	}
	:global(.transit-checkbox-row[role='checkbox']) {
		padding-inline: 0;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		color: var(--foreground);
	}
	:global(.transit-checkbox-row[role='checkbox']::after) {
		content: '';
		margin-inline-start: auto;
		flex: none;
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--muted-foreground);
		border-radius: var(--radius-sm);
	}
	:global(.transit-checkbox-row[aria-checked='true']::after) {
		content: '';
		box-shadow: inset 0 0 0 3px var(--card);
		display: grid;
		place-items: center;
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}
</style>
