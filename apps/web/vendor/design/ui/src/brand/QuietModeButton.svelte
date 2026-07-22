<script lang="ts" module>
	export interface QuietModeButtonCopy {
		readonly collapse: string;
		readonly expand: string;
		readonly collapseTitle: string;
		readonly expandTitle: string;
		readonly remember: string;
		readonly forget: string;
	}

	export type QuietModeActiveEffect = 'none' | 'glow';

	export interface QuietModeButtonProps {
		copy: QuietModeButtonCopy;
		enabled: boolean;
		remembered: boolean;
		onToggle: () => void;
		onRememberToggle: () => void;
		activeEffect?: QuietModeActiveEffect;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let {
		copy,
		enabled,
		remembered,
		onToggle,
		onRememberToggle,
		activeEffect = 'none',
		class: className,
	}: QuietModeButtonProps = $props();

	const label = $derived(enabled ? copy.expand : copy.collapse);
	const title = $derived(enabled ? copy.expandTitle : copy.collapseTitle);
	const rememberLabel = $derived(remembered ? copy.forget : copy.remember);
</script>

<div
	class={cn(
		'quiet-mode-controls',
		activeEffect === 'glow' && 'quiet-mode-controls--glow',
		className,
	)}
	data-testid="quiet-mode-controls"
>
	<button
		type="button"
		class="quiet-mode-toggle quiet-mode-toggle--switch tap-press"
		data-collapsed={enabled}
		{title}
		data-testid="quiet-mode-toggle"
		onclick={onToggle}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path class="q-wave" d="M8.4 8.4a5 5 0 0 0 0 7.2" />
			<path class="q-wave" d="M15.6 8.4a5 5 0 0 1 0 7.2" />
			<path class="q-wave q-wave--far" d="M5.7 5.7a8.9 8.9 0 0 0 0 12.6" />
			<path class="q-wave q-wave--far" d="M18.3 5.7a8.9 8.9 0 0 1 0 12.6" />
			<circle class="q-core" cx="12" cy="12" r="2.3" />
		</svg>
		<span>{label}</span>
	</button>

	<button
		type="button"
		class="quiet-mode-toggle quiet-mode-toggle--remember tap-press"
		data-remembered={remembered}
		title={rememberLabel}
		data-testid="quiet-mode-remember"
		onclick={onRememberToggle}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path class="r-bookmark" d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.9L6 20V5.5a1 1 0 0 1 1-1z" />
		</svg>
		<span>{rememberLabel}</span>
	</button>
</div>

<style>
	.quiet-mode-controls {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.quiet-mode-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 44px;
		min-height: 44px;
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-md);
		background: var(--background);
		color: var(--secondary-foreground);
		box-shadow: inset 0 1px 0 var(--edge-highlight);
		cursor: pointer;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}

	.quiet-mode-toggle--switch {
		padding-inline: 0.875rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-control);
		letter-spacing: 0;
	}

	.quiet-mode-toggle--remember {
		padding-inline: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-control);
		letter-spacing: 0;
	}

	.quiet-mode-toggle:hover,
	.quiet-mode-toggle:focus-visible,
	.quiet-mode-toggle[data-collapsed='true'],
	.quiet-mode-toggle[data-remembered='true'] {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 7%, var(--background));
	}

	.quiet-mode-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}

	.q-wave,
	.q-core,
	.r-bookmark {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition:
			opacity var(--duration-normal) var(--ease-default),
			fill var(--duration-normal) var(--ease-default),
			stroke var(--duration-normal) var(--ease-default),
			filter var(--duration-normal) var(--ease-default);
	}

	.q-wave--far {
		opacity: 0.5;
	}

	.quiet-mode-toggle[data-collapsed='true'] .q-wave {
		opacity: 0;
	}

	.quiet-mode-toggle[data-collapsed='true'] .q-core {
		fill: var(--primary);
		stroke: var(--primary);
	}

	.quiet-mode-toggle[data-remembered='true'] .r-bookmark {
		fill: var(--primary);
		stroke: var(--primary);
	}

	.quiet-mode-controls--glow .quiet-mode-toggle[data-collapsed='true'] .q-core {
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent));
	}

	.quiet-mode-controls--glow .quiet-mode-toggle[data-remembered='true'] .r-bookmark {
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 55%, transparent));
	}

	@media (prefers-reduced-motion: reduce) {
		.quiet-mode-toggle,
		.q-wave,
		.q-core,
		.r-bookmark {
			transition: none;
		}
	}
</style>
