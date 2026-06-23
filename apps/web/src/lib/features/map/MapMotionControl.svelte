<!--
  MapMotionControl — the on-map "how do we draw moving buses?" switch.

  An honest, tasteful control bound to the motionMode store. A real
  role="switch": OFF = RAW (the default — buses snap to their last reported
  position on every ~30s feed, NO estimation between reports), ON = SMOOTH
  ("almost real-time" — between reports each bus glides FORWARD along its route
  at its last reported speed, a bounded, decaying estimate). The switch reflects
  the store (raw by default); pressing it flips + persists the choice. A short
  hint names which truth you are looking at, and a "How this works" link
  deep-links into the /metrics live-positions explainer.

  Layout: the EXPANDED form is a 4-ROW VERTICAL STACK (label, switch, hint, link),
  each on its own full-width row — a display:grid single column that can never
  reflow horizontally. It lives at the TOP of the unified Controls panel (the
  same panel on desktop and mobile), borrowing that panel's card surface.

  When the desktop Controls panel is COLLAPSED (the narrow icon-only rail), the
  control shrinks to a SINGLE compact square button (filled = Smooth/ON, outline =
  Raw/OFF) sized + centred to match the collapsed filter chips. The parent passes
  `collapsed` down (MapFilters → motionHeader → here); the drawer never collapses,
  so mobile always shows the 4-row stack. a11y: a real <button role="switch"> with
  aria-checked + a bilingual aria-label in both forms.
-->
<script lang="ts">
	import { motionMode } from '$lib/stores';
	import { localizeHref, type Locale } from '$lib/i18n';
	import type { MapCopy } from './map.copy';

	interface Props {
		locale: Locale;
		copy: MapCopy;
		/**
		 * When true the control renders its COLLAPSED form: a single compact square
		 * toggle (filled = Smooth, outline = Raw), sized to the collapsed rail's chips.
		 * Passed down from MapFilters' `panelOpen === false` rail. Defaults to the full
		 * 4-row stack (the drawer + the expanded desktop panel never collapse).
		 */
		collapsed?: boolean;
	}

	let { locale, copy: t, collapsed = false }: Props = $props();

	const smooth = $derived(motionMode.isSmooth);
	// Deep-link straight to the live-positions explainer section on /metrics,
	// locale-prefixed off the passed-in locale (FR → /fr/metrics#live-positions).
	const explainHref = $derived(`${localizeHref('/metrics', locale)}#live-positions`);
</script>

