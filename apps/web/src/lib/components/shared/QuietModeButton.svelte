<!--
  QuietModeButton — the shared FOCUS switch + REMEMBER pin pair (P5-R R3).

  Ported from yesid.dev's shared/QuietModeButton and rewired to transit's Locale
  idiom + the site-wide quietModeStore (operator ruling 2026-07-10: FOCUS is
  default-open + focus-to-close with ONE site-wide preference). The visual
  grammar is the transit port that previously lived inline on /metrics: the
  broadcast-arcs FOCUS switch (arcs fall silent + the core lamp lights when
  engaged) and the wayfinding-pin REMEMBER switch. Both are role="switch" whose
  accessible NAME is the stable visible word (Focus / Remember — WCAG 2.5.3);
  aria-checked carries the state and the action phrase rides `title` only.
  --primary lights ONLY the engaged state (interactive accent).

  Consumers (/metrics, /status) render this in their Masthead meta row and read
  the same store's close/open signals for their cards + ToC.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, type Locale } from '$lib/i18n';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

	let { class: className = '' }: { class?: string } = $props();

	interface QuietCopy {
		readonly label: string;
		readonly enable: string;
		readonly disable: string;
		readonly rememberLabel: string;
		readonly remember: string;
		readonly forget: string;
	}
	const COPY: Record<Locale, QuietCopy> = {
		fr: {
			label: 'Lecture',
			enable: 'Activer le mode lecture',
			disable: 'Quitter le mode lecture',
			rememberLabel: 'Mémoriser',
			remember: 'Mémoriser le mode lecture pour les prochaines visites',
			forget: 'Oublier le mode lecture (cette session seulement)',
		},
		en: {
			label: 'Focus',
			enable: 'Enter focus reading',
			disable: 'Exit focus reading',
			rememberLabel: 'Remember',
			remember: 'Remember focus reading on future visits',
			forget: 'Forget focus reading (this session only)',
		},
	};
	const locale: Locale = getLocale();
	const t = COPY[locale];

	const enabled = $derived(quietModeStore.enabled);
	const remembered = $derived(quietModeStore.remembered);

	onMount(() => quietModeStore.init());
</script>

<div class="quiet-mode-controls {className}" data-testid="quiet-mode-controls">
	<!-- role=switch name law (R3a review, WCAG 2.5.3): the visible word IS the
	     accessible name and stays STABLE; aria-checked alone carries the state.
	     The flipping action phrase rides `title` (a description, never the name). -->
	<button
		type="button"
		class="quiet-mode-toggle quiet-mode-toggle--switch tap-press"
		role="switch"
		aria-checked={enabled}
		title={enabled ? t.disable : t.enable}
		data-testid="quiet-mode-toggle"
		onclick={() => quietModeStore.toggle()}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<!-- broadcast arcs: the signal announces; they fall silent when FOCUS engages -->
			<path class="q-wave" d="M8.4 8.4a5 5 0 0 0 0 7.2" />
			<path class="q-wave" d="M15.6 8.4a5 5 0 0 1 0 7.2" />
			<path class="q-wave q-wave--far" d="M5.7 5.7a8.9 8.9 0 0 0 0 12.6" />
			<path class="q-wave q-wave--far" d="M18.3 5.7a8.9 8.9 0 0 1 0 12.6" />
			<!-- signal core: lights up to mark the quiet zone -->
			<circle class="q-core" cx="12" cy="12" r="2.3" />
		</svg>
		<span>{t.label}</span>
	</button>

	<!-- The REMEMBER pin: pins the FOCUS preference across visits (one site-wide
	     key). Independent of the FOCUS state itself. -->
	<button
		type="button"
		class="quiet-mode-toggle quiet-mode-toggle--remember tap-press"
		role="switch"
		aria-checked={remembered}
		title={remembered ? t.forget : t.remember}
		data-testid="quiet-mode-remember"
		onclick={() => (remembered ? quietModeStore.forgetDefault() : quietModeStore.rememberCurrent())}
	>
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path class="r-pin" d="M12 17v4" />
			<path class="r-pin" d="M9 3h6l-1 6 3 3v1H7v-1l3-3-1-6z" />
		</svg>
		<span>{t.rememberLabel}</span>
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
		font-family: var(--font-mono);
		font-size: var(--text-control);
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}
	.quiet-mode-toggle--switch {
		padding-inline: 0.875rem 1rem;
	}
	.quiet-mode-toggle--remember {
		padding-inline: 0.75rem 0.875rem;
	}

	.quiet-mode-toggle:hover,
	.quiet-mode-toggle:focus-visible,
	.quiet-mode-toggle[aria-checked='true'] {
		border-color: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 7%, var(--background));
	}
	.quiet-mode-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}

	/* Flat line-art strokes; the engaged state lights --primary with the soft
	   signal-lens glow (glow on CHROME, never on text). */
	.q-wave,
	.q-core,
	.r-pin {
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

	/* FOCUS engaged: the broadcast falls silent (arcs fade) and the core lights. */
	.quiet-mode-toggle[aria-checked='true'] .q-wave {
		opacity: 0;
	}
	.quiet-mode-toggle--switch[aria-checked='true'] .q-core {
		fill: var(--primary);
		stroke: var(--primary);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--glow) 60%, transparent));
	}

	/* REMEMBER engaged: the pin fills solid. */
	.quiet-mode-toggle--remember[aria-checked='true'] .r-pin {
		fill: var(--primary);
		stroke: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.quiet-mode-toggle,
		.q-wave,
		.q-core,
		.r-pin {
			transition: none;
		}
	}
</style>
