import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
	const beforeNavigateCallbacks: Array<(navigation: unknown) => unknown> = [];
	const onNavigateCallbacks: Array<(navigation: unknown) => unknown> = [];
	const transitionTransientStates: boolean[] = [];
	let resolveViewTransition: () => void = () => {};
	const runViewTransition = vi.fn(() => {
		transitionTransientStates.push(
			document.querySelector('[data-m6c2-detail-sheet]') != null ||
				document.body.style.overflow === 'hidden' ||
				document.body.style.pointerEvents === 'none',
		);
		return new Promise<void>((resolve) => {
			resolveViewTransition = resolve;
		});
	});
	return {
		setPath: (_pathname: string) => {},
		beforeNavigateCallbacks,
		onNavigateCallbacks,
		transitionTransientStates,
		runViewTransition,
		finishViewTransition: () => {
			resolveViewTransition();
			resolveViewTransition = () => {};
		},
	};
});

vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		url: new URL('https://transit.yesid.dev/privacy'),
		params: {},
		route: { id: '/[[lang=locale]]/privacy' },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {},
	});
	harness.setPath = (pathname: string) => {
		page.set({
			url: new URL(`https://transit.yesid.dev${pathname}`),
			params: pathname.startsWith('/fr/') ? { lang: 'fr' } : {},
			route: { id: '/[[lang=locale]]/legal' },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		});
	};
	return { page };
});

vi.mock('$app/state', () => ({ updated: { current: false } }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	onNavigate: vi.fn((callback: (navigation: unknown) => unknown) => {
		harness.onNavigateCallbacks.push(callback);
	}),
	beforeNavigate: vi.fn((callback: (navigation: unknown) => unknown) => {
		harness.beforeNavigateCallbacks.push(callback);
	}),
	afterNavigate: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

vi.mock('$lib/analytics/runtime', () => ({
	transitAnalytics: { trackPageview: vi.fn() },
}));
vi.mock('$lib/components/SeoHead.svelte', async () => ({
	default: (await import('./__fixtures__/RootLayoutEmptyStub.svelte')).default,
}));
vi.mock('$lib/components/shell', async () => ({
	AppShell: (await import('./__fixtures__/RootLayoutShellStub.svelte')).default,
}));
vi.mock('$lib/components/layout', async () => ({
	Footer: (await import('./__fixtures__/RootLayoutFooterStub.svelte')).default,
}));
vi.mock('$lib/components/edge', async () => ({
	EdgeState: (await import('./__fixtures__/RootLayoutEdgeStateStub.svelte')).default,
}));
vi.mock('$lib/seo/routeSeo', () => ({
	resolveRouteSeo: () => ({ title: 'Legal', description: 'Legal placeholder description.' }),
	isEphemeralPath: () => false,
	breadcrumbItemsForHead: () => [],
	resolveDatasetSeo: () => ({ name: 'Dataset', description: 'Dataset description.' }),
}));
vi.mock('$lib/seo/jsonld', () => ({
	breadcrumbJsonLd: () => null,
	organizationJsonLd: () => ({}),
	datasetJsonLd: () => ({}),
}));
vi.mock('$lib/site/config', () => ({
	readPublicSiteConfig: () => ({
		siteOrigin: 'https://transit.yesid.dev',
		indexing: false,
		siteName: 'Transit',
	}),
}));
vi.mock('$lib/site/errorPage', () => ({
	errorDocumentHead: () => ({ title: 'Error', description: 'Error' }),
}));
vi.mock('$lib/v1/boot', () => ({
	setV1Context: vi.fn(),
	bootV1: vi.fn(),
}));
vi.mock('$lib/v1/repositories/live', () => ({ getVehicles: vi.fn() }));
vi.mock('$lib/v1/repositories/static', () => ({
	getRoutesIndex: vi.fn(),
	getStopsIndex: vi.fn(),
}));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({ data: null, error: null, loading: false, settled: false }),
}));
vi.mock('$lib/stores', () => ({
	dataRefresh: { seedDataGeneratedUtc: vi.fn() },
	dataPulse: { subscribe: vi.fn(() => vi.fn()) },
	themeStore: { init: vi.fn() },
}));
vi.mock('$lib/pwa/register', () => ({ registerServiceWorker: vi.fn() }));
vi.mock('$lib/pwa/appVersion', () => ({
	decideFreshnessReload: () => ({ reload: false, href: null }),
}));
vi.mock('$lib/vitals/collect', () => ({ startVitals: () => vi.fn() }));
vi.mock('$lib/motion/view-transition', () => ({ runViewTransition: harness.runViewTransition }));
vi.mock('@yesid/motion/utils/globalRipple', () => ({ initGlobalRipple: () => vi.fn() }));
vi.mock('$lib/nav', () => ({ layout: { isDesktop: true } }));
vi.mock('$lib/search/chromeSearch', () => ({
	chromeSearchResultHref: () => '/map',
	chromeSearchResults: () => [],
	scopeForPath: () => 'all',
}));
vi.mock('$lib/geocode/sessionToken', () => ({
	createGooglePlacesSessionToken: () => '123e4567-e89b-12d3-a456-426614174000',
}));

