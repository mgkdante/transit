<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { WithElementRef } from '../../cn/index.js';

	export type FooterGroupProps = WithElementRef<
		Omit<HTMLAttributes<HTMLDivElement>, 'children'>,
		HTMLDivElement
	> & {
		label: string;
		children: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '../../cn/index.js';

	let {
		ref = $bindable(null),
		label,
		children,
		class: className,
		'data-slot': dataSlot = 'footer-group',
		...restProps
	}: FooterGroupProps = $props();
</script>

<div
	{...restProps}
	bind:this={ref}
	data-slot={dataSlot}
	class={cn('flex flex-col gap-2', className)}
>
	<span data-slot="footer-group-label" class="footer-group-label">{label}</span>
	{@render children()}
</div>

<style>
	.footer-group-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--accent-text);
		margin-bottom: 2px;
	}
</style>
