<!--
  ManifestoCanvas — Interactive circuit node canvas (ported 1:1 from yesid.dev,
  P5-R R3a.2; the article headers' ambient layer). Renders grid-aligned nodes
  that glow on cursor proximity, draws trace connections between nearby active
  nodes, emits concentric ripple pulses on click/tap. Respects
  prefers-reduced-motion: static nodes only. The host element must be
  position:relative and pass itself as containerEl; the ripple classes live in
  the consumer's :global styles (ArticleHeader).
-->
<script module lang="ts">
	let nextSubscriptionId = 0;

	function createSubscriptionId(): string {
		nextSubscriptionId += 1;
		return `manifesto-canvas-${nextSubscriptionId}`;
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { isPrefersReducedMotion } from '$lib/motion';
	import { subscribe, unsubscribe } from '$lib/motion/utils/ticker';

	interface Props {
		containerEl?: HTMLElement;
	}

	let { containerEl }: Props = $props();

	const GRID = 80;
	const PROXIMITY = 120;
	const TRACE_PROXIMITY = 160;
	const subscriptionId = createSubscriptionId();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let warmGlow: HTMLDivElement;
	let width = 0;
	let height = 0;
	let mouseX = -999;
	let mouseY = -999;
	let isVisible = false;
	let visibilityObserver: IntersectionObserver | null = null;

	interface CircuitNode {
		x: number;
		y: number;
		baseOpacity: number;
		currentOpacity: number;
		targetOpacity: number;
		size: number;
		glowSize: number;
	}

	let nodes: CircuitNode[] = [];

	// Canvas can't read CSS vars at draw time, so mirror --primary-rgb here: the
	// node field paints #A05500 in light / #E07800 in dark, re-read on the
	// themechange event the theme store dispatches.
	let primaryRgb = '224,120,0';
	function readPrimaryRgb() {
		if (!browser) return;
		const v = getComputedStyle(document.documentElement).getPropertyValue('--primary-rgb').trim();
		if (v) primaryRgb = v.split(/\s+/).join(',');
	}

	function paintStatic() {
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);
		for (const node of nodes) {
			ctx.beginPath();
			ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${primaryRgb},${node.baseOpacity})`;
			ctx.fill();
		}
	}

	function generateNodes() {
		nodes = [];
		for (let x = GRID; x < width; x += GRID) {
			for (let y = GRID; y < height; y += GRID) {
				nodes.push({
					x,
					y,
					baseOpacity: 0.06 + Math.random() * 0.06,
					currentOpacity: 0,
					targetOpacity: 0,
					size: 1.5 + Math.random() * 1.5,
					glowSize: 0,
				});
			}
		}
	}

	function resize() {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		width = rect.width;
		height = rect.height;
		canvas.width = width;
		canvas.height = height;
		generateNodes();
	}

	function onMouseMove(e: MouseEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		mouseX = e.clientX - rect.left;
		mouseY = e.clientY - rect.top;
		warmGlow.style.left = `${mouseX}px`;
		warmGlow.style.top = `${mouseY}px`;
	}

	function onMouseLeave() {
		mouseX = -999;
		mouseY = -999;
		warmGlow.style.left = '50%';
		warmGlow.style.top = '50%';
	}

	function onTouchMove(e: TouchEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const touch = e.touches[0];
		mouseX = touch.clientX - rect.left;
		mouseY = touch.clientY - rect.top;
		warmGlow.style.left = `${mouseX}px`;
		warmGlow.style.top = `${mouseY}px`;
	}

	function onTap(e: MouseEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		const outer = document.createElement('div');
		outer.className = 'manifesto__ripple';
		outer.setAttribute('aria-hidden', 'true');
		outer.style.left = `${x}px`;
		outer.style.top = `${y}px`;
		containerEl.appendChild(outer);
		setTimeout(() => outer.remove(), 1200);

		const inner = document.createElement('div');
		inner.className = 'manifesto__ripple-inner';
		inner.setAttribute('aria-hidden', 'true');
		inner.style.left = `${x}px`;
		inner.style.top = `${y}px`;
		containerEl.appendChild(inner);
		setTimeout(() => inner.remove(), 800);
	}

	function animate() {
		// IO-gated: skip the frame entirely when the Manifesto section is
		// offscreen. Subscription stays registered (cheap) to avoid churn.
		if (!isVisible) return;
		if (!ctx) return;
		ctx.clearRect(0, 0, width, height);

		const activeNodes: CircuitNode[] = [];

		for (const node of nodes) {
			const dx = mouseX - node.x;
			const dy = mouseY - node.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < PROXIMITY) {
				const factor = 1 - dist / PROXIMITY;
				node.targetOpacity = node.baseOpacity + factor * 0.5;
				node.glowSize = factor * 12;
				activeNodes.push(node);
			} else {
				node.targetOpacity = node.baseOpacity;
				node.glowSize = Math.max(0, node.glowSize - 0.5);
			}

			node.currentOpacity += (node.targetOpacity - node.currentOpacity) * 0.15;

			if (node.glowSize > 0.5) {
				ctx.beginPath();
				ctx.arc(node.x, node.y, node.glowSize, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(${primaryRgb},${node.currentOpacity * 0.3})`;
				ctx.fill();
			}

			ctx.beginPath();
			ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${primaryRgb},${node.currentOpacity})`;
			ctx.fill();
		}

		if (activeNodes.length >= 2) {
			for (let i = 0; i < activeNodes.length; i++) {
				for (let j = i + 1; j < activeNodes.length; j++) {
					const a = activeNodes[i];
					const b = activeNodes[j];
					const dx = a.x - b.x;
					const dy = a.y - b.y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < TRACE_PROXIMITY) {
						const opacity = (1 - dist / TRACE_PROXIMITY) * 0.25;
						ctx.beginPath();
						ctx.moveTo(a.x, a.y);
						ctx.lineTo(b.x, b.y);
						ctx.strokeStyle = `rgba(${primaryRgb},${opacity})`;
						ctx.lineWidth = 1;
						ctx.stroke();
					}
				}
			}
		}
	}

	let initialized = false;
	let currentContainer: HTMLElement | undefined;

	// Use $effect to react when containerEl becomes available (bind:this timing)
	$effect(() => {
		if (!browser || !canvas || !containerEl || initialized) return;
		initialized = true;
		currentContainer = containerEl;

		ctx = canvas.getContext('2d');
		if (!ctx) return;

		readPrimaryRgb();
		const reducedMotion = isPrefersReducedMotion();
		// The resource-backed meta row can change the cover height after mount.
		// Observe the actual host box so the bitmap and pointer coordinates stay in
		// lock-step with both async content growth and viewport/orientation changes.
		const resizeObserver = new ResizeObserver(() => {
			resize();
			if (reducedMotion) paintStatic();
		});
		resizeObserver.observe(containerEl);
		resize();

		if (reducedMotion) {
			paintStatic();
			const onThemeChange = () => {
				readPrimaryRgb();
				paintStatic();
			};
			document.addEventListener('themechange', onThemeChange);
			return () => {
				resizeObserver.disconnect();
				document.removeEventListener('themechange', onThemeChange);
			};
		}

		// IO gate — pause painting when the Manifesto section scrolls out
		// of view. rootMargin: 50px so painting resumes just before the
		// section re-enters the viewport to avoid a visible frame-drop.
		visibilityObserver = new IntersectionObserver(
			(entries) => {
				isVisible = entries[0].isIntersecting;
			},
			{ rootMargin: '50px' },
		);
		visibilityObserver.observe(containerEl);

		// Shared ticker — one RAF loop site-wide; animate() early-returns
		// when !isVisible, so offscreen paints cost a cheap if-check only.
		subscribe(subscriptionId, animate);

		containerEl.addEventListener('mousemove', onMouseMove);
		containerEl.addEventListener('mouseleave', onMouseLeave);
		containerEl.addEventListener('touchmove', onTouchMove, { passive: true });
		containerEl.addEventListener('click', onTap);
		const onThemeChange = () => readPrimaryRgb();
		document.addEventListener('themechange', onThemeChange);

		return () => {
			unsubscribe(subscriptionId);
			resizeObserver.disconnect();
			visibilityObserver?.disconnect();
			visibilityObserver = null;
			if (currentContainer) {
				currentContainer.removeEventListener('mousemove', onMouseMove);
				currentContainer.removeEventListener('mouseleave', onMouseLeave);
				currentContainer.removeEventListener('touchmove', onTouchMove);
				currentContainer.removeEventListener('click', onTap);
			}
			document.removeEventListener('themechange', onThemeChange);
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="manifesto__canvas"
	data-testid="manifesto-canvas"
	aria-hidden="true"
></canvas>
<div
	bind:this={warmGlow}
	class="manifesto__warm-glow"
	style="left:50%;top:50%;"
	aria-hidden="true"
></div>

<style>
	.manifesto__canvas {
		position: absolute;
		inset: 0;
		z-index: var(--z-content);
		pointer-events: none;
	}

	.manifesto__warm-glow {
		position: absolute;
		width: 800px;
		height: 500px;
		background: radial-gradient(
			ellipse,
			color-mix(in srgb, var(--glow) 6%, transparent) 0%,
			color-mix(in srgb, var(--accent) 2%, transparent) 30%,
			transparent 60%
		);
		transform: translate(-50%, -50%);
		pointer-events: none;
		transition:
			left 0.8s ease-out,
			top 0.8s ease-out;
		z-index: var(--z-base);
	}

	/* Light mode: same cursor-follow warm glow, but on the light surface the 6%/2%
	   mix tuned for the dark board is invisible. Lift primary -> 16% and accent ->
	   8% so the cast reads with the same presence as dark (1:1 parity). The shared
	   .manifesto__warm-glow class also drives the blog + project detail headers, so
	   this lifts all three at once. */
	:global([data-theme='light']) .manifesto__warm-glow {
		background: radial-gradient(
			ellipse,
			color-mix(in srgb, var(--glow) 16%, transparent) 0%,
			color-mix(in srgb, var(--accent) 8%, transparent) 30%,
			transparent 60%
		);
	}
</style>
