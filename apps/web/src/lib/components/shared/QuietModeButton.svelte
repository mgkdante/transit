<!--
  QuietModeButton — the shared two-button article control.

  Ported from yesid.dev's shared/QuietModeButton and rewired to Transit's Locale
  idiom + site-wide quietModeStore. The visible action labels flip with state, so
  both controls stay plain buttons. Consumers render this in their article header
  and forward the store's page-scoped close/open signals to participating cards.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

	let { class: className = '' }: { class?: string } = $props();

	interface QuietCopy {
		readonly collapse: string;
		readonly expand: string;
		readonly collapseTitle: string;
		readonly expandTitle: string;
		readonly remember: string;
		readonly forget: string;
	}
	const COPY: Record<Locale, QuietCopy> = {
		en: {
			collapse: 'Collapse all',
			expand: 'Expand all',
			collapseTitle: 'Collapse all sections on this page',
			expandTitle: 'Expand all sections on this page',
			remember: 'Always start collapsed',
			forget: "Don't start collapsed",
		},
		fr: {
			collapse: 'Tout replier',
			expand: 'Tout déplier',
			collapseTitle: 'Replier toutes les sections de la page',
			expandTitle: 'Déplier toutes les sections de la page',
			remember: 'Toujours replier',
			forget: 'Ne plus replier',
		},
	};
	const locale: Locale = getLocale();
	const t = COPY[locale];

	const enabled = $derived(quietModeStore.enabled);
	const remembered = $derived(quietModeStore.remembered);
	const label = $derived(enabled ? t.expand : t.collapse);
	const title = $derived(enabled ? t.expandTitle : t.collapseTitle);
	const rememberLabel = $derived(remembered ? t.forget : t.remember);

	onMount(() => quietModeStore.init());
</script>

<div class="quiet-mode-controls {className}" data-testid="quiet-mode-controls">
	<button
		type="button"
		class="quiet-mode-toggle quiet-mode-toggle--switch tap-press"
		data-collapsed={enabled}
		{title}
		data-testid="quiet-mode-toggle"
		onclick={() => quietModeStore.toggle()}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<!-- broadcast arcs: the signal announces; they fall silent when quiet engages -->
			<path class="q-wave" d="M8.4 8.4a5 5 0 0 0 0 7.2" />
			<path class="q-wave" d="M15.6 8.4a5 5 0 0 1 0 7.2" />
			<path class="q-wave q-wave--far" d="M5.7 5.7a8.9 8.9 0 0 0 0 12.6" />
			<path class="q-wave q-wave--far" d="M18.3 5.7a8.9 8.9 0 0 1 0 12.6" />
			<!-- signal core: lights up to mark the quiet zone -->
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
		onclick={() => (remembered ? quietModeStore.forgetDefault() : quietModeStore.rememberCurrent())}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<!-- wayfinding bookmark: fills solid when the preference is pinned -->
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

	/* Flat line-art in the ThemeToggle / LanguageToggle family: currentColor
	   strokes, and the active state lights --primary with a soft glow exactly
	   like the theme toggle's lit signal lens. */
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

	/* Collapsed ENGAGED: the broadcast falls silent (arcs fade) and the core lights. */
	.quiet-mode-toggle[data-collapsed='true'] .q-wave {
		opacity: 0;
	}
	.quiet-mode-toggle[data-collapsed='true'] .q-core {
		fill: var(--primary);
		stroke: var(--primary);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent));
	}

	/* Pinned: the bookmark fills solid --primary (the saved preference). */
	.quiet-mode-toggle[data-remembered='true'] .r-bookmark {
		fill: var(--primary);
		stroke: var(--primary);
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
