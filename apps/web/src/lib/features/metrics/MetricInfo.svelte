<!--
  MetricInfo — the reusable (i) affordance that sits next to a metric label on
  the reliability surface. On hover/focus/click it reveals a one-line plain
  explanation plus a keyboard-reachable link that deep-links into the in-app
  /metrics explainer at this metric's anchor (NOT Notion, NOT a new tab by
  default — first-party SPA content, back-button-friendly).

  Why hand-rolled (not the bits-ui Tooltip): a tooltip dismisses on blur, so it
  cannot host a focusable action link. This is a small click/focus POPOVER: the
  trigger toggles it; the popover contains the tip + the link; Escape closes and
  returns focus to the trigger; an outside click / focus-out dismisses it.

  DOCTRINE: --primary is fine here — it is an INTERACTIVE affordance (the trigger
  glyph + the link), never a data mark. (doctrine-allow: interactive)
  AA: glyph + link sit on --popover/--popover-foreground; focus ring mirrors the
  reliability segmented-control recipe (2px var(--ring), offset 2px).
  Reduced-motion: the fade/scale transition is dropped under prefers-reduced-motion.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { cn } from '$lib/utils';

	interface MetricInfoProps {
		/** Plain one-line explanation (already localized). */
		tip: string;
		/** Localized href to the explainer at this metric's anchor (e.g. "/fr/metrics#otp"). */
		href: string;
		/** Accessible name for the trigger (e.g. "About on-time %"), localized. */
		label: string;
		/** Link text shown inside the popover (e.g. "How this is measured"), localized. */
		linkLabel: string;
		/** Open the explainer in a new tab. Default false (in-app same-tab nav). */
		newTab?: boolean;
		/** Placement of the popover relative to the trigger. Default 'top'. */
		side?: 'top' | 'bottom';
		/** Extra classes on the inline wrapper. */
		class?: string;
	}

	let {
		tip,
		href,
		label,
		linkLabel,
		newTab = false,
		side = 'top',
		class: className,
	}: MetricInfoProps = $props();

	let open = $state(false);
	let root = $state<HTMLSpanElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);

	const tipId = $props.id();

	function close(returnFocus = false): void {
		open = false;
		if (returnFocus) trigger?.focus();
	}

	async function toggle(): Promise<void> {
		open = !open;
		// Keep focus management predictable when toggled by keyboard.
		if (!open) {
			await tick();
			trigger?.focus();
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close(true);
		}
	}

	// Dismiss on focus leaving the whole affordance (trigger + popover), and on an
	// outside pointer click. Hover open/close lives on the wrapper handlers below;
	// focus/click keep it usable by keyboard and pointer alike.
	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget as Node | null;
		if (next && root?.contains(next)) return;
		open = false;
	}

	$effect(() => {
		if (!open) return;
		const onDocPointer = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		document.addEventListener('pointerdown', onDocPointer, true);
		return () => document.removeEventListener('pointerdown', onDocPointer, true);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	bind:this={root}
	class={cn('metric-info', className)}
	onmouseenter={() => (open = true)}
	onmouseleave={() => (open = false)}
	onfocusout={onFocusOut}
	onkeydown={onKeydown}
>
	<button
		bind:this={trigger}
		type="button"
		class="metric-info__trigger"
		aria-label={label}
		aria-expanded={open}
		aria-describedby={open ? tipId : undefined}
		onclick={toggle}
	>
		<span class="metric-info__glyph" aria-hidden="true">i</span>
	</button>

	{#if open}
		<span id={tipId} role="tooltip" class={cn('metric-info__pop', `metric-info__pop--${side}`)}>
			<span class="metric-info__tip">{tip}</span>
			<a
				class="metric-info__link"
				{href}
				target={newTab ? '_blank' : undefined}
				rel={newTab ? 'noopener noreferrer' : undefined}
			>
				{linkLabel}
				<span aria-hidden="true">&rarr;</span>
			</a>
		</span>
	{/if}
</span>

<style>
	.metric-info {
		position: relative;
		display: inline-flex;
		align-items: center;
		vertical-align: baseline;
	}

	/* Trigger glyph — an INTERACTIVE affordance, so --primary is doctrine-clean
	   here (doctrine-allow: interactive). Muted at rest, accent on hover/focus. */
	.metric-info__trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.05rem;
		block-size: 1.05rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		line-height: 1;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.metric-info__trigger:hover,
	.metric-info__trigger[aria-expanded='true'] {
		color: var(--primary);
		border-color: var(--primary);
	}
	.metric-info__trigger:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.metric-info__glyph {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-style: italic;
		font-weight: 700;
	}

	/* Popover surface — solid --popover (no alpha, per doctrine), AA text. */
	.metric-info__pop {
		position: absolute;
		inset-inline-start: 50%;
		z-index: var(--z-menu);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		inline-size: max-content;
		max-inline-size: 18rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-card);
		transform: translateX(-50%);
		animation: metric-info-in var(--duration-fast) var(--ease-out);
	}
	.metric-info__pop--top {
		inset-block-end: calc(100% + 0.5rem);
	}
	.metric-info__pop--bottom {
		inset-block-start: calc(100% + 0.5rem);
	}
	.metric-info__tip {
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--popover-foreground);
		text-align: start;
		white-space: normal;
	}
	/* Link is an interactive affordance → --primary is doctrine-clean
	   (doctrine-allow: interactive). */
	.metric-info__link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--primary);
		text-decoration: none;
	}
	.metric-info__link:hover,
	.metric-info__link:focus-visible {
		text-decoration: underline;
	}
	.metric-info__link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	@keyframes metric-info-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(0.25rem);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.metric-info__trigger {
			transition: none;
		}
		.metric-info__pop {
			animation: none;
		}
	}
</style>
