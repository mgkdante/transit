<!-- Zero-padded section index chip. Tabular digits keep a column of chips aligned. -->
<script lang="ts">
	import { cn } from '../cn/index.js';

	let {
		value,
		tone = 'rest',
		class: className,
	}: { value: number; tone?: 'rest' | 'active'; class?: string } = $props();

	const label = $derived(String(Math.trunc(value)).padStart(2, '0'));
</script>

<span data-slot="numbered-chip" data-tone={tone} class={cn('numbered-chip', className)} aria-hidden="true"
	>{label}</span
>

<style>
	.numbered-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.5rem;
		padding-inline: 0.375rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		flex-shrink: 0;
		line-height: 1;
	}

	.numbered-chip[data-tone='active'] {
		border-color: color-mix(in srgb, var(--primary) 30%, transparent);
		background: color-mix(in srgb, var(--primary) 15%, transparent);
		color: var(--primary);
	}
</style>