import RootLayout from './+layout.svelte';

const children = createRawSnippet(() => ({
	render: () => '<article data-testid="legal-child">Legal child</article>',
}));

let appStyle: HTMLStyleElement;

beforeAll(() => {
	appStyle = document.createElement('style');
	appStyle.dataset.testAppCss = '';
	// Vite's server-side CSS transform does not inject Tailwind utilities into
	// Happy DOM. These are the exact two declarations emitted by the production
	// build; installing them makes the assertion exercise computed overflow rather
	// than class-token presence.
	// Happy DOM does not expand the overflow shorthand into overflowY, so repeat
	// the shorthand's Y-axis value explicitly for the computed-style assertion.
	appStyle.textContent =
		'.overflow-hidden{overflow:hidden;overflow-y:hidden}.overflow-y-auto{overflow-y:auto}';
	document.head.append(appStyle);
});

afterAll(() => appStyle.remove());

function renderWithoutV1(pathname: string, lang: 'en' | 'fr') {
	harness.beforeNavigateCallbacks.length = 0;
	harness.onNavigateCallbacks.length = 0;
	harness.transitionTransientStates.length = 0;
	harness.runViewTransition.mockClear();
	harness.setPath(pathname);
	return render(RootLayout, {
		props: {
			data: { lang, v1: null, v1Error: true },
			children,
		},
	});
}

afterEach(() => {
	cleanup();
	document.body.style.removeProperty('overflow');
	document.body.style.removeProperty('pointer-events');
});

