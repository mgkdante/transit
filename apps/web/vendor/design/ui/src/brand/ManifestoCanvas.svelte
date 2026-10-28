<!--
  Circuit-node backdrop for brand headers: grid nodes glow and link up near the pointer, and a
  click sends out a ripple. It fills `containerEl`, which must be positioned, and listens on it.
  Static nodes under reduced motion. Decorative.
-->
<script lang="ts" module>
	export interface ManifestoCanvasProps {
		containerEl?: HTMLElement;
	}
</script>

<script lang="ts">
	import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { subscribe, unsubscribe } from '@yesid/motion/utils/ticker';

	let { containerEl }: ManifestoCanvasProps = $props();

	const GRID = 80;
	const PROXIMITY = 120;
	const TRACE_PROXIMITY = 160;
	const uid = $props.id();
	const subscriptionId = `manifesto-canvas-${uid}`;

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let warmGlow: HTMLDivElement;
	let width = 0;
	let height = 0;
	let mouseX = -999;
	let mouseY = -999;
	let isVisible = false;

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

	// Canvas can't read CSS variables while drawing, so it mirrors --primary-rgb.
	let primaryRgb = '224,120,0';
	function readPrimaryRgb() {
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

	function resize(host: HTMLElement) {
		const rect = host.getBoundingClientRect();
		width = rect.width;
		height = rect.height;
		canvas.width = width;
		canvas.height = height;
		generateNodes();
	}

	function pointAt(clientX: number, clientY: number) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		mouseX = clientX - rect.left;
		mouseY = clientY - rect.top;
		warmGlow.style.left = `${mouseX}px`;
		warmGlow.style.top = `${mouseY}px`;
	}

	function onMouseMove(e: MouseEvent) {
		pointAt(e.clientX, e.clientY);
	}

	function onTouchMove(e: TouchEvent) {
		pointAt(e.touches[0].clientX, e.touches[0].clientY);
	}

	function onMouseLeave() {
		mouseX = -999;
		mouseY = -999;
		warmGlow.style.left = '50%';
		warmGlow.style.top = '50%';
	}

	function ripple(host: HTMLElement, className: string, x: number, y: number, lifetime: number) {
		const ring = document.createElement('div');
		ring.className = className;
		ring.setAttribute('aria-hidden', 'true');
		ring.style.left = `${x}px`;
		ring.style.top = `${y}px`;
		host.appendChild(ring);
		setTimeout(() => ring.remove(), lifetime);
	}

	function onTap(e: MouseEvent) {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		ripple(containerEl, 'manifesto__ripple', x, y, 1200);
		ripple(containerEl, 'manifesto__ripple-inner', x, y, 800);
	}

	function animate() {
		if (!isVisible || !ctx) return;
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

		for (let i = 0; i < activeNodes.length; i++) {
			for (let j = i + 1; j < activeNodes.length; j++) {
				const a = activeNodes[i];
				const b = activeNodes[j];
				const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
				if (dist < TRACE_PROXIMITY) {
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.strokeStyle = `rgba(${primaryRgb},${(1 - dist / TRACE_PROXIMITY) * 0.25})`;
					ctx.lineWidth = 1;
					ctx.stroke();
				}
			}
		}
	}

	$effect(() => {
		const host = containerEl;
		if (!host) return;
		ctx = canvas.getContext('2d');
		if (!ctx) return;

		const reducedMotion = isPrefersReducedMotion();
		const resizeObserver = new ResizeObserver(() => {
			readPrimaryRgb();
			resize(host);
			if (reducedMotion) paintStatic();
		});
		resizeObserver.observe(host);

		const onThemeChange = () => {
			readPrimaryRgb();
			if (reducedMotion) paintStatic();
		};
		document.addEventListener('themechange', onThemeChange);

		if (reducedMotion) {
			return () => {
				resizeObserver.disconnect();
				document.removeEventListener('themechange', onThemeChange);
			};
		}

		// Painting pauses while the host is off screen; 50px of margin resumes it before it shows.
		const visibilityObserver = new IntersectionObserver(
			(entries) => {
				isVisible = entries[0].isIntersecting;
			},
			{ rootMargin: '50px' },
		);
		visibilityObserver.observe(host);
		subscribe(subscriptionId, animate);

		host.addEventListener('mousemove', onMouseMove);
		host.addEventListener('mouseleave', onMouseLeave);
		host.addEventListener('touchmove', onTouchMove, { passive: true });
		host.addEventListener('click', onTap);

		return () => {
			unsubscribe(subscriptionId);
			resizeObserver.disconnect();
			visibilityObserver.disconnect();
			host.removeEventListener('mousemove', onMouseMove);
			host.removeEventListener('mouseleave', onMouseLeave);
			host.removeEventListener('touchmove', onTouchMove);
			host.removeEventListener('click', onTap);
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

	/* The dark board's 6%/2% cast disappears on paper; light mode lifts it to read the same. */
	:global([data-theme='light']) .manifesto__warm-glow {
		background: radial-gradient(
			ellipse,
			color-mix(in srgb, var(--glow) 16%, transparent) 0%,
			color-mix(in srgb, var(--accent) 8%, transparent) 30%,
			transparent 60%
		);
	}

	:global(.manifesto__ripple),
	:global(.manifesto__ripple-inner) {
		position: absolute;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: calc(var(--z-content) + 3);
	}
	:global(.manifesto__ripple) {
		border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
		animation: ripple-expand 1.2s ease-out forwards;
	}
	:global(.manifesto__ripple-inner) {
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		animation: ripple-inner 0.8s ease-out forwards;
	}
	@keyframes ripple-expand {
		0% {
			width: 0;
			height: 0;
			opacity: 0.6;
		}
		100% {
			width: 200px;
			height: 200px;
			opacity: 0;
		}
	}
	@keyframes ripple-inner {
		0% {
			width: 0;
			height: 0;
			opacity: 0.8;
		}
		100% {
			width: 100px;
			height: 100px;
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.manifesto__ripple),
		:global(.manifesto__ripple-inner) {
			display: none;
		}
	}
</style>
