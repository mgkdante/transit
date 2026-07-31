import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DelayLabelCopy } from '$lib/site/delayPresentation';
import { detailCopy } from '$lib/features/stops/stops.copy';
import ScheduleTable, { type ScheduleRow } from './ScheduleTable.svelte';

const scheduleTableSource = readFileSync(
	resolve(process.cwd(), 'src/lib/components/schedule/ScheduleTable.svelte'),
	'utf8',
);
const dataTableSource = readFileSync(
	resolve(process.cwd(), 'src/lib/components/data/DataTable.svelte'),
	'utf8',
);

const GRID_LABELS = {
	caption: 'Scheduled service by line',
	route: 'Line',
	destination: 'Destination',
	departures: 'Departures',
};

const BOARD_LABELS = {
	caption: 'Live departures',
	route: 'Line',
	departure: 'Departure',
	status: 'Status',
};

const SERVICE_LABELS = {
	caption: 'Planned service periods',
	period: 'Period',
	window: 'Window',
	headway: 'Planned headway',
};

// The plain-language delay copy (mirrors StopDetail's t.next): no `noDelay`, so an
// absent delay falls back to `onTime` — the scheduled-board semantics.
const DELAY_COPY: DelayLabelCopy = {
	early: (m) => `${Math.abs(m)} min early`,
	late: (m) => `+${m} min late`,
	onTime: 'on time',
};

const resizeObservers: ResizeObserverStub[] = [];

class ResizeObserverStub {
	readonly targets = new Set<Element>();
	readonly observe = vi.fn((target: Element) => this.targets.add(target));
	readonly disconnect = vi.fn(() => this.targets.clear());

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}

	trigger(): void {
		this.callback([], this as unknown as ResizeObserver);
	}
}

function observerFor(target: Element): ResizeObserverStub | undefined {
	return resizeObservers.find((observer) => observer.targets.has(target));
}

function scheduleChassis(
	container: HTMLElement,
	caption: string,
	mode: 'grid' | 'board' | 'service',
) {
	const table = within(container).getByRole('table', { name: caption });
	const frame = table.parentElement as HTMLElement;

	expect(frame).toHaveClass('data-table-frame', 'schedule-table-frame');
	expect(frame).toHaveAttribute('data-mode', mode);
	expect(frame).toHaveAttribute('data-responsive', 'scroll');
	expect(frame).toHaveAttribute('data-frame', 'card');
	expect(frame).toHaveAttribute('data-collapse', 'collapse');
	expect(frame).toHaveAttribute('data-frame-radius', 'true');
	expect(frame).toHaveAttribute('data-header-band', 'terminal');
	expect(table).toHaveClass('data-table', 'schedule-table');
	expect(table.querySelectorAll('caption')).toHaveLength(1);

	return { table, frame };
}

