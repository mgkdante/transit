import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { OffenderEvidenceRow } from '../selectors/offenderEvidence';
import { copy as COPY } from '../repeatOffenders.copy';
import RepeatOffenderEvidenceTable from './RepeatOffenderEvidenceTable.svelte';

const rows = [
	{
		key: 'trip-T1-11',
		title: 'Montagne / Sommet',
		href: '/fr/lignes/11',
		ariaLabel: 'Voir le détail de Montagne / Sommet',
		typeId: 'Voyage · T1',
		severeRate: '62 %',
		confidenceInterval: '56 %–70 %',
		recurrence: 'Sujet aux retards 5 jours sur 7 observés',
		averageDelay: '9,4 min',
		readings: '210',
	},
	{
		key: 'vehicle-null-',
		title: 'Élément sans lien',
		href: null,
		ariaLabel: 'Voir le détail de Élément sans lien',
		typeId: 'Véhicule · null',
		severeRate: null,
		confidenceInterval: null,
		recurrence: 'récurrence non consignée',
		averageDelay: null,
		readings: null,
	},
	{
		key: 'vehicle-zero-0',
		title: 'Zéro servi',
		href: null,
		ariaLabel: 'Voir le détail de Zéro servi',
		typeId: 'Véhicule · zero',
		severeRate: '0 %',
		confidenceInterval: '0 %–0 %',
		recurrence: 'Sujet aux retards 0 jour sur 7 observés',
		averageDelay: '0 min',
		readings: '0',
	},
] satisfies readonly OffenderEvidenceRow[];

describe('RepeatOffenderEvidenceTable', () => {
	it('renders localized semantic evidence with links, mobile labels, and honest nulls', () => {
		const { container } = render(RepeatOffenderEvidenceTable, {
			props: { rows, locale: 'fr', copy: COPY.fr },
		});
		const table = within(container).getByRole('table', {
			name: COPY.fr.evidenceTable.caption,
		});
		expect(table).toHaveAttribute('data-slot', 'offender-evidence-table');
		expect(table.parentElement).toHaveAttribute('data-responsive', 'stack');
		expect(table.parentElement).toHaveAttribute('data-stack-at', 'tablet');

		const columnHeaders = within(table).getAllByRole('columnheader');
		expect(
			columnHeaders.map((header) => ({
				text: header.textContent?.trim(),
				column: header.getAttribute('data-column'),
				align: header.getAttribute('data-align'),
				numeric: header.getAttribute('data-numeric'),
			})),
		).toEqual([
			{ text: 'Élément', column: 'item', align: 'start', numeric: null },
			{ text: 'Type / ID', column: 'type-id', align: 'start', numeric: null },
			{
				text: 'Taux de retards graves',
				column: 'severe-rate',
				align: 'end',
				numeric: 'true',
			},
			{ text: 'Récurrence', column: 'recurrence', align: 'start', numeric: null },
			{ text: 'Retard moyen', column: 'average-delay', align: 'end', numeric: 'true' },
			{ text: 'Relevés', column: 'readings', align: 'end', numeric: 'true' },
		]);
		expect(
			within(table)
				.getAllByRole('rowheader')
				.map((header) => header.textContent?.trim()),
		).toEqual(['Montagne / Sommet', 'Élément sans lien', 'Zéro servi']);
		expect(within(table).getByRole('link', { name: rows[0].ariaLabel })).toHaveAttribute(
			'href',
			'/fr/lignes/11',
		);

		const linkedRow = within(table).getByText(rows[0].title).closest('tr') as HTMLTableRowElement;
		expect(linkedRow).toHaveTextContent('IC à 95 % 56 %–70 %');
		const linkedCells = Array.from(linkedRow.querySelectorAll(':scope > th, :scope > td'));
		expect(linkedCells.map((cell) => cell.getAttribute('data-column'))).toEqual([
			'item',
			'type-id',
			'severe-rate',
			'recurrence',
			'average-delay',
			'readings',
		]);
		expect(linkedCells.map((cell) => cell.getAttribute('data-col'))).toEqual([
			'Élément',
			'Type / ID',
			'Taux de retards graves',
			'Récurrence',
			'Retard moyen',
			'Relevés',
		]);
		expect(linkedCells.map((cell) => cell.getAttribute('data-align'))).toEqual([
			'start',
			'start',
			'end',
			'start',
			'end',
			'end',
		]);
		expect(linkedCells.map((cell) => cell.getAttribute('data-numeric'))).toEqual([
			null,
			null,
			'true',
			null,
			'true',
			'true',
		]);
		for (const cell of linkedCells) {
			expect(cell.querySelectorAll(':scope > .data-table-cell-content')).toHaveLength(1);
			expect(cell.children).toHaveLength(1);
		}

		const nullRow = within(table).getByText(rows[1].title).closest('tr') as HTMLTableRowElement;
		expect(nullRow.querySelectorAll('[data-slot="absent-value"]')).toHaveLength(3);
		expect(within(nullRow).queryByRole('link')).toBeNull();

		const zeroRow = within(table).getByText(rows[2].title).closest('tr') as HTMLTableRowElement;
		expect(zeroRow.querySelector('[data-slot="absent-value"]')).toBeNull();
		expect(
			within(zeroRow.querySelector('[data-column="severe-rate"]') as HTMLElement).getByText('0 %'),
		).toBeInTheDocument();
		expect(
			within(zeroRow.querySelector('[data-column="average-delay"]') as HTMLElement).getByText(
				'0 min',
			),
		).toBeInTheDocument();
		expect(
			within(zeroRow.querySelector('[data-column="readings"]') as HTMLElement).getByText('0'),
		).toBeInTheDocument();
	});
});
