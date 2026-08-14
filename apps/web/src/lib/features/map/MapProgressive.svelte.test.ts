import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
	let reduced = false;
	const subscribers = new Set<(value: boolean) => void>();
	return {
		locale: 'en' as 'en' | 'fr',
		prefersReducedMotion: {
			subscribe(subscriber: (value: boolean) => void) {
				subscriber(reduced);
				subscribers.add(subscriber);
				return () => subscribers.delete(subscriber);
			},
		},
		setReduced(next: boolean) {
			reduced = next;
			for (const subscriber of subscribers) subscriber(next);
		},
	};
});

vi.mock('$lib/i18n', () => ({ getLocale: () => harness.locale }));
vi.mock('@yesid/motion/stores/reducedMotion', () => ({
	prefersReducedMotion: harness.prefersReducedMotion,
}));

type HeroModule = typeof import('./__fixtures__/MapProgressiveHeroStub.svelte');

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((next, fail) => {
		resolve = next;
		reject = fail;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	cleanup();
	harness.locale = 'en';
	harness.setReduced(false);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('MapProgressive deferred activation', () => {
	it('shows the pinned basemap generation date before activation in both locales', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const english = render(MapProgressive);
		expect(english.getByText('Basemap snapshot · Aug 12, 2026')).toBeVisible();
		cleanup();

		harness.locale = 'fr';
		const french = render(MapProgressive);
		expect(french.getByText('Fond de carte · 12 août 2026')).toBeVisible();
	});

	it('does not call the hero importer until the native activation button is clicked', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const importer = vi.fn(() => new Promise<never>(() => {}));
		const view = render(MapProgressive, { props: { importHero: importer } });

		await tick();
		expect(importer).not.toHaveBeenCalled();

		await fireEvent.click(view.getByRole('button', { name: 'Load live interactive map' }));
		expect(importer).toHaveBeenCalledOnce();
		expect(view.getByRole('status')).toHaveTextContent('Starting live map');
	});

	it.each(['Enter', ' '] as const)(
		'accepts the native %s keyboard-generated button click without a custom key handler',
		async (key) => {
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const importer = vi.fn(() => new Promise<never>(() => {}));
			const view = render(MapProgressive, { props: { importHero: importer } });
			const button = view.getByRole('button', { name: 'Load live interactive map' });

			button.focus();
			await fireEvent.keyDown(button, { key });
			await fireEvent.click(button, { detail: 0 });

			expect(button.tagName).toBe('BUTTON');
			expect(importer).toHaveBeenCalledOnce();
		},
	);

	it('keeps activation single-flight while the deferred hero chunk is pending', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const pending = deferred<HeroModule>();
		const importer = vi.fn(() => pending.promise);
		const view = render(MapProgressive, { props: { importHero: importer } });
		const button = view.getByRole('button', { name: 'Load live interactive map' });

		await Promise.all([fireEvent.click(button), fireEvent.click(button), fireEvent.click(button)]);

		expect(importer).toHaveBeenCalledOnce();
		expect(view.getByRole('button', { name: 'Load live interactive map' })).toHaveAttribute(
			'aria-disabled',
			'true',
		);
		expect(view.getByRole('status')).toHaveTextContent('Starting live map');
	});

	it('keeps keyboard focus during boot and hands it to the MapLibre canvas after first idle', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
		const view = render(MapProgressive, { props: { importHero: async () => fixture } });
		const wake = view.getByRole('button', { name: 'Load live interactive map' });

		wake.focus();
		await fireEvent.click(wake, { detail: 0 });
		expect(document.activeElement).toBe(wake);
		expect(wake).toHaveAttribute('aria-disabled', 'true');

		await view.findByTestId('map-progressive-hero-stub');
		await fireEvent.click(view.getByTestId('progressive-stub-ready'));
		expect(document.activeElement).toBe(wake);
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'true');

		await fireEvent.click(view.getByTestId('progressive-stub-idle'));
		await waitFor(() =>
			expect(document.activeElement).toBe(view.getByTestId('progressive-stub-map-canvas')),
		);
	});

	it('keeps the poster mounted and the live layer inert until first MapLibre idle', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const pending = deferred<HeroModule>();
		const view = render(MapProgressive, { props: { importHero: () => pending.promise } });

		await fireEvent.click(view.getByRole('button', { name: 'Load live interactive map' }));
		expect(view.queryByTestId('map-progressive-hero-stub')).toBeNull();
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'true');

		pending.resolve(await import('./__fixtures__/MapProgressiveHeroStub.svelte'));
		await waitFor(() => expect(view.getByTestId('map-progressive-hero-stub')).toBeInTheDocument());
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'true');

		await fireEvent.click(view.getByTestId('progressive-stub-ready'));
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'true');
		expect(view.getByTestId('map-progressive-live')).toHaveAttribute('aria-hidden', 'true');
		expect(view.getByTestId('map-progressive-live')).toHaveAttribute('inert');

		await fireEvent.click(view.getByTestId('progressive-stub-idle'));
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'false');
		expect(view.getByTestId('map-progressive-live')).not.toHaveAttribute('aria-hidden');
		expect(view.getByTestId('map-progressive-live')).not.toHaveAttribute('inert');
	});

	it('retries a rejected hero import without mounting or preloading it early', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
		const importer = vi
			.fn<() => Promise<HeroModule>>()
			.mockRejectedValueOnce(new Error('chunk unavailable'))
			.mockResolvedValueOnce(fixture);
		const view = render(MapProgressive, { props: { importHero: importer } });

		await fireEvent.click(view.getByRole('button', { name: 'Load live interactive map' }));
		expect(await view.findByRole('alert')).toHaveTextContent('Live map could not start');
		expect(view.queryByTestId('map-progressive-hero-stub')).toBeNull();

		await fireEvent.click(view.getByRole('button', { name: 'Try live map again' }));
		expect(await view.findByTestId('map-progressive-hero-stub')).toBeInTheDocument();
		expect(importer).toHaveBeenCalledTimes(2);
	});

	it('publishes distinct intent, ready, and first-idle DOM measurement seams', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
		const view = render(MapProgressive, { props: { importHero: async () => fixture } });
		const root = view.getByTestId('map-progressive');
		const intent = vi.fn();
		const ready = vi.fn();
		const idle = vi.fn();
		root.addEventListener('transit:map-intent', intent);
		root.addEventListener('transit:map-ready', ready);
		root.addEventListener('transit:maplibre-idle', idle);

		await fireEvent.click(view.getByRole('button', { name: 'Load live interactive map' }));
		await view.findByTestId('map-progressive-hero-stub');
		expect(intent).toHaveBeenCalledOnce();
		expect(root.dataset.mapIntentTime).toMatch(/^\d+(?:\.\d+)?$/u);
		expect(root.dataset.mapReadyTime).toBeUndefined();
		expect(root.dataset.mapIdleTime).toBeUndefined();

		await fireEvent.click(view.getByTestId('progressive-stub-ready'));
		expect(ready).toHaveBeenCalledOnce();
		expect(root).toHaveAttribute('data-map-progressive-state', 'booting');
		expect(root.dataset.mapReadyTime).toMatch(/^\d+(?:\.\d+)?$/u);
		expect(root.dataset.mapIdleTime).toBeUndefined();

		await fireEvent.click(view.getByTestId('progressive-stub-idle'));
		await fireEvent.click(view.getByTestId('progressive-stub-idle'));
		expect(idle).toHaveBeenCalledOnce();
		expect(root).toHaveAttribute('data-map-progressive-state', 'ready');
		expect(root.dataset.mapIdleTime).toMatch(/^\d+(?:\.\d+)?$/u);
	});

	it('disables the poster-to-live transition when reduced motion is requested', async () => {
		harness.setReduced(true);
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const view = render(MapProgressive);

		expect(view.getByTestId('map-progressive-poster')).toHaveStyle({ transition: 'none' });
		expect(view.getByTestId('map-progressive-live')).toHaveStyle({ transition: 'none' });
	});

	it('does not activate from timers or requestIdleCallback', async () => {
		vi.useFakeTimers();
		const requestIdleCallback = vi.fn();
		vi.stubGlobal('requestIdleCallback', requestIdleCallback);
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const importer = vi.fn(() => new Promise<never>(() => {}));
		render(MapProgressive, { props: { importHero: importer } });

		await tick();
		await vi.runAllTimersAsync();

		expect(importer).not.toHaveBeenCalled();
		expect(requestIdleCallback).not.toHaveBeenCalled();
	});
});
