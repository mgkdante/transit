<!--
  Signal lamp: top lens lit = dark theme, bottom lens lit = light theme.
  The label names the control; `aria-checked` carries the state.
-->
<script lang="ts" module>
	export interface ThemeToggleProps {
		label: string;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';
	import { theme } from '../state/theme.svelte.js';

	let { label, class: className }: ThemeToggleProps = $props();

	const isDark = $derived(theme.isDark);
</script>

<button
	type="button"
	class={cn('theme-toggle tap-press', className)}
	role="switch"
	aria-checked={isDark}
	aria-label={label}
	data-testid="theme-toggle"
	data-slot="theme-toggle"
	onclick={() => theme.toggle()}
>
	<svg viewBox="0 0 20 28" width="14" height="20" aria-hidden="true">
		<rect x="3" y="2" width="14" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" />
		<line x1="10" y1="26" x2="10" y2="28" stroke="currentColor" stroke-width="1.5" />
		<circle class="lens" class:lit={isDark} cx="10" cy="9" r="3.5" />
		<circle class="lens" class:lit={!isDark} cx="10" cy="19" r="3.5" />
	</svg>
</button>

<style>
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		padding: 4px;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--secondary-foreground);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.theme-toggle:hover {
		color: var(--foreground);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.lens {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1.25;
		transition:
			fill var(--duration-normal) var(--ease-default),
			filter var(--duration-normal) var(--ease-default);
	}
	.lens.lit {
		fill: var(--primary);
		stroke: var(--primary);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent));
	}
	@media (prefers-reduced-motion: reduce) {
		.theme-toggle,
		.lens {
			transition: none;
		}
	}
</style>
