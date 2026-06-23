// MapMotionControl — the on-map raw/smooth motion-mode switch, DOM gate.
//
// A real role="switch" bound to the motionMode store: RAW (the default — measured
// positions only) ⇄ SMOOTH ("almost real-time" — estimated forward projection).
// The inline hint names the active truth; the "How this works" link deep-links to
// the /metrics live-positions explainer (locale-prefixed). We assert the switch
// semantics, the store binding, the bilingual copy, and the deep-link target.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import MapMotionControl from './MapMotionControl.svelte';
import { copy } from './map.copy';
import { motionMode } from '$lib/stores';

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	// The store persists to localStorage; reset to the RAW default each test.
	localStorage.clear();
	motionMode.set('raw');
});

describe('MapMotionControl', () => {
	it('renders a real role="switch", unchecked (RAW) by default', () => {
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		const sw = screen.getByTestId('map-motion-switch');
		expect(sw).toHaveAttribute('role', 'switch');
		expect(sw).toHaveAttribute('aria-checked', 'false');
		// RAW state name + measured-only hint are shown.
		expect(sw).toHaveTextContent(copy.en.motion.raw);
		expect(screen.getByText(copy.en.motion.hintRaw)).toBeInTheDocument();
	});

	it('flips to SMOOTH (almost real-time) on click and tracks the store', async () => {
		const { rerender } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		const sw = screen.getByTestId('map-motion-switch');

		sw.click();
		expect(motionMode.current).toBe('smooth');

		// Re-render so the $derived reads the new store value, then assert the
		// checked state + the estimated-motion hint + the smooth state name.
		await rerender({ locale: 'en', copy: copy.en });
		const checked = screen.getByTestId('map-motion-switch');
		expect(checked).toHaveAttribute('aria-checked', 'true');
		expect(checked).toHaveTextContent(copy.en.motion.smooth);
		expect(screen.getByText(copy.en.motion.hintSmooth)).toBeInTheDocument();
	});

	it('aria-label names the OPPOSITE action (the press performs the switch)', async () => {
		const { rerender } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		// RAW → label invites going to smooth.
		expect(screen.getByTestId('map-motion-switch')).toHaveAttribute(
			'aria-label',
			copy.en.motion.toSmooth,
		);
		motionMode.set('smooth');
		await rerender({ locale: 'en', copy: copy.en });
		// SMOOTH → label invites going back to raw.
		expect(screen.getByTestId('map-motion-switch')).toHaveAttribute(
			'aria-label',
			copy.en.motion.toRaw,
		);
	});

	it('deep-links "How this works" to the /metrics live-positions explainer (locale-aware)', () => {
		const { unmount } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		expect(screen.getByRole('link', { name: copy.en.motion.explain })).toHaveAttribute(
			'href',
			'/metrics#live-positions',
		);
		unmount();

		render(MapMotionControl, { locale: 'fr', copy: copy.fr });
		expect(screen.getByRole('link', { name: copy.fr.motion.explain })).toHaveAttribute(
			'href',
			'/fr/metrics#live-positions',
		);
	});

	it('renders the bilingual labels (EN default + FR mirror)', () => {
		const { unmount } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		expect(screen.getByText(copy.en.motion.label)).toBeInTheDocument();
		unmount();

		render(MapMotionControl, { locale: 'fr', copy: copy.fr });
		expect(screen.getByText(copy.fr.motion.label)).toBeInTheDocument();
		expect(screen.getByText(copy.fr.motion.raw)).toBeInTheDocument();
	});

	it('renders a single inline layout (no variant prop, no floating chip)', () => {
		// The control is now a single inline layout that lives at the top of the
		// unified Controls panel (the same panel on desktop and mobile). There is no
		// `variant` prop and no data-variant attribute — the floating chip is gone, so
		// nothing reflows when the toggle swaps raw/smooth.
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		expect(screen.getByTestId('map-motion')).not.toHaveAttribute('data-variant');
	});

	it('EXPANDED is a 4-row vertical stack in order: label, switch, hint, link', () => {
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		const stack = screen.getByTestId('map-motion');
		expect(stack).toHaveAttribute('data-collapsed', 'false');
		// The four rows are the direct children of the grid, in this exact order.
		const rows = Array.from(stack.children);
		expect(rows).toHaveLength(4);
		// Row 1 — the "Motion" label.
		expect(rows[0]).toHaveTextContent(copy.en.motion.label);
		// Row 2 — the role="switch" toggle.
		expect(rows[1]).toBe(screen.getByTestId('map-motion-switch'));
		expect(rows[1]).toHaveAttribute('role', 'switch');
		// Row 3 — the active-truth hint (RAW default).
		expect(rows[2]).toHaveTextContent(copy.en.motion.hintRaw);
		// Row 4 — the "How this works" deep link.
		expect(rows[3]).toBe(screen.getByRole('link', { name: copy.en.motion.explain }));
	});

	it('COLLAPSED renders the motion icon badge above a round toggle (no hint, no link) that still toggles', async () => {
		const { rerender } = render(MapMotionControl, {
			locale: 'en',
			copy: copy.en,
			collapsed: true,
		});
		const stack = screen.getByTestId('map-motion');
		expect(stack).toHaveAttribute('data-collapsed', 'true');
		// Two children: the motion icon BADGE (header) + the round toggle BELOW it.
		expect(stack.children).toHaveLength(2);
		// The icon badge (header) carries the motion glyph, matching the section badges.
		const badge = stack.querySelector('.map-motion-badge');
		expect(badge).not.toBeNull();
		expect(badge!.querySelector('svg')).not.toBeNull();
		const sw = screen.getByTestId('map-motion-switch');
		expect(sw).toHaveAttribute('role', 'switch');
		// The round collapsed form is the round class, not the old square.
		expect(sw).toHaveClass('map-motion-round');
		// Outline (non-filled) = RAW/OFF by default.
		expect(sw).toHaveAttribute('aria-checked', 'false');
		expect(sw).toHaveAttribute('aria-label', copy.en.motion.toSmooth);
		expect(screen.queryByText(copy.en.motion.hintRaw)).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: copy.en.motion.explain })).not.toBeInTheDocument();
		// Clicking the round switch still toggles the store; re-render shows the filled state.
		sw.click();
		expect(motionMode.current).toBe('smooth');
		await rerender({ locale: 'en', copy: copy.en, collapsed: true });
		expect(screen.getByTestId('map-motion-switch')).toHaveAttribute('aria-checked', 'true');
	});

	it('EXPANDED label row carries the motion badge icon next to the overline', () => {
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		const label = document.getElementById('map-motion-label');
		expect(label).not.toBeNull();
		// The overline keeps its text AND gains a small badge glyph (a Lucide svg),
		// mirroring how the filter sections badge their section labels.
		expect(label).toHaveTextContent(copy.en.motion.label);
		expect(label?.querySelector('svg')).not.toBeNull();
	});
});
