import { createRawSnippet, tick, type Component } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DataTable, { type DataTableColumn, type DataTableProps } from './DataTable.svelte';

interface Row {
	readonly id: string;
	readonly shift: string;
	readonly gap: number;
}

interface Labels {
	readonly shift: string;
	readonly gap: string;
}

const rows: readonly Row[] = [
	{ id: 'am', shift: 'Morning', gap: 8.5 },
	{ id: 'pm', shift: 'Evening', gap: 12.25 },
];

const shiftCell = createRawSnippet<[Row]>((getRow) => ({
	render: () => `<span>${getRow().shift}</span>`,
}));
const gapCell = createRawSnippet<[Row]>((getRow) => ({
	render: () => `<strong>${getRow().gap.toFixed(1)}</strong>`,
}));

const columns = (labels: Labels): readonly DataTableColumn<Row>[] => [
	{
		key: 'shift',
		header: labels.shift,
		rowHeader: true,
		width: '8rem',
		cell: shiftCell,
	},
	{ key: 'gap', header: labels.gap, numeric: true, cell: gapCell },
];

const RowDataTable = DataTable as unknown as Component<DataTableProps<Row>>;
const componentSource = readFileSync(
	resolve(process.cwd(), 'src/lib/components/data/DataTable.svelte'),
	'utf8',
);

const props = (labels: Labels = { shift: 'Shift', gap: 'Observed gap' }): DataTableProps<Row> => ({
	rows,
	columns: columns(labels),
	key: (row) => row.id,
	caption: 'Observed gaps',
});

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

