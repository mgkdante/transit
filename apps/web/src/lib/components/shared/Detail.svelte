<!-- Analyst disclosure: native controls, retained content and token-based grid transitions. -->
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
		/** Control text when collapsed, e.g. "Show the detail". */
		label: string;
		/** Optional control text when expanded, e.g. "Hide the detail". Falls back to `label`. */
		labelOpen?: string;
		/** Expanded state — closed by default (progressive disclosure). Bindable. */
		open?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
	const contentId = $props.id();
	// SSR controls must not accept an activation before their handlers are attached.
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

	// Closed analyst content mounts once; retain it for state and closing transitions.
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
	/* A QUIET text+chevron control (operator: "make it simpler, not as sharp" — the heavy
	   tinted-orange pill was over-weighted for a one-tap disclosure). It is still an
	   interactive control, so the brand ORANGE stays on the LABEL (an affordance cue, not a
	   data mark) — but the pill background + border are gone: just the rotating chevron + the
	   label, underlined on hover. The tap target is held by padding (min-height 44px). */
	.detail__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		/* WCAG 2.2 (2.5.8) tap target, via padding rather than a heavy box. */
		min-height: 44px;
		padding: 0.375rem 0.125rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		/* Quiet at REST (muted caption voice, normal tracking) so the disclosure reads as calm
		   chrome, not a CTA; the brand orange lifts in only on hover/focus. The rotating chevron
		   is the persistent non-colour affordance that keeps it legible as interactive. */
		color: var(--muted-foreground);
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
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
		/* Keyboard users get the same orange + underline affordance hover gives. */
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

	/* Generous breathing room: the toggle-to-content gap PLUS a large gap BETWEEN every
	   revealed analyst block, in EVERY section (operator: opened details felt too plump).
	   A flex column with a clamp gap so the blocks read as distinct, uncrowded units. */
	.detail__body {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		padding-top: 1.5rem;
	}
</style>