describe('ScheduleTable — shared scroll chassis', () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps overflow-x auto, the three legacy min-width values, and the labelled region wiring', async () => {
		const gridView = render(ScheduleTable, {
			props: {
				rows: [{ kind: 'grid', route: '51', headsign: 'Nord', times: ['08:00'] }],
				mode: 'grid',
				locale: 'en',
				labels: GRID_LABELS,
			},
		});
		const { frame: gridFrame } = scheduleChassis(gridView.container, GRID_LABELS.caption, 'grid');
		expect(gridFrame.style.getPropertyValue('--dt-min-width')).toBe('42rem');
		expect(gridFrame.style.getPropertyValue('--dt-min-width-compact')).toBe('32rem');
		expect(dataTableSource).toMatch(
			/\.data-table-frame\[data-responsive='scroll'\]\s*\{[^}]*overflow-x:\s*auto/,
		);
		expect(dataTableSource).toMatch(
			/\.data-table-frame\[data-responsive='scroll'\] \.data-table\s*\{[^}]*min-width:\s*var\(--dt-min-width,\s*100%\)/,
		);
		expect(dataTableSource).toMatch(
			/min-width:\s*var\(--dt-min-width-compact,\s*var\(--dt-min-width,\s*100%\)\)/,
		);
		const responsiveBlocks = scheduleTableSource.match(/responsive=\{\{[\s\S]*?\n\s*\}\}/g) ?? [];
		expect(responsiveBlocks).toHaveLength(3);
		for (const block of responsiveBlocks) {
			expect(block).toMatch(/mode:\s*'scroll'/);
			expect(block).toMatch(/minWidth:\s*'(?:34|42)rem'/);
			expect(block).toMatch(/minWidthCompact:\s*'32rem'/);
			expect(block).toMatch(/scrollLabel:\s*labels\.caption/);
		}

		Object.defineProperties(gridFrame, {
			clientWidth: { configurable: true, get: () => 320 },
			scrollWidth: { configurable: true, get: () => 672 },
		});
		const observer = observerFor(gridFrame);
		expect(observer).toBeDefined();
		observer?.trigger();
		await tick();
		expect(within(gridView.container).getByRole('region', { name: GRID_LABELS.caption })).toBe(
			gridFrame,
		);
		expect(gridFrame).toHaveAttribute('tabindex', '0');

		const boardView = render(ScheduleTable, {
			props: {
				rows: [{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 }],
				mode: 'board',
				locale: 'en',
				labels: BOARD_LABELS,
				delayCopy: DELAY_COPY,
			},
		});
		const { frame: boardFrame } = scheduleChassis(
			boardView.container,
			BOARD_LABELS.caption,
			'board',
		);
		expect(boardFrame.style.getPropertyValue('--dt-min-width')).toBe('34rem');
		expect(boardFrame.style.getPropertyValue('--dt-min-width-compact')).toBe('32rem');

		const serviceView = render(ScheduleTable, {
			props: {
				rows: [{ kind: 'service', period: 'AM peak', window: '06:00–09:00', headway: '6.0 min' }],
				mode: 'service',
				locale: 'en',
				labels: SERVICE_LABELS,
			},
		});
		const { frame: serviceFrame } = scheduleChassis(
			serviceView.container,
			SERVICE_LABELS.caption,
			'service',
		);
		expect(serviceFrame.style.getPropertyValue('--dt-min-width')).toBe('34rem');
		expect(serviceFrame.style.getPropertyValue('--dt-min-width-compact')).toBe('32rem');
	});
});

