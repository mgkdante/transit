<!--
  MapMotionControl — the on-map "how do we draw moving buses?" switch.

  An honest, tasteful floating control bound to the motionMode store. A real
  role="switch": OFF = RAW (the default — buses snap to their last reported
  position on every ~30s feed, NO estimation between reports), ON = SMOOTH
  ("almost real-time" — between reports each bus glides FORWARD along its route
  at its last reported speed, a bounded, decaying estimate). The switch reflects
  the store (raw by default); pressing it flips + persists the choice. A short
  inline hint names which truth you are looking at, and a "How this works" link
  deep-links into the /metrics live-positions explainer.

  Placement + styling mirror MapNearMeControl / MapFreshness as a `.map-overlay`
  floating chip (card surface + hairline + blur, right-offset that tracks the
  detail panel). a11y: a real <button role="switch"> with aria-checked + a
  bilingual aria-label, plus a visible text label.
-->
<script lang="ts">
	import { motionMode } from '$lib/stores';
	import { localizeHref, type Locale } from '$lib/i18n';
	import type { MapCopy } from './map.copy';

	interface Props {
		locale: Locale;
		copy: MapCopy;
		/**
		 * "floating" (default) = the absolute-positioned `.map-overlay` chip on the
		 * canvas, with a STABLE fixed width sized to the wider state so toggling
		 * raw⇄smooth never reflows. "inline" = the same row+switch+hint content laid
		 * out statically at full container width (for the mobile filter sheet).
		 */
		variant?: 'floating' | 'inline';
	}

	let { locale, copy: t, variant = 'floating' }: Props = $props();

	const smooth = $derived(motionMode.isSmooth);
	// Deep-link straight to the live-positions explainer section on /metrics,
	// locale-prefixed off the passed-in locale (FR → /fr/metrics#live-positions).
	const explainHref = $derived(`${localizeHref('/metrics', locale)}#live-positions`);
</script>

<div class="map-motion" data-variant={variant} data-testid="map-motion">
	<div class="map-motion-row">
		<span class="map-motion-label" id="map-motion-label">{t.motion.label}</span>
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
	</div>
	<p class="map-motion-hint">
		<span>{smooth ? t.motion.hintSmooth : t.motion.hintRaw}</span>
		<a class="map-motion-explain" href={explainHref}>{t.motion.explain}</a>
	</p>
</div>

<style>
	/* Shared inner layout for both variants — the row+switch+hint stack. Geometry
	   (position / width / card chrome) is gated per-variant below. */
	.map-motion {
		display: grid;
		gap: 0.3rem;
	}

	/* FLOATING chip, bottom-left of the canvas — clear of the bottom-right near-me
	   control and the right detail panel (whose width the offset tracks). Same card
	   surface + hairline + blur language as the rest of the map chrome.

	   STABLE GEOMETRY: a FIXED width sized to the WIDER state so toggling raw⇄smooth
	   ("Raw"/"Brut" vs "Almost real-time"/"Presque en temps réel") never jumps the
	   footprint. The width fits the longest EN + FR state in the switch row AND the
	   longest hint line ("Mouvement estimé entre les relevés" + "Comment ça marche")
	   on a single hint line; the hint reserves its space via min-height so only the
	   text/active-state swaps, never the geometry. */
	.map-motion[data-variant='floating'] {
		position: absolute;
		z-index: 10;
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
		bottom: 1.15rem;
		width: 20rem;
		max-width: calc(100% - var(--app-left-rail-offset, 0rem) - 2rem);
		padding: 0.5rem 0.7rem 0.55rem;
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px) saturate(1.1);
	}

	/* INLINE variant — same content, NOT absolute-positioned. Sits statically in
	   normal flow at full container width (the mobile filter sheet). No card chrome,
	   no fixed width, no offsets: it borrows the surrounding container's surface. */
	.map-motion[data-variant='inline'] {
		position: static;
		width: 100%;
		max-width: none;
	}
	.map-motion-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
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
	   opted-in state and RAW reads as the calm default. */
	.map-motion-switch {
		display: inline-flex;
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
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.1rem 0.45rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* Reserve the hint's vertical space in the floating chip so swapping the shorter
	   raw hint for the longer smooth one (or EN⇄FR) never changes the card height —
	   only the text content swaps, never the geometry. */
	.map-motion[data-variant='floating'] .map-motion-hint {
		min-height: 1.4em;
	}
	.map-motion-explain {
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

	@media (prefers-reduced-motion: reduce) {
		.map-motion-track,
		.map-motion-thumb,
		.map-motion-switch,
		.map-motion-explain {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-motion[data-variant='floating'] {
			left: 0.75rem;
			right: 0.75rem;
			bottom: calc(3.35rem + env(safe-area-inset-bottom, 0px));
			width: auto;
			max-width: calc(100% - 1.5rem);
		}
	}
</style>
