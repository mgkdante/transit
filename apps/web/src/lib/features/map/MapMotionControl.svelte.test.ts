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
});
