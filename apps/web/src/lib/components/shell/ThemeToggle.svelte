<!--
  ThemeToggle — the signal-lamp dark/light switch (line-art signal head; the lit
  lens fills --primary). Drives the global themeStore. Extracted from TopBar so
  it is reusable (footer / mobile menu) and testable in isolation.

  DOCTRINE: --primary lights the active lens as an interactive-state affordance
  (a control's on/off), never as a data mark.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { themeStore } from '$lib/stores';
	import type { Locale } from '$lib/i18n';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	const isDark = $derived(themeStore.isDark);
	const label = $derived(
		locale === 'fr'
			? isDark
				? 'Passer au thème clair'
				: 'Passer au thème sombre'
			: isDark
				? 'Switch to light theme'
				: 'Switch to dark theme',
	);
</script>

<button
	type="button"
	class={cn('theme-toggle tap-press', className)}
	role="switch"
	aria-checked={isDark}
	aria-label={label}
	onclick={() => themeStore.toggle()}
	data-slot="theme-toggle"
>
	<svg viewBox="0 0 20 28" width="13" height="18" aria-hidden="true">
		<rect
			x="3"
			y="2"
			width="14"
			height="24"
			rx="4"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
		/>
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
		height: 2.25rem;
		width: 2.25rem;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--secondary-foreground);
		border-radius: var(--radius-lg);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.theme-toggle:hover {
		color: var(--foreground);
		background: var(--muted);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
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
		filter: drop-shadow(0 0 3px color-mix(in srgb, var(--primary) 60%, transparent));
	}
	@media (prefers-reduced-motion: reduce) {
		.theme-toggle,
		.lens {
			transition: none;
		}
	}
</style>
