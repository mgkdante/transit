<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	interface Props {
		href: string;
		label: string;
		dataSlot?: string;
	}

	let { href, label, dataSlot = 'detail-footer-action' }: Props = $props();
</script>

<Button
	variant="ghost"
	size="sm"
	class="detail-inline-action"
	data-slot={dataSlot}
	{href}
	aria-label={label}
>
	<span>{label}</span>
	<ArrowRightIcon size={16} strokeWidth={2.4} aria-hidden="true" />
</Button>

<style>
	:global(.detail-inline-action) {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
		text-decoration: none;
	}
	:global(.detail-inline-action:hover) {
		text-decoration: underline;
	}
	:global(.detail-inline-action:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