describe('ScheduleTable — grid mode', () => {
	it('renders one semantic scheduled-service table with a caption and scoped headers', () => {
		const rows: ScheduleRow[] = [
			{
				kind: 'grid',
				route: '51',
				headsign: 'Nord',
				times: ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50'],
			},
		];
		const { container } = render(ScheduleTable, {
			props: {
				rows,
				mode: 'grid',
				locale: 'en',
				labels: GRID_LABELS,
				moreLabel: (n) => `+${n} more times`,
			},
		});
		const table = screen.getByRole('table', { name: GRID_LABELS.caption });
		expect(table).toBeInTheDocument();
		expect(within(table).getByRole('columnheader', { name: GRID_LABELS.route })).toHaveAttribute(
			'scope',
			'col',
		);
		expect(
			within(table).getByRole('columnheader', { name: GRID_LABELS.destination }),
		).toHaveAttribute('scope', 'col');
		expect(
			within(table).getByRole('columnheader', { name: GRID_LABELS.departures }),
		).toHaveAttribute('scope', 'col');
		expect(
			within(table).getByRole('columnheader', { name: GRID_LABELS.departures }),
		).toHaveAttribute('data-align', 'end');
		expect(
			within(table).getByRole('columnheader', { name: GRID_LABELS.departures }),
		).toHaveAttribute('data-numeric', 'true');
		expect(table.querySelector('tbody [data-column="departures"]')).toHaveAttribute(
			'data-align',
			'end',
		);
		expect(table.querySelector('tbody [data-column="departures"]')).toHaveAttribute(
			'data-numeric',
			'true',
		);
		expect(scheduleTableSource).toMatch(
			/\.stop-schedule-times\s*\{[^}]*justify-content:\s*flex-end/,
		);
		expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
		expect(screen.getByText('51')).toBeInTheDocument();
		expect(screen.getByText('Nord')).toBeInTheDocument();
		expect(container.querySelectorAll('time')).toHaveLength(6);
	});

	it('keeps every departure associated with its route row instead of a detached time grid', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'grid', route: '51', times: ['08:00', '08:10', '08:20', '08:30', '08:40', '08:50'] },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en', labels: GRID_LABELS },
		});
		const row = container.querySelector('tbody tr') as HTMLElement;
		expect(row).toHaveTextContent('51');
		expect(row).toHaveTextContent('08:00');
		expect(row).toHaveTextContent('08:50');
	});

	it('caps the shown times and prints the honest "+N more" overflow note via moreLabel', () => {
		// 32 times, cap 30 → 30 shown + a "+2 more times" note.
		const times = Array.from({ length: 32 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
		const rows: ScheduleRow[] = [{ kind: 'grid', route: '80', times }];
		const { container } = render(ScheduleTable, {
			props: {
				rows,
				mode: 'grid',
				locale: 'en',
				labels: GRID_LABELS,
				cap: 30,
				moreLabel: (n) => `+${n} more times`,
			},
		});
		// Exactly 30 time cells rendered (the cap), not all 32.
		expect(container.querySelectorAll('.stop-schedule-time').length).toBe(30);
		// The remainder is carried by the honest note.
		expect(screen.getByText('+2 more times')).toBeInTheDocument();
	});

	it('states an honest per-route AbsentValue when a listed route has NO times', () => {
		const rows: ScheduleRow[] = [{ kind: 'grid', route: '99', headsign: 'Vide', times: [] }];
		render(ScheduleTable, {
			props: { rows, mode: 'grid', locale: 'en', labels: GRID_LABELS },
		});
		// The route row remains in the schedule and its departure cell states the gap.
		expect(screen.getByText('99')).toBeInTheDocument();
		const chip = document.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('not enough readings yet');
	});
});

