<!--
  Metric definitions open a popover so its explainer link stays keyboard-reachable.
  Hover/focus opens it; activation pins it; Escape closes and restores trigger focus.
  Interactive glyph/link may use --primary (doctrine-allow: interactive).
  Popover colors and focus rings use shared tokens; reduced motion drops transitions.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import {
		metricInfoFor,
		metricInfoCopy,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/metrics';
	import { cn } from '$lib/utils';

	type MetricInfoProps = {
		newTab?: boolean;
		side?: 'top' | 'bottom';
		class?: string;
	} & (
		| { metricKey: MetricKey | SupplementalMetricKey; locale: Locale; name: string }
		| { tip: string; href: string; label: string; linkLabel: string }
	);

	let props: MetricInfoProps = $props();
	let { newTab = false, side = 'top', class: className } = $derived(props);
	const content = $derived(
		'metricKey' in props
			? {
					...metricInfoFor(props.metricKey, props.locale),
					label: metricInfoCopy[props.locale].trigger(props.name),
					linkLabel: metricInfoCopy[props.locale].link,
				}
			: props,
	);
	const { tip, href, label, linkLabel } = $derived(content);

	let open = $state(false);
	let pinned = false;
	let root = $state<HTMLSpanElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);
	let pop = $state<HTMLSpanElement | null>(null);

	const tipId = $props.id();

	const GAP = 8;
	const EDGE = 8;

	let resolvedSide = $state<'top' | 'bottom'>('top');
	let fixedLeft = $state(0);
	let fixedTop = $state(0);
	let placed = $state(false);

	const transform = $derived(
		resolvedSide === 'top'
			? `translate(-50%, calc(-100% - ${GAP}px))`
			: `translate(-50%, ${GAP}px)`,
	);

	$effect(() => {
		if (!open) {
			resolvedSide = side;
			placed = false;
			return;
		}
		void tip;
		void linkLabel;
		void side;

		const trig = trigger;
		const box = pop;
		if (!trig || !box) {
			resolvedSide = side;
			return;
		}

		const tr = trig.getBoundingClientRect();
		const pb = box.getBoundingClientRect();
		const vw = typeof window !== 'undefined' ? window.innerWidth : tr.right;
		const vh = typeof window !== 'undefined' ? window.innerHeight : tr.bottom;

		const anchorX = tr.left + tr.width / 2;
		const topEdge = tr.top;
		const bottomEdge = tr.bottom;

		let next = side;
		if (
			side === 'top' &&
			topEdge - pb.height - GAP < EDGE &&
			bottomEdge + pb.height + GAP <= vh - EDGE
		) {
			next = 'bottom';
		} else if (
			side === 'bottom' &&
			bottomEdge + pb.height + GAP > vh - EDGE &&
			topEdge - pb.height - GAP >= EDGE
		) {
			next = 'top';
		}
		resolvedSide = next;

		const half = pb.width / 2;
		const minLeft = EDGE + half;
		const maxLeft = vw - EDGE - half;
		fixedLeft = maxLeft >= minLeft ? Math.min(Math.max(anchorX, minLeft), maxLeft) : vw / 2;

		const rawTop = next === 'top' ? topEdge - pb.height - GAP : bottomEdge + GAP;
		const minTop = EDGE;
		const maxTop = vh - pb.height - EDGE;
		const clampedBoxTop = maxTop >= minTop ? Math.min(Math.max(rawTop, minTop), maxTop) : minTop;
		fixedTop = next === 'top' ? clampedBoxTop + pb.height + GAP : clampedBoxTop - GAP;
		placed = true;
	});

	const GRACE_MS = 120;
	let graceTimer: ReturnType<typeof setTimeout> | null = null;

	let suppressFocusOpen = false;

	function cancelGrace(): void {
		if (graceTimer !== null) {
			clearTimeout(graceTimer);
			graceTimer = null;
		}
	}

	function openNow(): void {
		cancelGrace();
		open = true;
	}

	function onFocusIn(): void {
		if (suppressFocusOpen) {
			suppressFocusOpen = false;
			return;
		}
		openNow();
	}

	function scheduleClose(): void {
		cancelGrace();
		graceTimer = setTimeout(() => {
			graceTimer = null;
			if (!pinned && !root?.contains(document.activeElement)) close();
		}, GRACE_MS);
	}

	function returnFocusToTrigger(): void {
		if (!trigger) return;
		if (document.activeElement !== trigger) suppressFocusOpen = true;
		trigger.focus();
	}

	function close(returnFocus = false): void {
		cancelGrace();
		pinned = false;
		open = false;
		if (returnFocus) returnFocusToTrigger();
	}

	async function toggle(): Promise<void> {
		cancelGrace();
		pinned = !pinned;
		open = pinned;
		if (!open) {
			await tick();
			returnFocusToTrigger();
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close(true);
		}
	}

	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget as Node | null;
		if (next && root?.contains(next)) return;
		close();
	}

	$effect(() => {
		if (!open) return;
		const onDocPointer = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) close();
		};
		const onDismiss = () => close();
		document.addEventListener('pointerdown', onDocPointer, true);
		window.addEventListener('scroll', onDismiss, { capture: true, passive: true });
		window.addEventListener('resize', onDismiss, { passive: true });
		window.addEventListener('orientationchange', onDismiss, { passive: true });
		return () => {
			document.removeEventListener('pointerdown', onDocPointer, true);
			window.removeEventListener('scroll', onDismiss, true);
			window.removeEventListener('resize', onDismiss);
			window.removeEventListener('orientationchange', onDismiss);
		};
	});

	$effect(() => () => cancelGrace());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	bind:this={root}
	class={cn('metric-info', className)}
	onmouseenter={openNow}
	onmouseleave={scheduleClose}
	onfocusin={onFocusIn}
	onfocusout={onFocusOut}
	onkeydown={onKeydown}
