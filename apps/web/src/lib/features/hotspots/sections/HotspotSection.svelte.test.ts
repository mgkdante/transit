import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		rowLabel: 'Ligne',
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

const resizeObservers: ResizeObserverStub[] = [];

class ResizeObserverStub {
	readonly targets = new Set<Element>();
	readonly observe = vi.fn((target: Element) => this.targets.add(target));
	readonly unobserve = vi.fn((target: Element) => this.targets.delete(target));
	readonly disconnect = vi.fn(() => this.targets.clear());

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}

	trigger(): void {
		this.callback([], this as unknown as ResizeObserver);
	}
}

function mockHorizontalLayout(
	element: HTMLElement,
	initial: { clientWidth: number; scrollWidth: number; scrollLeft?: number },
) {
	// happy-dom does not evaluate the component media query; model its mobile/tablet
	// `overflow-x: auto` mode so the test can exercise real scroll-range measurement.
	element.style.overflowX = 'auto';
	let clientWidth = initial.clientWidth;
	let scrollWidth = initial.scrollWidth;
	let scrollLeft = initial.scrollLeft ?? 0;
	Object.defineProperties(element, {
		clientWidth: { configurable: true, get: () => clientWidth },
		scrollWidth: { configurable: true, get: () => scrollWidth },
		scrollLeft: {
			configurable: true,
			get: () => scrollLeft,
			set: (value: number) => {
				scrollLeft = value;
			},
		},
	});

	return {
		resize(next: { clientWidth: number; scrollWidth: number }): void {
			clientWidth = next.clientWidth;
			scrollWidth = next.scrollWidth;
		},
		scrollTo(next: number): void {
			scrollLeft = next;
		},
	};
}

function observerFor(target: Element): ResizeObserverStub | undefined {
	return resizeObservers.find((observer) => observer.targets.has(target));
}

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
	beforeEach(() => {
		resizeObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

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

	it('keeps a non-overflowing chart viewport out of the tab order and accessibility tree', () => {
		const { container } = renderSection();
		const viewport = container.querySelector<HTMLElement>(
			'[data-slot="hotspot-chart-viewport"]',
		) as HTMLElement;
		expect(viewport).not.toBeNull();
		expect(viewport).not.toHaveAttribute('role');
		expect(viewport).not.toHaveAttribute('aria-label');
		expect(viewport).not.toHaveAttribute('tabindex');
		expect(viewport.children).toHaveLength(1);
		expect(viewport.firstElementChild).toHaveAttribute('data-slot', 'hotspot-chart-canvas');
		expect(viewport.querySelector('[data-slot="hotspot-window"]')).toBeNull();
		expect(viewport.querySelector('[data-slot="hotspot-tray-table"]')).toBeNull();
		expect(container.querySelector('[data-slot="hotspot-window"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="hotspot-tray-table"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="hotspot-chart-shell"]')).toHaveAttribute(
			'data-more-end',
			'false',
		);
	});

	it('marks the chart viewport as a data-card-interactive boundary', () => {
		const { container } = renderSection();
		const viewport = container.querySelector('[data-slot="hotspot-chart-viewport"]');

		expect(viewport).toHaveAttribute('data-card-interactive');
	});

	it('adds keyboard semantics only for real overflow and hides the cue at the right edge', async () => {
		const view = renderSection();
		const viewport = view.container.querySelector<HTMLElement>(
			'[data-slot="hotspot-chart-viewport"]',
		) as HTMLElement;
		const shell = view.container.querySelector('[data-slot="hotspot-chart-shell"]');
		const layout = mockHorizontalLayout(viewport, { clientWidth: 320, scrollWidth: 768 });
		const observer = observerFor(viewport);
		expect(observer).toBeDefined();
		observer?.trigger();
		await tick();

		expect(within(view.container).getByRole('region', { name: chartScrollLabel })).toBe(viewport);
		expect(viewport).toHaveAttribute('tabindex', '0');
		expect(shell).toHaveAttribute('data-more-end', 'true');

		layout.scrollTo(448);
		await fireEvent.scroll(viewport);
		await tick();
		expect(shell).toHaveAttribute('data-more-end', 'false');

		layout.resize({ clientWidth: 768, scrollWidth: 768 });
		observer?.trigger();
		await tick();
		expect(viewport).not.toHaveAttribute('role');
		expect(viewport).not.toHaveAttribute('aria-label');
		expect(viewport).not.toHaveAttribute('tabindex');
		expect(shell).toHaveAttribute('data-more-end', 'false');

		await view.unmount();
		expect(observer?.disconnect).toHaveBeenCalledTimes(1);
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
		expect(cssRule(mobile, /\.hotspot-chart-shell\[data-more-end='true'\]::after/)).toMatch(
			/pointer-events:\s*none/,
		);
	});
});
