import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
	setPath: (_pathname: string) => {},
}));

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
	onNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
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
vi.mock('$lib/motion/view-transition', () => ({ runViewTransition: vi.fn() }));
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

function renderWithoutV1(pathname: string, lang: 'en' | 'fr') {
	harness.setPath(pathname);
	return render(RootLayout, {
		props: {
			data: { lang, v1: null, v1Error: true },
			children,
		},
	});
}

afterEach(() => cleanup());

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
});
