import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { DataHealth, IsoUtc, Provenance } from '$lib/v1/schemas';

const ports = vi.hoisted(() => ({
	getProvenance: vi.fn(),
	getDataHealth: vi.fn(),
}));
const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock('$lib/v1', async () => {
	const freshness = await import('$lib/v1/freshness');
	return {
		getProvenance: ports.getProvenance,
		getDataHealth: ports.getDataHealth,
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

let provenanceGate: ReturnType<typeof deferred<Provenance>>;
let dataHealthGate: ReturnType<typeof deferred<DataHealth>>;
const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

function resetStatusStorage(): void {
	for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
		const key = sessionStorage.key(index);
		if (key?.startsWith('transit.persisted:status-')) sessionStorage.removeItem(key);
	}
	sessionStorage.removeItem('transit.persisted:health-conformance-members');
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
	ports.getProvenance.mockReset();
	ports.getDataHealth.mockReset();
	ports.getProvenance
		.mockImplementationOnce(() => provenanceGate.promise)
		.mockImplementation(() => Promise.resolve(provenanceFixture));
	ports.getDataHealth
		.mockImplementationOnce(() => dataHealthGate.promise)
		.mockImplementation(() => Promise.resolve(dataHealthFixture));
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

		await fireEvent.click(within(left).getByRole('button', { name: copy.en.lanes.section }));

		await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
		expect(expandedAtScroll).toEqual(['true']);
		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
	});
});
