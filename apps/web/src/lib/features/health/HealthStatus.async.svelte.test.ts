import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { DataHealth, HistoricAvailabilityIndex, IsoUtc, Provenance } from '$lib/v1/schemas';

const ports = vi.hoisted(() => ({
	getProvenance: vi.fn(),
	getDataHealth: vi.fn(),
	getHistoricAvailability: vi.fn(),
}));
const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock('$lib/v1', async () => {
	const freshness = await import('$lib/v1/freshness');
	return {
		getProvenance: ports.getProvenance,
		getDataHealth: ports.getDataHealth,
		getHistoricAvailability: ports.getHistoricAvailability,
		freshnessRelative: freshness.freshnessRelative,
	};
});

vi.mock('$lib/nav', () => ({ layout: { isDesktop: true } }));

vi.mock('$lib/motion/reduced-motion.svelte', () => ({
	prefersReducedMotion: {
		get current() {
			return motion.reduced;
		},
	},
	isPrefersReducedMotion: () => motion.reduced,
}));

vi.mock('$lib/components/shared/toc', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/components/shared/toc')>();
	return { ...actual, observeActiveToc: () => () => {} };
});

import { dataRefresh } from '$lib/stores';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import HealthStatus from './HealthStatus.svelte';
import { copy } from './health.copy';

const iso = (value: string) => value as unknown as IsoUtc;

const provenanceFixture: Provenance = {
	generated_utc: iso('2026-06-19T12:00:00Z'),
	freshness: [{ feed: 'realtime_vehicles', status: 'succeeded', age_s: 40 }],
	sources: [],
	gaps: [],
	retention: {},
	conformance: null,
};

const dataHealthFixture: DataHealth = {
	generated_utc: iso('2026-06-19T12:00:00Z'),
	lanes: [
		{
			lane: 'live',
			last_publish_utc: iso('2026-06-19T11:59:03Z'),
			age_s: 57,
			files_written: 5,
			files_skipped: 0,
			files_total: 5,
			gate: {
				checks_run: 42,
				errors: 0,
				warnings: 0,
				verdict: 'pass',
				generated_utc: iso('2026-06-19T11:59:03Z'),
			},
		},
	],
	feeds: [],
};

const historyFixture: HistoricAvailabilityIndex = {
	generated_utc: iso('2026-07-14T12:00:00Z'),
	families: [
		{
			family: 'alerts',
			selection_mode: 'range',
			index_path: 'historic/alerts/index.json',
			first_available_date: '2026-05-20',
			last_available_date: '2026-07-14',
		},
	],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let provenanceGate: ReturnType<typeof deferred<Provenance>>;
let dataHealthGate: ReturnType<typeof deferred<DataHealth>>;
let historyGate: ReturnType<typeof deferred<HistoricAvailabilityIndex | null>>;
const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

function resetStatusStorage(): void {
	for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
		const key = sessionStorage.key(index);
		if (key?.startsWith('transit.persisted:status-')) sessionStorage.removeItem(key);
	}
	sessionStorage.removeItem('transit.persisted:health-conformance-members');
}

async function openHealthToc(left: HTMLElement): Promise<HTMLElement> {
	const trigger = await waitFor(() =>
		within(left).getByRole('button', { name: copy.en.toc.label }),
	);
	if (trigger.getAttribute('aria-expanded') === 'false') await fireEvent.click(trigger);
	return trigger;
}

beforeEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	resetStatusStorage();
	localStorage.setItem('transit:quiet-mode', 'true');
	sessionStorage.setItem('transit.persisted:status-card-health-lanes', 'false');
	window.location.hash = '';
	motion.reduced = false;
	scrollIntoView.mockReset();
	Object.defineProperty(Element.prototype, 'scrollIntoView', {
		configurable: true,
		value: scrollIntoView,
	});

	provenanceGate = deferred<Provenance>();
	dataHealthGate = deferred<DataHealth>();
	historyGate = deferred<HistoricAvailabilityIndex | null>();
	ports.getProvenance.mockReset();
	ports.getDataHealth.mockReset();
	ports.getHistoricAvailability.mockReset();
	ports.getProvenance
		.mockImplementationOnce(() => provenanceGate.promise)
		.mockImplementation(() => Promise.resolve(provenanceFixture));
	ports.getDataHealth
		.mockImplementationOnce(() => dataHealthGate.promise)
		.mockImplementation(() => Promise.resolve(dataHealthFixture));
	ports.getHistoricAvailability
		.mockImplementationOnce(() => historyGate.promise)
		.mockImplementation(() => Promise.resolve(historyFixture));
});

afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	resetStatusStorage();
	window.location.hash = '';
});

afterAll(() => {
	if (originalScrollIntoView) {
		Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
	} else {
		Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
	}
});

describe('HealthStatus — async reveal navigation', () => {
	it('mounts the history card and ToC together after discovery, honoring quiet mode and Expand all', async () => {
		sessionStorage.removeItem('transit.persisted:status-card-health-history-coverage');
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		await waitFor(() => expect(ports.getHistoricAvailability).toHaveBeenCalledTimes(1));
		expect(
			within(center).queryByRole('button', { name: copy.en.historyCoverage.section }),
		).toBeNull();
		expect(
			within(left).queryByRole('button', { name: copy.en.historyCoverage.section }),
		).toBeNull();

		historyGate.resolve(historyFixture);

		const card = await waitFor(() =>
			within(center).getByRole('button', { name: copy.en.historyCoverage.section }),
		);
		const toc = await waitFor(() => within(left).getByRole('button', { name: copy.en.toc.label }));
		expect(card).toHaveAttribute('aria-expanded', 'false');
		expect(toc).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
		expect(card).toHaveAttribute('aria-expanded', 'true');
		expect(toc).toHaveAttribute('aria-expanded', 'true');
		expect(
			within(left).getByRole('button', { name: copy.en.historyCoverage.section }),
		).toBeInTheDocument();
	});

	it('opens and scrolls a retained-history hash only after the async card and ToC exist', async () => {
		window.location.hash = '#health-history-coverage';
		const targets: Array<string | null> = [];
		scrollIntoView.mockImplementation(function (this: Element) {
			targets.push(this.getAttribute('data-toc'));
		});
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		await waitFor(() => expect(ports.getHistoricAvailability).toHaveBeenCalledTimes(1));

		historyGate.resolve(historyFixture);

		const card = await waitFor(() =>
			within(center).getByRole('button', { name: copy.en.historyCoverage.section }),
		);
		await waitFor(() => expect(targets).toEqual(['health-history-coverage']));
		expect(card).toHaveAttribute('aria-expanded', 'true');
	});

	it('opens and scrolls an async hash target once, even after a later data refresh', async () => {
		window.location.hash = '#health-lanes';
		const { container } = render(HealthStatus);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));

		dataHealthGate.resolve(dataHealthFixture);

		await waitFor(() =>
			expect(within(center).getByRole('button', { name: copy.en.lanes.section })).toHaveAttribute(
				'aria-expanded',
				'true',
			),
		);
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

		dataRefresh.bumpEpoch();
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(2));
		await tick();
		await Promise.resolve();

		expect(scrollIntoView).toHaveBeenCalledTimes(1);
	});

	it('collapses cards that mount after the remembered start signal', async () => {
		// No stale per-card session seed: the collapsed start must come from the
		// remembered bulk mode alone, even for cards that mount once data resolves.
		sessionStorage.removeItem('transit.persisted:status-card-health-lanes');
		const { container } = render(HealthStatus);
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));
		provenanceGate.resolve(provenanceFixture);
		dataHealthGate.resolve(dataHealthFixture);

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const lanes = await waitFor(() =>
			within(center).getByRole('button', { name: copy.en.lanes.section }),
		);
		expect(lanes).toHaveAttribute('aria-expanded', 'false');
	});

	it('reopens a stale session CLOSE choice on an unremembered mount once data arrives', async () => {
		// Unremembered article mount: the reset-to-expanded signal is authoritative
		// over the stale session CLOSE seeded in beforeEach, including for cards
		// that mount only after their resource resolves.
		localStorage.removeItem('transit:quiet-mode');
		const { container } = render(HealthStatus);
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));
		provenanceGate.resolve(provenanceFixture);
		dataHealthGate.resolve(dataHealthFixture);

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const lanes = await waitFor(() =>
			within(center).getByRole('button', { name: copy.en.lanes.section }),
		);
		expect(lanes).toHaveAttribute('aria-expanded', 'true');
	});

	it('opens a ToC target before scrolling and uses auto behavior for reduced motion', async () => {
		motion.reduced = true;
		const { container } = render(HealthStatus);
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));
		provenanceGate.resolve(provenanceFixture);
		dataHealthGate.resolve(dataHealthFixture);

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		const target = await waitFor(() =>
			within(center).getByRole('button', { name: copy.en.lanes.section }),
		);
		expect(target).toHaveAttribute('aria-expanded', 'false');
		const expandedAtScroll: Array<string | null> = [];
		scrollIntoView.mockImplementation(() => {
			expandedAtScroll.push(target.getAttribute('aria-expanded'));
		});

		await openHealthToc(left);
		await fireEvent.click(within(left).getByRole('button', { name: copy.en.lanes.section }));

		await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
		expect(expandedAtScroll).toEqual(['true']);
		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
	});

	it('scrolls only the latest async hash target when the hash changes during layout settle', async () => {
		const { container } = render(HealthStatus);
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));
		provenanceGate.resolve(provenanceFixture);
		dataHealthGate.resolve(dataHealthFixture);

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		await waitFor(() =>
			expect(within(center).getByRole('button', { name: copy.en.freshness.section })).toBeVisible(),
		);
		const targets: Array<string | null> = [];
		scrollIntoView.mockImplementation(function (this: Element) {
			targets.push(this.getAttribute('data-toc'));
		});

		window.history.replaceState(null, '', '#health-lanes');
		await fireEvent(window, new HashChangeEvent('hashchange'));
		await tick();
		await tick();
		window.history.replaceState(null, '', '#health-freshness');
		await fireEvent(window, new HashChangeEvent('hashchange'));

		await waitFor(() => expect(targets).toEqual(['health-freshness']));
	});

	it('does not revive an in-flight hash after an explicit ToC choice', async () => {
		const { container } = render(HealthStatus);
		await waitFor(() => expect(ports.getDataHealth).toHaveBeenCalledTimes(1));
		provenanceGate.resolve(provenanceFixture);
		dataHealthGate.resolve(dataHealthFixture);

		const left = container.querySelector('[data-slot="detail-shell-left"]') as HTMLElement;
		await openHealthToc(left);
		await waitFor(() =>
			expect(within(left).getByRole('button', { name: copy.en.freshness.section })).toBeVisible(),
		);
		const targets: Array<string | null> = [];
		scrollIntoView.mockImplementation(function (this: Element) {
			targets.push(this.getAttribute('data-toc'));
		});

		window.history.replaceState(null, '', '#health-lanes');
		await fireEvent(window, new HashChangeEvent('hashchange'));
		await tick();
		await tick();
		await fireEvent.click(within(left).getByRole('button', { name: copy.en.freshness.section }));
		await waitFor(() => expect(targets).toEqual(['health-freshness']));

		ports.getProvenance.mockImplementation(() =>
			Promise.resolve({
				...provenanceFixture,
				sources: [
					{
						feed: 'static_schedule',
						chain: 'r2:provider/static/gtfs.zip',
						last_loaded_utc: iso('2026-06-19T11:00:00Z'),
					},
				],
			}),
		);
		dataRefresh.bumpEpoch();
		await waitFor(() => expect(ports.getProvenance).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(within(left).getByRole('button', { name: copy.en.sources.section })).toBeVisible(),
		);
		await new Promise((resolve) => setTimeout(resolve, 800));

		expect(targets).toEqual(['health-freshness']);
	});
});
