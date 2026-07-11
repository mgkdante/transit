import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { HotspotLadderResult } from '../selectors/hotspotLadder';
import { copy as COPY } from '../hotspots.copy';
import HotspotSection from './HotspotSection.svelte';

const chartScrollLabel = 'Faire défiler horizontalement le graphique Lignes';

const ladder = {
	spec: {
		kind: 'magnitude-bars',
		mark: 'lollipop',
		title: 'Pires lignes',
		locale: 'fr',
		domain: [0, 100],
		unit: '%',
		xLabel: 'Taux de retards graves',
		rows: [
			{
				key: 'route-51',
				label: 'Ligne 51',
				value: 40,
				severity: 'high',
				href: '/lines/51',
			},
		],
		sort: 'given',
		scale: 'severity',
	},
	total: 1,
	shown: 1,
} satisfies HotspotLadderResult;

const tray = [
	{
		key: 'stop-S2',
		title: 'Arrêt lié',
		type: 'Arrêt',
		id: 'S2',
		observationCount: 12,
		href: '/stop/S2',
		ariaLabel: 'Voir le détail de Arrêt lié',
	},
	{
		key: 'other-X1',
		title: 'Élément sans lien',
		type: 'Autre',
		id: 'X1',
		observationCount: null,
		href: null,
		ariaLabel: 'Voir le détail de Élément sans lien',
	},
	{
		key: 'other-X2',
		title: 'Zéro servi',
		type: 'Autre',
		id: 'X2',
		observationCount: 0,
		href: null,
		ariaLabel: 'Voir le détail de Zéro servi',
	},
] as const;

const info = {
	tip: 'Définition du taux de retards graves',
	href: '/fr/metrics#severe',
	label: 'À propos du taux de retards graves',
	linkLabel: 'Voir la méthodologie',
};

function renderSection() {
	return render(HotspotSection, {
		props: {
			heading: 'Pires points',
			ladder,
			tray,
			windowCaption: 'Classement sur la dernière journée de service.',
			chartScrollLabel,
			info,
			locale: 'fr',
			copy: COPY.fr,
		},
	});
}

function cssRule(source: string, selector: RegExp): string {
	return source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, selector.flags))?.[1] ?? '';
}

describe('HotspotSection evidence presentation', () => {
	it('localizes a semantic evidence table and distinguishes linked, absent, and zero rows', () => {
		const { container } = renderSection();
		const table = container.querySelector(
			'table[data-slot="hotspot-tray-table"]',
		) as HTMLTableElement;
		expect(table).not.toBeNull();
		const headers = within(table)
			.getAllByRole('columnheader')
			.map((header) => header.textContent?.trim());
		expect(headers).toEqual(['Élément', 'Type / ID', 'Relevés']);
		expect(within(table).getByRole('link', { name: /Voir le détail/ })).toHaveAttribute(
			'href',
			'/stop/S2',
		);

		const nullRow = within(table)
			.getByText('Élément sans lien')
			.closest('tr') as HTMLTableRowElement;
		expect(within(nullRow).queryByRole('link')).toBeNull();
		expect(
			nullRow.querySelector('[data-slot="absent-value"][data-variant="inline"]'),
		).not.toBeNull();

		const zeroRow = within(table).getByText('Zéro servi').closest('tr') as HTMLTableRowElement;
		expect(zeroRow).toHaveTextContent('0');
		expect(zeroRow.querySelector('[data-slot="absent-value"]')).toBeNull();
	});

	it('keeps only the chart canvas inside the named keyboard-focusable viewport', () => {
		const { container } = renderSection();
		const viewport = within(container).getByRole('region', { name: chartScrollLabel });
		expect(viewport).toHaveAttribute('tabindex', '0');
		expect(viewport.children).toHaveLength(1);
		expect(viewport.firstElementChild).toHaveAttribute('data-slot', 'hotspot-chart-canvas');
		expect(viewport.querySelector('[data-slot="hotspot-window"]')).toBeNull();
		expect(viewport.querySelector('[data-slot="hotspot-tray-table"]')).toBeNull();
		expect(container.querySelector('[data-slot="hotspot-window"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="hotspot-tray-table"]')).not.toBeNull();
	});

	it('limits the 48rem chart floor and horizontal containment to the responsive viewport', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/hotspots/sections/HotspotSection.svelte'),
			'utf-8',
		);
		const mobileStart = source.indexOf('@media (max-width: 1023px)');
		expect(mobileStart).toBeGreaterThan(-1);
		const desktop = source.slice(0, mobileStart);
		const mobile = source.slice(mobileStart);
		expect(source.match(/min-width:\s*48rem/g)).toHaveLength(1);
		expect(source.indexOf('min-width: 48rem')).toBeGreaterThan(mobileStart);
		expect(cssRule(desktop, /\.hotspot-section/)).toMatch(/min-width:\s*0/);
		expect(cssRule(desktop, /\.hotspot-chart-viewport/)).toMatch(/overflow-x:\s*visible/);

		const viewportRule = cssRule(mobile, /\.hotspot-chart-viewport/);
		expect(viewportRule).toMatch(/max-width:\s*100%/);
		expect(viewportRule).toMatch(/overflow-x:\s*auto/);
		expect(viewportRule).toMatch(/scrollbar-width:\s*thin/);
		expect(viewportRule).toMatch(/overscroll-behavior-inline:\s*contain/);
		expect(viewportRule).toMatch(/touch-action:\s*pan-x pan-y/);
		expect(cssRule(mobile, /\.hotspot-chart-canvas/)).toMatch(/min-width:\s*48rem/);
		expect(cssRule(desktop, /\.hotspot-chart-viewport:focus-visible/)).toMatch(
			/outline:\s*2px solid var\(--ring\)/,
		);
		expect(cssRule(mobile, /\.hotspot-chart-shell::after/)).toMatch(/pointer-events:\s*none/);
	});
});