describe('DataTable', () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders the generic semantic, wrapper, numeric, frame, and passthrough contract', () => {
		const { container } = render(RowDataTable, {
			props: {
				...props(),
				caption: '  Observed gaps  ',
				responsive: { mode: 'stack', at: 'compact' },
				frame: 'card',
				borderCollapse: 'separate',
				frameRadius: true,
				headerBand: 'wash',
				frameAttrs: {
					class: 'legacy-frame',
					'data-mode': 'grid',
				},
				tableAttrs: {
					class: 'legacy-table',
					'data-slot': 'direction-table',
					'data-published': true,
				},
			},
		});

		const table = screen.getByRole('table', { name: 'Observed gaps' });
		const frame = table.parentElement;
		expect(table.querySelectorAll('caption')).toHaveLength(1);
		expect(table.querySelector('caption')).toHaveClass('sr-only');
		expect(table.querySelector('caption')).toHaveTextContent('Observed gaps');
		expect(frame).toHaveClass('data-table-frame', 'legacy-frame');
		expect(frame).toHaveAttribute('data-mode', 'grid');
		expect(frame).toHaveAttribute('data-responsive', 'stack');
		expect(frame).toHaveAttribute('data-stack-at', 'compact');
		expect(frame).toHaveAttribute('data-frame', 'card');
		expect(frame).toHaveAttribute('data-collapse', 'separate');
		expect(frame).toHaveAttribute('data-frame-radius', 'true');
		expect(frame).toHaveAttribute('data-header-band', 'wash');
		expect(table).toHaveClass('data-table', 'legacy-table');
		expect(table).toHaveAttribute('data-slot', 'direction-table');
		expect(table).toHaveAttribute('data-published', 'true');

		const columnHeaders = Array.from(table.querySelectorAll('thead th'));
		expect(columnHeaders).toHaveLength(2);
		expect(columnHeaders.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
		expect(columnHeaders.map((header) => header.getAttribute('data-column'))).toEqual([
			'shift',
			'gap',
		]);
		expect(columnHeaders[0].getAttribute('style')).toContain('width: 8rem');

		const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
		for (const row of bodyRows) {
			const cells = Array.from(row.querySelectorAll(':scope > th, :scope > td'));
			expect(cells).toHaveLength(2);
			expect(cells[0].tagName).toBe('TH');
			expect(cells[0]).toHaveAttribute('scope', 'row');
			expect(cells[0]).toHaveAttribute('data-column', 'shift');
			expect(cells[0]).toHaveAttribute('data-col', 'Shift');
			expect(cells[1].tagName).toBe('TD');
			expect(cells[1]).toHaveAttribute('data-column', 'gap');
			expect(cells[1]).toHaveAttribute('data-col', 'Observed gap');
			expect(cells[1]).toHaveAttribute('data-align', 'end');
			expect(cells[1]).toHaveAttribute('data-numeric', 'true');

			for (const cell of cells) {
				expect(cell.querySelectorAll(':scope > .data-table-cell-content')).toHaveLength(1);
				expect(cell.children).toHaveLength(1);
			}
		}
		expect(container.querySelectorAll('tbody .data-table-cell-content')).toHaveLength(4);
	});

	it('reacts when localized caption and column headers change', async () => {
		const view = render(RowDataTable, { props: props() });
		const table = screen.getByRole('table', { name: 'Observed gaps' });

		expect(
			Array.from(
				table.querySelectorAll('tbody tr:first-child > th, tbody tr:first-child > td'),
			).map((cell) => cell.getAttribute('data-col')),
		).toEqual(['Shift', 'Observed gap']);

		await view.rerender({
			...props({ shift: 'Période', gap: 'Intervalle observé' }),
			caption: 'Intervalles observés',
		});

		const localized = screen.getByRole('table', { name: 'Intervalles observés' });
		expect(localized.querySelectorAll('caption')).toHaveLength(1);
		expect(
			Array.from(
				localized.querySelectorAll('tbody tr:first-child > th, tbody tr:first-child > td'),
			).map((cell) => cell.getAttribute('data-col')),
		).toEqual(['Période', 'Intervalle observé']);
	});

	it('rejects a caption whose trimmed value is empty', () => {
		expect(() =>
			render(RowDataTable, {
				props: { ...props(), caption: '   ' },
			}),
		).toThrow(/caption.+non-empty/i);
	});

	it('adds the labelled keyboard region only for real scroll overflow', async () => {
		const view = render(RowDataTable, {
			props: {
				...props(),
				caption: 'Scrollable observed gaps',
				responsive: {
					mode: 'scroll',
					minWidth: '42rem',
					minWidthCompact: '32rem',
				},
			},
		});
		const frame = view.container.querySelector<HTMLElement>('[data-slot="data-table-frame"]');
		expect(frame).not.toBeNull();
		expect(frame?.style.getPropertyValue('--dt-min-width')).toBe('42rem');
		expect(frame?.style.getPropertyValue('--dt-min-width-compact')).toBe('32rem');
		expect(frame).not.toHaveAttribute('role');
		expect(frame).not.toHaveAttribute('aria-label');
		expect(frame).not.toHaveAttribute('tabindex');

		let clientWidth = 300;
		let scrollWidth = 600;
		Object.defineProperties(frame!, {
			clientWidth: { configurable: true, get: () => clientWidth },
			scrollWidth: { configurable: true, get: () => scrollWidth },
		});
		const observer = observerFor(frame!);
		expect(observer).toBeDefined();
		observer?.trigger();
		await tick();

		expect(frame).toHaveAttribute('role', 'region');
		expect(frame).toHaveAttribute('aria-label', 'Scrollable observed gaps');
		expect(frame).toHaveAttribute('tabindex', '0');

		await view.rerender({
			...props(),
			caption: 'Scrollable observed gaps',
			responsive: {
				mode: 'scroll',
				minWidth: '42rem',
				minWidthCompact: '32rem',
				scrollLabel: 'Scroll sideways for every direction',
			},
		});
		expect(frame).toHaveAttribute('aria-label', 'Scroll sideways for every direction');

		clientWidth = 600;
		scrollWidth = 600;
		observer?.trigger();
		await tick();
		expect(frame).not.toHaveAttribute('role');
		expect(frame).not.toHaveAttribute('aria-label');
		expect(frame).not.toHaveAttribute('tabindex');
	});

	it('keeps the responsive card transformation scoped to the complete coverage frame dialect', () => {
		expect(componentSource).toMatch(
			/@media \(max-width: 28rem\) \{\s*\.data-table-frame\[data-responsive='stack'\]\[data-stack-at='compact'\]/,
		);
		expect(componentSource).toMatch(
			/@media \(max-width: 1023px\) \{\s*\.data-table-frame\[data-responsive='stack'\]\[data-stack-at='tablet'\]/,
		);
		expect(componentSource).not.toMatch(/\[data-stack-at='tablet'\]\[data-frame='card'\]\s*\{/);
		expect(componentSource).toMatch(
			/\[data-stack-at='tablet'\]\[data-frame='card'\]\[data-collapse='separate'\]\[data-frame-radius='true'\]/,
		);
		// S5-384 finding 3: fixed layout is the mechanism the separate-dialect
		// column widths depend on; nothing else pins it.
		expect(componentSource).toMatch(
			/\[data-collapse='separate'\] \.data-table \{[^}]*table-layout:\s*fixed/,
		);
		// S5-379 finding 1: the stacked pseudo-label mechanism itself. PR-2
		// deleted the last consumer-side pin on it; deleting BOTH ::before
		// blocks previously left every stacked row label-less with zero tests
		// noticing. One pin per stack dialect.
		expect(
			componentSource.match(/:is\(th, td\)::before \{[^}]*content:\s*attr\(data-col\)/g),
		).toHaveLength(2);
	});

	it('keeps unapproved row passthrough out of the frozen API', () => {
		expect(componentSource).not.toMatch(/\browAttrs\b/);
	});
});
