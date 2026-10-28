<!--
  Language signpost: one pennant board per locale on a pole, the current one filled. Each click
  links to the next locale. Renders nothing with fewer than two locales.
-->
<script lang="ts" module>
	import type { OnNavigate } from './navigation.js';

	export interface LanguageToggleProps {
		locale: string;
		locales: readonly string[];
		/** The current page in `locale`. */
		href: (locale: string) => string;
		/** Names the control; the current language's own name follows it. */
		label: string;
		/** Each language's name in that language, keyed by locale. */
		names?: Readonly<Record<string, string>>;
		/** Keeps scroll and page state across the switch, then resets focus like a normal navigation. Needs `onNavigate`. */
		preserveState?: boolean;
		/** Loads the target page with a full document request. */
		reload?: boolean;
		onNavigate?: OnNavigate;
		class?: string;
	}

	const NAMES: Readonly<Record<string, string>> = { en: 'English', fr: 'Français', es: 'Español' };
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';
	import { resetFocusAfterNavigation } from './navigation.js';

	let {
		locale,
		locales,
		href,
		label,
		names = NAMES,
		preserveState = false,
		reload = false,
		onNavigate,
		class: className,
	}: LanguageToggleProps = $props();

	const next = $derived(locales[(Math.max(0, locales.indexOf(locale)) + 1) % locales.length]);
	const nextHref = $derived(href(next));
	const name = $derived(names[locale] ?? locale);

	// The link keeps native routing and preloading; only its focus reset is restored. Registered once, at init.
	// svelte-ignore state_referenced_locally
	onNavigate?.((navigation) => {
		if (navigation.type === 'link' && preserveState && navigation.to?.url.href === new URL(nextHref, location.href).href) {
			return resetFocusAfterNavigation();
		}
	});

	// Every board keeps the two-board geometry, so a third board grows the post rather than shrinking the letters.
	const SPAN = 18;
	const PLATE_H = 15;
	const FONT_SIZE = 15;
	const vbHeight = $derived(8 + SPAN * locales.length);
	const svgHeight = $derived(Math.round(((vbHeight * 36) / 44) * 10) / 10);

	const boards = $derived(
		locales.map((loc, k) => {
			const yTop = 4 + k * SPAN + (SPAN - PLATE_H) / 2;
			const mid = yTop + PLATE_H / 2;
			const right = k % 2 === 1;
			return {
				locale: loc,
				code: loc.slice(0, 2).toUpperCase(),
				path: right
					? `M30 ${yTop} H49 L54 ${mid} L49 ${yTop + PLATE_H} H30 Z`
					: `M26 ${yTop} H7 L2 ${mid} L7 ${yTop + PLATE_H} H26 Z`,
				ruleY: yTop + PLATE_H + 1.4,
				ruleX1: right ? 31 : 8,
				ruleX2: right ? 47.5 : 25,
				tx: right ? 39 : 16,
				ty: mid + FONT_SIZE * 0.36,
				active: loc === locale,
				delay: k * 60,
			};
		}),
	);
</script>

{#if locales.length >= 2}
	<a
		href={nextHref}
		data-testid="language-toggle"
		data-slot="language-toggle"
		data-sveltekit-preload-data="hover"
		data-sveltekit-reset={preserveState ? 'false' : undefined}
		data-sveltekit-reload={reload || undefined}
		class={cn('lang-post tap-press', className)}
		aria-label="{label}: {name}"
		title={name}
		style="--vb-h: {vbHeight}"
	>
		<svg viewBox="0 0 56 {vbHeight}" width="46" height={svgHeight} aria-hidden="true">
			<line class="pole" x1="28" y1="6" x2="28" y2={vbHeight - 3} stroke-linecap="round"></line>
			<circle class="finial" cx="28" cy="4" r="2"></circle>
			{#key locale}
				<g class="boards">
					{#each boards as b (b.locale)}
						<g class="board" class:active={b.active} style="--d:{b.delay}ms; transform-origin:28px {b.ty - 3.8}px;">
							<path class="plate" d={b.path}></path>
							{#if b.active}
								<line class="rule" x1={b.ruleX1} y1={b.ruleY} x2={b.ruleX2} y2={b.ruleY}></line>
							{/if}
							<text x={b.tx} y={b.ty} font-size={FONT_SIZE}>{b.code}</text>
						</g>
					{/each}
				</g>
			{/key}
		</svg>
		<span class="sr-only" aria-live="polite">{name}</span>
	</a>
{/if}

<style>
	/* Fixed 44px height with no vertical padding: a three-board post bleeds into the pill's padding instead of growing it. */
	.lang-post {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 44px;
		min-width: 44px;
		padding-block: 0;
		padding-inline: 4px;
		color: var(--secondary-foreground);
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.lang-post:hover {
		color: var(--foreground);
	}
	.lang-post:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.pole {
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.finial {
		fill: currentColor;
	}
	.plate {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1.25;
		stroke-linejoin: round;
		transition: fill var(--duration-normal) var(--ease-default);
	}
	.board text {
		font-family: var(--font-mono);
		font-size: 15px;
		font-weight: 700;
		letter-spacing: 0.01em;
		fill: currentColor;
		text-anchor: middle;
	}
	.board.active .plate {
		fill: var(--primary);
		stroke: var(--primary);
	}
	.board.active text {
		fill: var(--primary-foreground);
	}
	.rule {
		stroke: var(--border-rule-accent);
		stroke-width: 1.4;
		stroke-linecap: round;
	}

	/* A gentle swing on switch, pivoting on the post's vertical centre. */
	.boards {
		transform-origin: 28px calc(0.5px * var(--vb-h, 44));
		animation: post-swing 460ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
	}
	.board {
		animation: board-settle 520ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
		animation-delay: var(--d, 0ms);
	}
	@keyframes post-swing {
		0% { transform: rotate(-6deg); }
		60% { transform: rotate(2deg); }
		100% { transform: rotate(0deg); }
	}
	@keyframes board-settle {
		0% { transform: rotate(-4deg); opacity: 0.7; }
		60% { transform: rotate(1.4deg); opacity: 1; }
		100% { transform: rotate(0deg); opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.lang-post,
		.plate {
			transition: none;
		}
		.boards,
		.board {
			animation: none;
		}
	}

	/* Phones shrink the drawing, not the letters' proportions; heights follow the post's viewBox. */
	@media (max-width: 479px) {
		.lang-post {
			min-width: 38px;
			padding-inline: 3px;
		}
		.lang-post svg {
			width: 34px;
			height: calc(27px * var(--vb-h, 44) / 44);
		}
	}
	@media (max-width: 359px) {
		.lang-post {
			min-width: 26px;
			padding-inline: 2px;
		}
		.lang-post svg {
			width: 22px;
			height: calc(17px * var(--vb-h, 44) / 44);
		}
	}
</style>
