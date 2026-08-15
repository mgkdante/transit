import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/features/map/MapProgressive.svelte'),
	'utf8',
);

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

function neverImport(): Promise<never> {
	return new Promise<never>(() => {});
}

afterEach(() => {
	cleanup();
	harness.locale = 'en';
	harness.setReduced(false);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('MapProgressive automatic live boot', () => {
	it('stacks the mobile no-JS explanation above the attribution', () => {
		const mobile = source.match(
			/@media \(max-width: 767px\) \{(?<body>[\s\S]*?)\n\t\}\n<\/style>/u,
		);
		const noScriptRule = mobile?.groups?.body.match(
			/\.map-progressive-noscript\s*\{(?<body>[^}]*)\}/u,
		);
		const bottomRem = noScriptRule?.groups?.body.match(/bottom:\s*(?<value>[\d.]+)rem/u)?.groups
			?.value;
		const attributionTopRem = 0.55 + 0.28 * 2 + 0.68 * 1.35;

		expect(source).toMatch(
			/\.map-progressive-attribution,\s*\.map-progressive-noscript\s*\{[^}]*bottom:\s*0\.55rem;[^}]*padding:\s*0\.28rem 0\.42rem;[^}]*font-size:\s*0\.68rem;[^}]*line-height:\s*1\.35;/u,
		);
		expect(bottomRem, 'mobile no-JS bottom offset').toBeDefined();
		expect(Number(bottomRem)).toBeGreaterThanOrEqual(attributionTopRem + 0.2);
	});

	it('shows the pinned basemap generation date while the live map boots in both locales', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const english = render(MapProgressive, { props: { importHero: neverImport } });
		expect(english.getByText('Basemap snapshot · Aug 12, 2026')).toBeVisible();
		cleanup();

		harness.locale = 'fr';
		const french = render(MapProgressive, { props: { importHero: neverImport } });
		expect(french.getByText('Fond de carte · 12 août 2026')).toBeVisible();
	});

	it('imports immediately on mount without a CTA, intent seam, timer, idle, or frame gate', async () => {
		vi.useFakeTimers();
		const requestIdleCallback = vi.fn();
		const requestAnimationFrame = vi.fn();
		vi.stubGlobal('requestIdleCallback', requestIdleCallback);
		vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
		const intent = vi.fn();
		document.addEventListener('transit:map-intent', intent);

		try {
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const importer = vi.fn(neverImport);
			const view = render(MapProgressive, { props: { importHero: importer } });

			await tick();

			expect(importer).toHaveBeenCalledOnce();
			expect(requestIdleCallback).not.toHaveBeenCalled();
			expect(requestAnimationFrame).not.toHaveBeenCalled();
			expect(intent).not.toHaveBeenCalled();
			expect(view.getByTestId('map-progressive')).toHaveAttribute(
				'data-map-progressive-state',
				'booting',
			);
			expect(view.getByRole('heading', { level: 1 })).toHaveTextContent('Live map');
			expect(view.getByText(/The live interactive map loads automatically\./u)).toBeVisible();
			expect(view.queryByText(/Static, non-live basemap/u)).toBeNull();
			expect(view.getByRole('status')).toHaveTextContent('Loading live map');
			expect(view.queryByRole('button', { name: /load live interactive map/iu })).toBeNull();
			expect(view.container.querySelector('[data-map-wake]')).toBeNull();
			expect(view.getByTestId('map-progressive')).not.toHaveAttribute('data-map-intent-time');
		} finally {
			document.removeEventListener('transit:map-intent', intent);
		}
	});

	it('keeps the automatic hero import single-flight while its chunk is pending', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const pending = deferred<HeroModule>();
		const importer = vi.fn(() => pending.promise);
		const view = render(MapProgressive, { props: { importHero: importer } });

		await tick();
		await tick();
		expect(importer).toHaveBeenCalledOnce();
		expect(view.queryByTestId('map-progressive-hero-stub')).toBeNull();

		pending.resolve(await import('./__fixtures__/MapProgressiveHeroStub.svelte'));
		expect(await view.findByTestId('map-progressive-hero-stub')).toBeInTheDocument();
		expect(importer).toHaveBeenCalledOnce();
	});

	it('keeps the poster mounted and the live layer inert until first MapLibre idle', async () => {
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const pending = deferred<HeroModule>();
		const view = render(MapProgressive, { props: { importHero: () => pending.promise } });

		await tick();
		expect(view.queryByTestId('map-progressive-hero-stub')).toBeNull();
		expect(view.getByTestId('map-progressive-poster')).toHaveAttribute('data-visible', 'true');
		expect(view.getByTestId('map-progressive-live')).toHaveAttribute('aria-hidden', 'true');
		expect(view.getByTestId('map-progressive-live')).toHaveAttribute('inert');

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

		await fireEvent.click(view.getByTestId('progressive-stub-idle'));
		expect(view.getByTestId('map-progressive')).toHaveAttribute(
			'data-map-progressive-state',
			'ready',
		);
	});

	it('does not steal focus when the live map reaches first idle', async () => {
		const focusOwner = document.createElement('button');
		focusOwner.textContent = 'Current focus';
		document.body.append(focusOwner);

		try {
			focusOwner.focus();
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
			const view = render(MapProgressive, { props: { importHero: async () => fixture } });

			await view.findByTestId('map-progressive-hero-stub');
			await fireEvent.click(view.getByTestId('progressive-stub-ready'));
			await fireEvent.click(view.getByTestId('progressive-stub-idle'));
			await tick();

			expect(document.activeElement).toBe(focusOwner);
			expect(document.activeElement).not.toBe(view.getByTestId('progressive-stub-map-canvas'));
		} finally {
			focusOwner.remove();
		}
	});

	it('retries a rejected automatic import once without an activation seam or focus handoff', async () => {
		const focusOwner = document.createElement('button');
		focusOwner.textContent = 'Current focus';
		document.body.append(focusOwner);
		const secondImport = deferred<HeroModule>();

		try {
			focusOwner.focus();
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const importer = vi
				.fn<() => Promise<HeroModule>>()
				.mockRejectedValueOnce(new Error('chunk unavailable'))
				.mockImplementationOnce(() => secondImport.promise);
			const view = render(MapProgressive, { props: { importHero: importer } });
			const retry = await view.findByRole('button', { name: 'Try live map again' });

			expect(view.getByRole('alert')).toHaveTextContent('Live map could not start');
			expect(view.container.querySelector('[data-map-wake]')).toBeNull();
			await Promise.all([fireEvent.click(retry), fireEvent.click(retry), fireEvent.click(retry)]);
			expect(importer).toHaveBeenCalledTimes(2);

			secondImport.resolve(await import('./__fixtures__/MapProgressiveHeroStub.svelte'));
			await view.findByTestId('map-progressive-hero-stub');
			await fireEvent.click(view.getByTestId('progressive-stub-ready'));
			await fireEvent.click(view.getByTestId('progressive-stub-idle'));
			await tick();

			expect(importer).toHaveBeenCalledTimes(2);
			expect(document.activeElement).toBe(focusOwner);
		} finally {
			focusOwner.remove();
		}
	});

	it('retries one live MapStage failure without moving focus to the canvas', async () => {
		const focusOwner = document.createElement('button');
		focusOwner.textContent = 'Current focus';
		document.body.append(focusOwner);

		try {
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
			const view = render(MapProgressive, { props: { importHero: async () => fixture } });
			const hero = await view.findByTestId('map-progressive-hero-stub');

			await fireEvent.click(view.getByTestId('progressive-stub-failure'));
			expect(view.getByRole('alert')).toHaveTextContent('Live map could not start');
			const retry = view.getByRole('button', { name: 'Try live map again' });
			focusOwner.focus();
			await Promise.all([fireEvent.click(retry), fireEvent.click(retry), fireEvent.click(retry)]);
			await waitFor(() => expect(hero).toHaveAttribute('data-retry-count', '1'));

			await fireEvent.click(view.getByTestId('progressive-stub-ready'));
			await fireEvent.click(view.getByTestId('progressive-stub-idle'));
			await tick();

			expect(hero).toHaveAttribute('data-retry-count', '1');
			expect(document.activeElement).toBe(focusOwner);
			expect(document.activeElement).not.toBe(view.getByTestId('progressive-stub-map-canvas'));
		} finally {
			focusOwner.remove();
		}
	});

	it('keeps ready and first-idle measurement events without restoring an intent event', async () => {
		const intent = vi.fn();
		document.addEventListener('transit:map-intent', intent);

		try {
			const { default: MapProgressive } = await import('./MapProgressive.svelte');
			const fixture = await import('./__fixtures__/MapProgressiveHeroStub.svelte');
			const view = render(MapProgressive, { props: { importHero: async () => fixture } });
			const root = view.getByTestId('map-progressive');
			const ready = vi.fn();
			const idle = vi.fn();
			root.addEventListener('transit:map-ready', ready);
			root.addEventListener('transit:maplibre-idle', idle);

			await view.findByTestId('map-progressive-hero-stub');
			expect(intent).not.toHaveBeenCalled();
			expect(root.dataset.mapIntentTime).toBeUndefined();

			await fireEvent.click(view.getByTestId('progressive-stub-ready'));
			expect(ready).toHaveBeenCalledOnce();
			expect(root).toHaveAttribute('data-map-progressive-state', 'booting');

			await fireEvent.click(view.getByTestId('progressive-stub-idle'));
			await fireEvent.click(view.getByTestId('progressive-stub-idle'));
			expect(idle).toHaveBeenCalledOnce();
			expect(root).toHaveAttribute('data-map-progressive-state', 'ready');
		} finally {
			document.removeEventListener('transit:map-intent', intent);
		}
	});

	it('disables the poster-to-live transition when reduced motion is requested', async () => {
		harness.setReduced(true);
		const { default: MapProgressive } = await import('./MapProgressive.svelte');
		const view = render(MapProgressive, { props: { importHero: neverImport } });

		expect(view.getByTestId('map-progressive-poster')).toHaveStyle({ transition: 'none' });
		expect(view.getByTestId('map-progressive-live')).toHaveStyle({ transition: 'none' });
	});
});
