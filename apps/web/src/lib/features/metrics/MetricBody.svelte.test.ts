import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { ViteDevServer } from 'vite';
import type { Locale } from '$lib/i18n';
import { quietMode } from '@yesid/ui/state';
import { highlight } from '@yesid/seo-kit/highlight';
import { METRICS, type MetricEntry } from './metrics.content';
import { metricsCopy } from './metrics.copy';
import MetricBody, { type MetricSqlHtml } from './MetricBody.svelte';
import MetricsExplainer from './MetricsExplainer.svelte';

const state = vi.hoisted(() => ({
	provenance: null as { methodology: Record<string, string> } | null,
}));
vi.mock('./easterWordHover', () => ({
	easterWordHover: () => ({ destroy() {} }),
}));
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
let renderBody: (entry: MetricEntry, locale: Locale, sqlHtml?: string) => string;
let loadPage: () => Promise<{ sqlHtml: MetricSqlHtml }>;

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
	({ load: loadPage } = await server.ssrLoadModule(
		'/src/routes/[[lang=locale]]/metrics/+page.server.ts',
	));
	renderBody = (entry, locale, sqlHtml) =>
		renderSsr(ServerBody, { props: { entry, locale, sqlHtml } }).body;
}, 20_000);

afterAll(async () => {
	await server?.close();
});
beforeEach(() => {
	state.provenance = null;
	quietMode.resetForTest();
});
afterEach(() => {
	sessionStorage.clear();
	quietMode.resetForTest();
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
		'retains every exact %s definition and highlighted source before JavaScript',
		async (locale) => {
			const { sqlHtml } = await loadPage();
			expect(Object.keys(sqlHtml)).toEqual(METRICS.map((entry) => entry.key));
			for (const entry of METRICS) {
				expectContent(documentBody(renderBody(entry, locale, sqlHtml[entry.key])), entry, locale);
			}
		},
	);

	it('highlights the sources once per isolate', async () => {
		expect((await loadPage()).sqlHtml).toBe((await loadPage()).sqlHtml);
	});

	it('keeps adversarial prose and SQL as text through SSR and the browser', async () => {
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
		const sqlHtml = await highlight(entry.sql, 'sql');
		expectContent(documentBody(renderBody(entry, 'en', sqlHtml)), entry, 'en');
		const view = render(MetricBody, { props: { entry, locale: 'en', sqlHtml } });
		expectContent(view.container, entry, 'en');
		expect(view.container.querySelector('script, img, [onerror]')).toBeNull();
	});

	it('keeps published notes and disclosure state outside the static body', async () => {
		state.provenance = { methodology: { otp_definition: 'Published current-run note' } };
		const view = render(MetricsExplainer, { props: { sqlHtml: (await loadPage()).sqlHtml } });
		const block = view.container.querySelector('#otp') as HTMLElement;
		const body = block.querySelector('.section-body') as HTMLElement;
		const trigger = block.querySelector('[data-section-trigger]') as HTMLButtonElement;
		const staticBody = block.querySelector(
			'[data-slot="metric-static-information"]',
		) as HTMLElement;
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