>
	<button
		bind:this={trigger}
		type="button"
		class="metric-info__trigger"
		aria-label={label}
		aria-expanded={open}
		aria-controls={open ? tipId : undefined}
		onclick={toggle}
	>
		<span class="metric-info__glyph" aria-hidden="true">i</span>
	</button>

	{#if open}
		<span
			bind:this={pop}
			id={tipId}
			role="dialog"
			aria-label={label}
			class={cn('metric-info__pop', `metric-info__pop--${resolvedSide}`)}
			class:metric-info__pop--placed={placed}
			style="left: {fixedLeft}px; top: {fixedTop}px; transform: {transform};"
		>
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
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.05rem;
		block-size: 1.05rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		line-height: 1;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	/* Touch target floor (P5.3d §C4 P10): the glyph stays a 17px dot but the
	   HIT area is expanded to --size-tap-min via a centered transparent overlay.
	   Absolutely positioned → zero layout shift on the inline label row. */
	.metric-info__trigger::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		min-inline-size: var(--size-tap-min);
		min-block-size: var(--size-tap-min);
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
		font-size: var(--text-micro);
		font-style: italic;
		font-weight: 700;
	}

	.metric-info__pop {
		position: fixed;
		left: 0;
		top: 0;
		z-index: var(--z-menu);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		inline-size: max-content;
		max-inline-size: min(18rem, calc(100vw - 2 * 8px));
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow:
			0 2px 8px rgb(0 0 0 / 0.28),
			inset 0 1px 0 var(--edge-highlight);
		opacity: 0;
	}
	.metric-info__pop--placed {
		opacity: 1;
		animation: metric-info-in var(--duration-fast) var(--ease-out);
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
		letter-spacing: var(--tracking-eyebrow);
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
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.metric-info__trigger {
			transition: none;
		}
		.metric-info__pop--placed {
			animation: none;
		}
	}
</style>
