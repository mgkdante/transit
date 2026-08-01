<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';

	interface Props {
		href: string;
		label: string;
		dataSlot?: string;
	}

	let { href, label, dataSlot = 'detail-footer-action' }: Props = $props();
</script>

<a class="detail-inline-action" data-slot={dataSlot} {href} aria-label={label}>
	<span>{label}</span>
	<ArrowRightIcon size={16} strokeWidth={2.4} aria-hidden="true" />
</a>

<style>
	.detail-inline-action {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0.875rem;
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--primary) 9%, transparent);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
		text-decoration: none;
	}
</style>