<div class="map-motion" data-testid="map-motion" data-collapsed={collapsed}>
	{#if collapsed}
		<!-- Collapsed rail: ONE compact square that still toggles. Filled = Smooth/ON,
		     outline = Raw/OFF — the same affordance as the icon-only filter chips. -->
		<button
			type="button"
			class="map-motion-square"
			role="switch"
			aria-checked={smooth}
			aria-label={smooth ? t.motion.toRaw : t.motion.toSmooth}
			data-testid="map-motion-switch"
			onclick={() => motionMode.toggle()}
		>
			<span class="map-motion-square-fill" aria-hidden="true"></span>
		</button>
	{:else}
		<!-- Row 1: the label. -->
		<span class="map-motion-label" id="map-motion-label">{t.motion.label}</span>
		<!-- Row 2: the toggle switch (track/thumb + state name). -->
		<button
			type="button"
			class="map-motion-switch"
			role="switch"
			aria-checked={smooth}
			aria-labelledby="map-motion-label"
			aria-label={smooth ? t.motion.toRaw : t.motion.toSmooth}
			data-testid="map-motion-switch"
			onclick={() => motionMode.toggle()}
		>
			<span class="map-motion-track" aria-hidden="true">
				<span class="map-motion-thumb"></span>
			</span>
			<span class="map-motion-state">{smooth ? t.motion.smooth : t.motion.raw}</span>
		</button>
		<!-- Row 3: the hint. -->
		<span class="map-motion-hint">{smooth ? t.motion.hintSmooth : t.motion.hintRaw}</span>
		<!-- Row 4: the "How this works" deep link. -->
		<a class="map-motion-explain" href={explainHref}>{t.motion.explain}</a>
	{/if}
</div>

<style>
	/* The 4-row vertical stack: label / switch / hint / link, each on its OWN row at
	   full container width. A single-column grid — it sits statically in normal flow
	   inside the unified Controls panel (the same panel on desktop and mobile). No
	   card chrome, no fixed width: it borrows the surrounding panel's surface, and
	   the single column means it can never reflow horizontally. */
	.map-motion {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.4rem;
		/* LAW: the motion toggle is sized to its CONTENT, wide enough for the FR
		   "Presque en temps réel" on one line, NOT 100% of the parent panel. The cap
		   keeps the longest hint from stretching the control to an awkward width. */
		width: max-content;
		max-width: 13.5rem;
		justify-self: start;
	}
	/* Collapsed rail: center the single square in the narrow rail, matching the
	   collapsed filter chips' centred alignment. */
	.map-motion[data-collapsed='true'] {
		gap: 0;
		justify-items: center;
	}
	.map-motion-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* The switch itself — a real role="switch" button: a sliding track/thumb pair
	   (the on/off affordance) plus the current state name. Calm at rest; lights to
	   --primary when SMOOTH (estimated) is engaged so the estimate reads as a clear,
	   opted-in state and RAW reads as the calm default. Justified to the row start so
	   it owns its own full-width row without stretching the pill. */
	.map-motion-switch {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
		padding: 0.25rem 0.6rem 0.25rem 0.35rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color var(--duration-fast, 150ms) var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1)),
			background-color var(--duration-fast, 150ms) var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1)),
			border-color var(--duration-fast, 150ms) var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1));
	}
	.map-motion-switch:hover,
	.map-motion-switch:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
		outline: none;
	}
	.map-motion-switch:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.map-motion-switch[aria-checked='true'] {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 50%, var(--border) 50%);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
	}
	.map-motion-track {
		position: relative;
		flex: none;
		width: 1.85rem;
		height: 1.05rem;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--border) 70%, transparent);
		transition: background-color var(--duration-fast, 150ms)
			var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1));
	}
	.map-motion-switch[aria-checked='true'] .map-motion-track {
		background: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.map-motion-thumb {
		position: absolute;
		top: 50%;
		left: 0.15rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--card);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 30%, transparent);
		transform: translate(0, -50%);
		transition: transform var(--duration-fast, 150ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}
	.map-motion-switch[aria-checked='true'] .map-motion-thumb {
		transform: translate(0.8rem, -50%);
	}
	.map-motion-state {
		white-space: nowrap;
	}
	.map-motion-hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.map-motion-explain {
		justify-self: start;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-fast, 150ms) var(--ease-default, ease);
	}
	.map-motion-explain:hover,
	.map-motion-explain:focus-visible {
		text-decoration: underline;
	}
	.map-motion-explain:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* Collapsed square — a single ~2rem toggle that matches the collapsed filter
	   chips' size + centred placement. OUTLINE (non-filled) = Raw/OFF, the calm
	   default; FILLED with --primary = Smooth/ON, the opted-in estimate. */
	.map-motion-square {
		display: inline-grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background-color var(--duration-fast, 150ms) var(--ease-default, ease),
			border-color var(--duration-fast, 150ms) var(--ease-default, ease);
	}
	.map-motion-square:hover,
	.map-motion-square:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
		outline: none;
	}
	.map-motion-square:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.map-motion-square[aria-checked='true'] {
		background: color-mix(in srgb, var(--primary) 16%, var(--muted) 84%);
		border-color: color-mix(in srgb, var(--primary) 55%, var(--border) 45%);
	}
	/* The inner glyph: an outline square when OFF (Raw), a FILLED --primary square
	   when ON (Smooth) — the literal "filled vs non-filled square" affordance. */
	.map-motion-square-fill {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 2px;
		background: transparent;
		border: 1.5px solid var(--muted-foreground);
		transition:
			background-color var(--duration-fast, 150ms) var(--ease-default, ease),
			border-color var(--duration-fast, 150ms) var(--ease-default, ease);
	}
	.map-motion-square[aria-checked='true'] .map-motion-square-fill {
		background: var(--primary);
		border-color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.map-motion-track,
		.map-motion-thumb,
		.map-motion-switch,
		.map-motion-square,
		.map-motion-square-fill,
		.map-motion-explain {
			transition: none;
		}
	}
</style>