describe('root layout data-independent legal routes', () => {
	it.each([
		['/privacy', 'en', 'Licensing and attribution notices are under legal review.'],
		['/fr/terms', 'fr', 'Mentions de licence et d’attribution en cours de révision juridique.'],
	] as const)(
		'renders %s with v1=null and a static legal footer attribution',
		(pathname, lang, attribution) => {
			const { getByTestId, queryByTestId } = renderWithoutV1(pathname, lang);

			expect(getByTestId('legal-child')).toBeInTheDocument();
			expect(queryByTestId('root-layout-edge-state')).not.toBeInTheDocument();
			expect(getByTestId('root-layout-footer')).toHaveTextContent(attribution);
		},
	);

	it('keeps the v1 outage state on data-dependent routes', () => {
		const { getByTestId, queryByTestId } = renderWithoutV1('/network', 'en');

		expect(getByTestId('root-layout-edge-state')).toBeInTheDocument();
		expect(queryByTestId('legal-child')).not.toBeInTheDocument();
		expect(getByTestId('root-layout-footer').textContent?.trim()).toBe('');
	});

	it.each([
		['desktop overlay', 'data-slot', 'map-detail-overlay', false],
		['mobile sheet', 'data-m6c2-detail-sheet', '', true],
	] as const)(
		'commits a panel-open map exit before the new URL can retain #main scroll lock: %s',
		async (_panelKind, attribute, value, locksBody) => {
			const { container } = renderWithoutV1('/map', 'en');
			const main = container.querySelector('#main') as HTMLElement;
			expect(getComputedStyle(main).overflowY).toBe('hidden');

			const panel = document.createElement('div');
			panel.setAttribute(attribute, value);
			document.body.append(panel);
			if (locksBody) {
				document.body.style.overflow = 'hidden';
				document.body.style.pointerEvents = 'none';
			}
			let completeNavigation: () => void;
			const complete = new Promise<void>((resolve) => {
				completeNavigation = resolve;
			});
			const navigation = {
				from: { url: new URL('https://transit.yesid.dev/map') },
				to: { url: new URL('https://transit.yesid.dev/lines') },
				willUnload: false,
				complete,
			};

			for (const callback of harness.beforeNavigateCallbacks) callback(navigation);
			window.history.replaceState({}, '', '/lines');
			const blocker = harness.onNavigateCallbacks.at(-1)?.(navigation);

			try {
				// SvelteKit commits root/page state only after every onNavigate callback
				// returns. A panel-exit callback must therefore stay synchronous: the URL
				// is already /lines here, and a promise would leave the live /map #main in
				// place with overflow hidden.
				if (!(blocker instanceof Promise)) {
					harness.setPath('/lines');
					await tick();
				}

				expect(window.location.pathname).toBe('/lines');
				expect(getComputedStyle(main).overflowY).toBe('auto');
				expect(harness.runViewTransition).not.toHaveBeenCalled();
			} finally {
				panel.remove();
				document.body.style.removeProperty('overflow');
				document.body.style.removeProperty('pointer-events');
				harness.finishViewTransition();
				completeNavigation!();
				await blocker;
				window.history.replaceState({}, '', '/');
			}
		},
	);

	it.each([
		['a panel-closed map', false, [false]],
		['a stale body lock without a live panel', true, [true]],
	] as const)(
		'preserves the normal View Transition for %s',
		async (_state, lockBody, expectedTransitionState) => {
			const { container } = renderWithoutV1('/map', 'en');
			const main = container.querySelector('#main') as HTMLElement;
			if (lockBody) {
				document.body.style.overflow = 'hidden';
				document.body.style.pointerEvents = 'none';
			}
			let completeNavigation: () => void;
			const complete = new Promise<void>((resolve) => {
				completeNavigation = resolve;
			});
			const navigation = {
				from: { url: new URL('https://transit.yesid.dev/map') },
				to: { url: new URL('https://transit.yesid.dev/lines') },
				willUnload: false,
				complete,
			};

			for (const callback of harness.beforeNavigateCallbacks) callback(navigation);
			window.history.replaceState({}, '', '/lines');
			const blocker = harness.onNavigateCallbacks.at(-1)?.(navigation);

			try {
				expect(blocker).toBeInstanceOf(Promise);
				expect(harness.runViewTransition).toHaveBeenCalledOnce();
				expect(harness.transitionTransientStates).toEqual(expectedTransitionState);
				expect(getComputedStyle(main).overflowY).toBe('hidden');

				harness.finishViewTransition();
				await blocker;
				harness.setPath('/lines');
				await tick();
				expect(getComputedStyle(main).overflowY).toBe('auto');
			} finally {
				document.body.style.removeProperty('overflow');
				document.body.style.removeProperty('pointer-events');
				harness.finishViewTransition();
				completeNavigation!();
				await blocker;
				window.history.replaceState({}, '', '/');
			}
		},
	);

	it.each([
		['desktop overlay', 'data-slot', 'map-detail-overlay', false],
		['mobile sheet', 'data-m6c2-detail-sheet', '', true],
	] as const)(
		'skips the transition for a callback-suppressed panel-open map exit: %s',
		async (_panelKind, attribute, value, locksBody) => {
			const { container } = renderWithoutV1('/map', 'en');
			const main = container.querySelector('#main') as HTMLElement;
			expect(getComputedStyle(main).overflowY).toBe('hidden');

			const panel = document.createElement('div');
			panel.setAttribute(attribute, value);
			document.body.append(panel);
			if (locksBody) {
				document.body.style.overflow = 'hidden';
				document.body.style.pointerEvents = 'none';
			}
			let completeNavigation: () => void;
			const complete = new Promise<void>((resolve) => {
				completeNavigation = resolve;
			});
			const navigation = {
				from: { url: new URL('https://transit.yesid.dev/map') },
				to: { url: new URL('https://transit.yesid.dev/lines') },
				willUnload: false,
				complete,
			};

			// Kit suppresses beforeNavigate while another accepted navigation is active.
			// The final transaction callback is still authoritative and must decide from
			// its own from/to pair rather than a flag set by the missing callback.
			window.history.replaceState({}, '', '/lines');
			const blocker = harness.onNavigateCallbacks.at(-1)?.(navigation);

			try {
				if (!(blocker instanceof Promise)) {
					harness.setPath('/lines');
					await tick();
				}

				expect(blocker).toBeUndefined();
				expect(harness.runViewTransition).not.toHaveBeenCalled();
				expect(getComputedStyle(main).overflowY).toBe('auto');
			} finally {
				panel.remove();
				document.body.style.removeProperty('overflow');
				document.body.style.removeProperty('pointer-events');
				harness.finishViewTransition();
				completeNavigation!();
				await blocker;
				window.history.replaceState({}, '', '/');
			}
		},
	);
});
