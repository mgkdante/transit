import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import MapMotionControl from './MapMotionControl.svelte';
import { copy } from './map.copy';
import { motionMode } from '$lib/stores';

afterEach(() => {
	cleanup();
});

beforeEach(() => {
	localStorage.clear();
	motionMode.set('raw');
});

describe('MapMotionControl', () => {
	it('renders a real role="switch", unchecked (RAW) by default', () => {
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		const sw = screen.getByTestId('map-motion-switch');
		expect(sw).toHaveAttribute('role', 'switch');
		expect(sw).toHaveAttribute('aria-checked', 'false');
		expect(sw).toHaveTextContent(copy.en.motion.raw);
		expect(screen.getByText(copy.en.motion.hintRaw)).toBeInTheDocument();
	});

	it('flips to estimated display on click and tracks the store', async () => {
		const { rerender } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		const sw = screen.getByTestId('map-motion-switch');

		sw.click();
		expect(motionMode.current).toBe('smooth');
		await rerender({ locale: 'en', copy: copy.en });
		const checked = screen.getByTestId('map-motion-switch');
		expect(checked).toHaveAttribute('aria-checked', 'true');
		expect(checked).toHaveTextContent(copy.en.motion.smooth);
		expect(screen.getByText(copy.en.motion.hintSmooth)).toBeInTheDocument();
	});

	it('keeps the switch name stable while aria-checked carries state in both locales', async () => {
		const { rerender } = render(MapMotionControl, { locale: 'en', copy: copy.en });
		expect(screen.getByRole('switch', { name: copy.en.motion.toSmooth })).toHaveAttribute(
			'aria-checked',
			'false',
		);
		motionMode.set('smooth');
		await rerender({ locale: 'en', copy: copy.en });
		expect(screen.getByRole('switch', { name: copy.en.motion.toSmooth })).toHaveAttribute(
			'aria-checked',
			'true',
		);

		await rerender({ locale: 'fr', copy: copy.fr });
		expect(screen.getByRole('switch', { name: copy.fr.motion.toSmooth })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it('deep-links the method to the /metrics live-positions explainer (locale-aware)', () => {
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
		render(MapMotionControl, { locale: 'en', copy: copy.en });
		expect(screen.getByTestId('map-motion')).not.toHaveAttribute('data-variant');
	});

	it('COLLAPSED renders the motion icon badge above a round toggle (no hint, no link) that still toggles', async () => {
		const { rerender } = render(MapMotionControl, {
			locale: 'en',
			copy: copy.en,
			collapsed: true,
		});
		const stack = screen.getByTestId('map-motion');
		expect(stack).toHaveAttribute('data-collapsed', 'true');
		expect(stack.children).toHaveLength(2);
		const badge = stack.querySelector('.map-motion-badge');
		expect(badge).not.toBeNull();
		expect(badge!.querySelector('svg')).not.toBeNull();
		const sw = screen.getByTestId('map-motion-switch');
		expect(sw).toHaveAttribute('role', 'switch');
		expect(sw).toHaveClass('map-motion-round');
		expect(sw).toHaveAttribute('aria-checked', 'false');
		expect(sw).toHaveAttribute('aria-label', copy.en.motion.toSmooth);
		expect(screen.queryByText(copy.en.motion.hintRaw)).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: copy.en.motion.explain })).not.toBeInTheDocument();
		sw.click();
		expect(motionMode.current).toBe('smooth');
		await rerender({ locale: 'en', copy: copy.en, collapsed: true });
		expect(screen.getByTestId('map-motion-switch')).toHaveAttribute('aria-checked', 'true');
	});

	it('keeps both switch forms and the method link in the 44px touch-target inventory', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapMotionControl.svelte'),
			'utf8',
		);
		expect(source).toMatch(/\.map-motion-switch\s*\{[^}]*min-height:\s*44px/s);
		expect(source).toMatch(/\.map-motion-round\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s);
		expect(source).toMatch(
			/\.map-motion-explain\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s,
		);
	});
});
