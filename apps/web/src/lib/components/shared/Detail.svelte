<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { ChevronToggle } from '@yesid/ui/brand';

	let {
		label,
		labelOpen = undefined,
		open = $bindable(false),
		class: className,
		children,
	}: {
		label: string;
		labelOpen?: string;
		open?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
	const contentId = $props.id();
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});

	function toggle(event: MouseEvent | KeyboardEvent): void {
		if (!ready) return;
		if ('key' in event) {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
		} else if (event.button !== 0) {
			event.preventDefault();
			return;
		}
		open = !open;
	}

	let hasOpened = $state(false);
	$effect(() => {
		if (open) hasOpened = true;
	});

	const currentLabel = $derived(open ? (labelOpen ?? label) : label);
</script>

<div class={cn('detail', className)} data-slot="detail">
	<div data-slot="collapsible" data-state={open ? 'open' : 'closed'}>
		<button
			type="button"
			class="detail__toggle"
			data-slot="detail-toggle"
			data-state={open ? 'open' : 'closed'}
			aria-expanded={open}
			aria-controls={contentId}
			disabled={!ready}
			onclick={toggle}
			onkeydown={toggle}
		>
			<ChevronToggle {open} direction="down" size="sm" />
			<span>{currentLabel}</span>
		</button>
		<div
			id={contentId}
			class="collapsible-content"
			data-slot="collapsible-content"
			data-state={open ? 'open' : 'closed'}
			inert={!open}
			aria-hidden={open ? undefined : 'true'}
		>
			<div class="collapsible-content__inner">
				<div class="detail__body" data-slot="detail-body">
					{#if open || hasOpened}{@render children?.()}{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.detail__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0.375rem 0.125rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--muted-foreground);
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
	}
	.detail__toggle:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.detail__toggle:hover {
		color: var(--primary-hover);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.detail__toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
		border-radius: var(--radius-sm);
		color: var(--primary-hover);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.collapsible-content {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows var(--duration-slow) var(--ease-default),
			opacity var(--duration-slow) var(--ease-default);
	}
	.collapsible-content[data-state='open'] {
		grid-template-rows: 1fr;
		opacity: 1;
	}
	.collapsible-content__inner {
		min-height: 0;
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.detail__toggle,
		.collapsible-content {
			transition: none;
		}
	}

	.detail__body {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		padding-top: 1.5rem;
	}
</style>
