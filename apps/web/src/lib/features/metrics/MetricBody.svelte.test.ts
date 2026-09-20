import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { ViteDevServer } from 'vite';
import type { Locale } from '$lib/i18n';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import { METRICS, type MetricEntry } from './metrics.content';
import { metricsCopy } from './metrics.copy';
import MetricBody, { type MetricBodies } from './MetricBody.svelte';
import MetricsExplainer from './MetricsExplainer.svelte';

const state = vi.hoisted(() => ({
	word: vi.fn(),
	disposers: [] as ReturnType<typeof vi.fn>[],
	provenance: null as { methodology: Record<string, string> } | null,
}));
vi.mock('./easterWordHover', () => ({ easterWordHover: state.word }));
vi.mock('$lib/v1/repositories/provenance', () => ({ getProvenance: vi.fn() }));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		get data() {
			return state.provenance;
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

let server: ViteDevServer;
let getBodies: (locale: Locale) => MetricBodies;
let renderBody: (entry: MetricEntry, locale: Locale, serverHtml?: string) => string;
let loadPage: (event: { locals: { locale?: Locale } }) => { metricBodies: MetricBodies };

beforeAll(async () => {
	const { createServer } = await import('vite');
	server = await createServer({
		configFile: 'vite.config.ts',
		appType: 'custom',
		logLevel: 'silent',
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	const { render: renderSsr } = await server.ssrLoadModule('svelte/server');
	const { default: ServerBody } = await server.ssrLoadModule(
		'/src/lib/features/metrics/MetricBody.svelte',
	);
	({ getMetricBodies: getBodies } = await server.ssrLoadModule(
		'/src/lib/features/metrics/metrics.server.ts',
	));
	({ load: loadPage } = await server.ssrLoadModule(
		'/src/routes/[[lang=locale]]/metrics/+page.server.ts',
	));
	renderBody = (entry, locale, serverHtml) =>
		renderSsr(ServerBody, { props: { entry, locale, serverHtml } }).body;
}, 20_000);

afterAll(async () => {
	await server?.close();
});
beforeEach(() => {
	state.disposers = [];
	state.provenance = null;
	state.word.mockReset();
	state.word.mockImplementation(() => {
		const destroy = vi.fn();
		state.disposers.push(destroy);
		return { destroy };
	});
	quietModeStore.resetForTest();
});
afterEach(() => {
	sessionStorage.clear();
	quietModeStore.resetForTest();
});

function documentBody(html: string): HTMLDivElement {
	const element = document.createElement('div');
	element.innerHTML = html;
	return element;
}

function expectContent(element: HTMLElement, entry: MetricEntry, locale: Locale): void {
	expect(
		Array.from(element.querySelectorAll('[data-kind]'), (card) => card.getAttribute('data-kind')),
	).toEqual(['definition', 'math', 'sql', 'not-really', 'caveat']);
	expect(
		element.querySelector('[data-kind="definition"] [data-slot="easter-prose"]')?.textContent,
	).toBe(entry.definition[locale]);
	expect(element.querySelector('[data-kind="math"] p')?.textContent).toBe(entry.math[locale]);
	expect(
		element.querySelector('[data-kind="not-really"] [data-slot="easter-prose"]')?.textContent,
	).toBe(entry.notReally[locale]);
	expect(
		Array.from(element.querySelectorAll('[data-kind="caveat"] li'), (item) => item.textContent),
	).toEqual(entry.caveats[locale]);
	const code = element.querySelector('[data-kind="sql"] pre');
	expect(code?.textContent).toBe(entry.sql);
	expect(code).toHaveAttribute('tabindex', '0');
	expect(code).toHaveAttribute('role', 'region');
	expect(code).toHaveAttribute('aria-label', `${metricsCopy[locale].sqlAria}: ${entry.sciName}`);
}

describe('server-rendered methodology bodies', () => {
	it.each(['en', 'fr'] as const)(
		'retains every exact %s definition and source block before JavaScript',
		(locale) => {
			const bodies = loadPage({ locals: { locale } }).metricBodies;
			expect(Object.keys(bodies)).toEqual(METRICS.map((entry) => entry.key));
			for (const entry of METRICS) {
				const html = bodies[entry.key]!;
				expectContent(documentBody(html), entry, locale);
				expectContent(documentBody(renderBody(entry, locale, html)), entry, locale);
			}
		},
	);

	it('uses English for an unprefixed request and keeps the locale cache distinct', () => {
		const english = loadPage({ locals: {} }).metricBodies;
		const french = getBodies('fr');
		expect(english).toBe(getBodies('en'));
		expect(french).not.toBe(english);
		expectContent(documentBody(english.otp!), METRICS[0], 'en');
		expectContent(documentBody(french.otp!), METRICS[0], 'fr');
	});

	it('keeps adversarial prose and SQL as text through SSR and the opaque browser branch', () => {
		const adversarial =
			'<script>window.injected = true</script><img src=x onerror="alert(1)"> & "é"';
		const entry: MetricEntry = {
			...METRICS[0],
			definition: { en: adversarial, fr: adversarial },
			math: { en: adversarial, fr: adversarial },
			notReally: { en: adversarial, fr: adversarial },
			caveats: { en: [adversarial], fr: [adversarial] },
			sql: `${adversarial}\nSELECT '<&>';`,
		};
		const serverHtml = renderBody(entry, 'en');
		const view = render(MetricBody, { props: { entry, locale: 'en', serverHtml } });
		expectContent(view.container, entry, 'en');
		expect(view.container.querySelector('script, img, [onerror]')).toBeNull();
	});

	it('restores word actions and their seeds once, cleans old actions on replacement and on teardown', async () => {
		const entry = METRICS.find((entry) => entry.key === 'occupancy')!;
		const view = render(MetricBody, {
			props: { entry, locale: 'en', serverHtml: getBodies('en')[entry.key] },
		});
		const firstWords = Array.from(
			view.container.querySelectorAll<HTMLElement>('[data-easter-effect]'),
		);
		expect(firstWords.length).toBeGreaterThan(0);
		for (const node of firstWords) {
			expect(state.word).toHaveBeenCalledWith(node, {
				startEffect: Number(node.dataset.easterEffect),
			});
		}
		expect(state.word).toHaveBeenCalledTimes(firstWords.length);
		const firstDisposers = [...state.disposers];
		await view.rerender({ locale: 'fr', serverHtml: getBodies('fr')[entry.key] });
		for (const dispose of firstDisposers) expect(dispose).toHaveBeenCalledOnce();
		const newWords = Array.from(
			view.container.querySelectorAll<HTMLElement>('[data-easter-effect]'),
		);
		expect(state.word).toHaveBeenCalledTimes(firstWords.length + newWords.length);
		expect(firstWords.every((node) => !view.container.contains(node))).toBe(true);
		expectContent(view.container, entry, 'fr');
		await view.unmount();
		for (const dispose of state.disposers) expect(dispose).toHaveBeenCalledOnce();
	});

	it('keeps published notes and disclosure state outside the static body', async () => {
		state.provenance = { methodology: { otp_definition: 'Published current-run note' } };
		const view = render(MetricsExplainer, { props: { metricBodies: getBodies('en') } });
		const block = view.container.querySelector('#otp') as HTMLElement;
		const body = block.querySelector('.section-body') as HTMLElement;
		const trigger = block.querySelector('[data-section-trigger]') as HTMLButtonElement;
		const staticBody = block.querySelector('[data-slot="metric-static-host"]') as HTMLElement;
		const note = block.querySelector('[data-slot="pipeline-note"]') as HTMLElement;
		expect(note.textContent).toBe('Published current-run note');
		expect(staticBody.contains(note)).toBe(false);
		expect(note.closest('.metric__information-stack')).toBe(
			staticBody.closest('.metric__information-stack'),
		);
		const code = staticBody.querySelector('pre');
		await fireEvent.click(trigger);
		expect(body).toHaveAttribute('inert');
		expect(staticBody.querySelector('pre')).toBe(code);
		await fireEvent.click(trigger);
		expect(body).not.toHaveAttribute('inert');
		expectContent(staticBody, METRICS[0], 'en');
		expect(block.querySelector('a.metric__top')).toHaveAttribute('href', '#metrics-provenance');
	});
});
