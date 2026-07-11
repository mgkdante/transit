<script lang="ts">
	import { Portal } from 'bits-ui';
	import type { ChartDatumPopoverController } from './useChartDatumPopover.svelte';

	export interface ChartDatumPopoverProps {
		controller: ChartDatumPopoverController;
	}

	let { controller }: ChartDatumPopoverProps = $props();
	let surface = $state<HTMLDivElement | null>(null);
	let left = $state(0);
	let top = $state(0);
	let placed = $state(false);

	const GAP = 8;
	const EDGE = 8;
	const visible = $derived(controller.open && controller.model !== null);
	const model = $derived(controller.model);

	function clamp(value: number, minimum: number, maximum: number): number {
		return Math.min(Math.max(value, minimum), maximum);
	}

	function handleFocusOut(event: FocusEvent): void {
		const destination = event.relatedTarget;
		const currentTarget = event.currentTarget;
		if (
			!(destination instanceof Node) ||
			!(currentTarget instanceof Node) ||
			!currentTarget.contains(destination)
		) {
			controller.close();
		}
	}

	$effect(() => {
		if (!visible) {
			placed = false;
			return;
		}

		const element = surface;
		const activeModel = controller.model;
		const anchorX = controller.x;
		const anchorY = controller.y;
		if (!element || !activeModel) {
			placed = false;
			return;
		}

		placed = false;
		const box = element.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const maximumLeft = Math.max(EDGE, viewportWidth - EDGE - box.width);
		const maximumTop = Math.max(EDGE, viewportHeight - EDGE - box.height);

		let nextLeft = anchorX - box.width / 2;
		let nextTop = anchorY - box.height - GAP;
		const bottomTop = anchorY + GAP;
		if (nextTop < EDGE && bottomTop + box.height <= viewportHeight - EDGE) {
			nextTop = bottomTop;
		}

		nextLeft = clamp(nextLeft, EDGE, maximumLeft);
		nextTop = clamp(nextTop, EDGE, maximumTop);
		left = nextLeft;
		top = nextTop;
		placed = true;
	});

	$effect(() => {
		if (!visible || !surface) return;

		function dismiss(): void {
			controller.close();
		}

		function handlePointerDown(event: PointerEvent): void {
			if (!(event.target instanceof Node) || !surface?.contains(event.target)) dismiss();
		}

		function handleKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape') dismiss();
		}

		function handleScroll(event: Event): void {
			const activeSurface = surface;
			if (activeSurface) {
				const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
				if (path.includes(activeSurface)) return;

				const target = event.target;
				if (target instanceof Node && activeSurface.contains(target)) return;
			}
			dismiss();
		}

		document.addEventListener('pointerdown', handlePointerDown, true);
		document.addEventListener('keydown', handleKeyDown);
		window.addEventListener('scroll', handleScroll, true);
		window.addEventListener('resize', dismiss);
		window.addEventListener('orientationchange', dismiss);

		return () => {
			document.removeEventListener('pointerdown', handlePointerDown, true);
			document.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('scroll', handleScroll, true);
			window.removeEventListener('resize', dismiss);
			window.removeEventListener('orientationchange', dismiss);
		};
	});
</script>

{#if visible && model}
	<Portal>
		<div
			bind:this={surface}
			id={controller.id}
			class="chart-datum-popover"
			class:chart-datum-popover--placed={placed}
			role="dialog"
			aria-modal="false"
			aria-labelledby={`${controller.id}-heading`}
			data-placed={placed}
			style:left={`${left}px`}
			style:top={`${top}px`}
			onfocusout={handleFocusOut}
		>
			<h2 id={`${controller.id}-heading`} class="chart-datum-popover__heading">
				{model.heading}
			</h2>
			{#if model.meta}
				<p class="chart-datum-popover__meta">{model.meta}</p>
			{/if}
			<dl class="chart-datum-popover__evidence">
				{#each model.rows as row, index (`${row.label}-${index}`)}
					<div class="chart-datum-popover__row">
						<dt class="chart-datum-popover__term">
							{#if row.colorVar}
								<span
									class="chart-datum-popover__swatch"
									data-swatch
									style:background={row.colorVar}
									aria-hidden="true"
								></span>
							{/if}
							{row.label}
						</dt>
						<dd class="chart-datum-popover__value">{row.value}</dd>
					</div>
				{/each}
			</dl>
			{#if model.action}
				<a
					href={model.action.href}
					class="chart-datum-popover__action"
					aria-label={model.action.ariaLabel}>{model.action.label}</a
				>
			{/if}
		</div>
	</Portal>
{/if}

<style>
	.chart-datum-popover {
		position: fixed;
		z-index: var(--z-menu);
		box-sizing: border-box;
		width: max-content;
		max-width: min(22rem, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow: auto;
		padding: 0.75rem;
		visibility: hidden;
		color: var(--popover-foreground);
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow-wrap: anywhere;
	}

	.chart-datum-popover--placed {
		visibility: visible;
		animation: chart-datum-popover-in var(--duration-fast) var(--ease-out) both;
	}

	.chart-datum-popover__heading,
	.chart-datum-popover__meta {
		margin: 0;
	}

	.chart-datum-popover__heading {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 650;
	}

	.chart-datum-popover__meta {
		margin-top: 0.2rem;
		font-size: var(--text-micro);
		opacity: 0.72;
	}

	.chart-datum-popover__evidence {
		display: grid;
		gap: 0.35rem;
		margin: 0.65rem 0 0;
	}

	.chart-datum-popover__row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 1rem;
	}

	.chart-datum-popover__term {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		font-size: var(--text-caption);
	}

	.chart-datum-popover__swatch {
		flex: none;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: var(--radius-sm);
	}

	.chart-datum-popover__value {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.chart-datum-popover__action {
		display: inline-flex;
		margin-top: 0.75rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 650;
		color: var(--primary);
		text-underline-offset: 0.2em;
		border-radius: var(--radius-sm);
	}

	.chart-datum-popover__action:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	@keyframes chart-datum-popover-in {
		from {
			opacity: 0;
			transform: translateY(0.2rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chart-datum-popover--placed {
			animation: none;
		}
	}
</style>