describe('ScheduleTable — board mode', () => {
	it('renders live departures as a semantic schedule table', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 },
		];
		const { container } = render(ScheduleTable, {
			props: {
				rows,
				mode: 'board',
				locale: 'en',
				labels: BOARD_LABELS,
				delayCopy: DELAY_COPY,
			},
		});
		const table = screen.getByRole('table', { name: BOARD_LABELS.caption });
		scheduleChassis(container, BOARD_LABELS.caption, 'board');
		expect(
			within(table).getByRole('columnheader', { name: BOARD_LABELS.route }),
		).toBeInTheDocument();
		expect(
			within(table).getByRole('columnheader', { name: BOARD_LABELS.departure }),
		).toHaveAttribute('data-align', 'end');
		expect(
			within(table).getByRole('columnheader', { name: BOARD_LABELS.departure }),
		).toHaveAttribute('data-numeric', 'true');
		expect(table.querySelector('tbody [data-column="departure"]')).toHaveAttribute(
			'data-align',
			'end',
		);
		expect(table.querySelector('tbody [data-column="departure"]')).toHaveAttribute(
			'data-numeric',
			'true',
		);
		expect(
			within(table).getByRole('columnheader', { name: BOARD_LABELS.status }),
		).toBeInTheDocument();
	});

	it('tints each departure caption with the shared status fill AND a redundant glyph', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 4 }, // late
		];
		const { container } = render(ScheduleTable, {
			props: {
				rows,
				mode: 'board',
				locale: 'en',
				labels: BOARD_LABELS,
				delayCopy: DELAY_COPY,
				routeFallback: 'Line',
			},
		});
		const late = container.querySelector('.stop-departure-delay') as HTMLElement;
		expect(late).not.toBeNull();
		expect(late.getAttribute('data-tone')).toBe('late');
		expect(late.getAttribute('style') ?? '').toContain('--dataviz-status-late');
		// Redundant glyph (▲ = behind schedule) + the plain-language delay label.
		expect(late.querySelector('.stop-departure-glyph')?.textContent).toBe('▲');
		expect(late.textContent).toContain('+4 min late');
	});

	it('bands a >=5 min departure to the SEVERE tone (its own severe fill)', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'board', route: '51', eta_utc: '2026-06-15T12:05:00Z', delay_min: 9 },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'board', locale: 'en', labels: BOARD_LABELS, delayCopy: DELAY_COPY },
		});
		const severe = container.querySelector('.stop-departure-delay') as HTMLElement;
		expect(severe.getAttribute('data-tone')).toBe('severe');
		expect(severe.getAttribute('style') ?? '').toContain('--dataviz-status-severe');
	});

	for (const [locale, unknownCopy] of [
		['en', 'Realtime unavailable'],
		['fr', 'Temps réel indisponible'],
	] as const) {
		it(`renders truthful localized unknown copy for a null delay (${locale})`, () => {
			const rows: ScheduleRow[] = [
				{ kind: 'board', route: '80', eta_utc: '2026-06-15T12:08:00Z', delay_min: null },
			];
			const { container } = render(ScheduleTable, {
				props: {
					rows,
					mode: 'board',
					locale,
					labels: BOARD_LABELS,
					delayCopy: detailCopy[locale].next,
				},
			});
			const none = container.querySelector('.stop-departure-delay') as HTMLElement;
			expect(none.getAttribute('data-tone')).toBe('none');
			expect(none.getAttribute('style') ?? '').not.toContain('--dataviz-status');
			expect(none.querySelector('.stop-departure-glyph')).toBeNull();
			expect(none).toHaveTextContent(unknownCopy);
			expect(none).not.toHaveTextContent(detailCopy[locale].next.onTime);
		});
	}

	it('renders the route fallback label when a departure has no route code', () => {
		const rows: ScheduleRow[] = [{ kind: 'board', eta_utc: '2026-06-15T12:08:00Z', delay_min: 0 }];
		const { container } = render(ScheduleTable, {
			props: {
				rows,
				mode: 'board',
				locale: 'en',
				labels: BOARD_LABELS,
				delayCopy: DELAY_COPY,
				routeFallback: 'Line',
			},
		});
		const route = container.querySelector('.stop-departure-route') as HTMLElement;
		expect(route.textContent).toBe('Line');
	});
});

describe('ScheduleTable — service mode', () => {
	it('renders planned line periods in the same semantic table chassis', () => {
		const rows: ScheduleRow[] = [
			{ kind: 'service', period: 'AM peak', window: '06:00–09:00', headway: '6.0 min' },
			{ kind: 'service', period: 'Midday', window: '09:00–15:00', headway: null },
		];
		const { container } = render(ScheduleTable, {
			props: { rows, mode: 'service', locale: 'en', labels: SERVICE_LABELS },
		});

		const table = screen.getByRole('table', { name: SERVICE_LABELS.caption });
		scheduleChassis(container, SERVICE_LABELS.caption, 'service');
		expect(within(table).getAllByRole('row')).toHaveLength(3);
		expect(
			within(table).getByRole('columnheader', { name: SERVICE_LABELS.period }),
		).toBeInTheDocument();
		expect(
			within(table).getByRole('columnheader', { name: SERVICE_LABELS.window }),
		).toHaveAttribute('data-numeric', 'true');
		expect(
			within(table).getByRole('columnheader', { name: SERVICE_LABELS.headway }),
		).toHaveAttribute('data-numeric', 'true');
		expect(table.querySelector('tbody [data-column="period"]')).toHaveAttribute(
			'data-align',
			'start',
		);
		expect(table.querySelector('tbody [data-column="window"]')).toHaveAttribute(
			'data-align',
			'end',
		);
		expect(table.querySelector('tbody [data-column="headway"]')).toHaveAttribute(
			'data-align',
			'end',
		);
		expect(within(table).getByText('AM peak')).toBeInTheDocument();
		expect(within(table).getByText('6.0 min')).toBeInTheDocument();
		expect(table.querySelectorAll('[data-slot="absent-value"]')).toHaveLength(1);
	});
});
