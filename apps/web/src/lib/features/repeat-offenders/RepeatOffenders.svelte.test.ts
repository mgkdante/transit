import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepeatOffenders as RepeatOffendersData, IsoUtc } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import type { ChartDatumPopoverModel, MagnitudeDatum } from '$lib/components/dataviz/chart';

// Mock the SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the ?grain
// / ?n seed AND the round-trip mirror are testable (the HotspotsBoard urlseed pattern).
// getLocale stays REAL → 'en'; $lib/i18n + $lib/nav stay REAL so the deep links resolve
// to genuine /lines/<id> hrefs.
let mockUrl = new URL('http://localhost/repeat-offenders');
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		mockUrl = new URL(u, 'http://localhost');
	}),
);
const navigate = vi.hoisted(() => vi.fn());
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mockUrl;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ goto: navigate, replaceState }));

const currentLocale = vi.hoisted(() => ({ value: 'en' as 'en' | 'fr' }));
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale.value };
});

const { payload } = vi.hoisted(() => ({
	payload: { current: null as RepeatOffendersData | null },
}));
const capturedLadders = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('$lib/v1', () => ({ getRepeatOffenders: vi.fn() }));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: payload.current,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

vi.mock('./selectors/offenderLadder', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./selectors/offenderLadder')>();
	return {
		...actual,
		selectOffenderLadder: (...args: Parameters<typeof actual.selectOffenderLadder>) => {
			const result = actual.selectOffenderLadder(...args);
			capturedLadders.current.push(result);
			return result;
		},
	};
});

import RepeatOffenders from './RepeatOffenders.svelte';
import { copy as repeatCopy } from './repeatOffenders.copy';

const GENERATED = '2026-06-20T02:00:00Z' as IsoUtc;
let reconciliationIntersectionCallback: IntersectionObserverCallback | undefined;

class ReconciliationIntersectionObserver {
	readonly root = null;
	readonly rootMargin = '';
	readonly thresholds: readonly number[] = [];

	constructor(callback: IntersectionObserverCallback) {
		reconciliationIntersectionCallback = callback;
	}

	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

// A populated week ladder (one trip + one vehicle ranked entry + one tray) + a
// populated month ladder, so the grain rail renders and a seed to a different grain
// is observable.
function seed(): RepeatOffendersData {
	return {
		generated_utc: GENERATED,
		offenders: [],
		by_grain: [
			{
				grain: 'week',
				window_days: 7,
				total_ranked_trips: 1,
				total_ranked_vehicles: 1,
				entries: [
					{
						rank: 1,
						type: 'trip',
						id: 'T1',
						route: '11',
						route_name: 'Montagne / Sommet',
						severe_pct: 62,
						observation_count: 210,
						wilson_lo: 30,
						wilson_hi: 44,
						recurrence_days: 5,
						observed_days: 7,
						avg_delay_min: 9.4,
						severity: 'critical',
					},
					{
						rank: 1,
						type: 'vehicle',
						id: '42010',
						route: '55',
						route_name: 'Boulevard',
						severe_pct: 48,
						observation_count: 180,
						recurrence_days: 4,
						observed_days: 6,
						severity: 'high',
					},
				],
				tray: [
					{
						rank: null,
						type: 'vehicle',
						id: '99999',
						route: '80',
						route_name: 'Parc',
						severe_pct: 20,
						observation_count: 12,
					},
				],
			},
			{
				grain: 'month',
				window_days: 30,
				total_ranked_trips: 1,
				entries: [
					{
						rank: 1,
						type: 'trip',
						id: 'T9',
						route: '161',
						route_name: 'Van Horne',
						severe_pct: 55,
						observation_count: 600,
						recurrence_days: 18,
						observed_days: 26,
					},
				],
				tray: [],
			},
		],
	} satisfies RepeatOffendersData as RepeatOffendersData;
}

function card(container: HTMLElement, id: string): HTMLElement {
	return container.querySelector(`[data-toc="${id}"]`) as HTMLElement;
}

function cardTrigger(container: HTMLElement, id: string): HTMLButtonElement {
	return card(container, id).querySelector(
		'h2.section-heading > button.section-header',
	) as HTMLButtonElement;
}

function resetRepeatState(): void {
	for (const key of ['repeat-card-worst', 'repeat-card-trips', 'repeat-card-vehicles']) {
		sessionStorage.removeItem(`transit.persisted:${key}`);
	}
	sessionStorage.removeItem('transit.persisted:repeat-offenders-controls');
	sessionStorage.removeItem('transit.persisted:repeat-offenders-toc');
	quietModeStore.resetForTest();
}

type CapturedMagnitudeDatum = MagnitudeDatum & {
	readonly tapPopover?: ChartDatumPopoverModel;
};

function capturedRow(key: string): CapturedMagnitudeDatum {
	const row = (
		capturedLadders.current as Array<{
			spec: { kind: string; rows?: readonly CapturedMagnitudeDatum[] };
		}>
	)
		.flatMap((result) => (result.spec.kind === 'magnitude-bars' ? (result.spec.rows ?? []) : []))
		.find((candidate) => candidate.key === key);
	if (!row) throw new Error(`Expected captured magnitude row ${key}`);
	return row;
}

describe('RepeatOffenders — approved analytical article', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/repeat-offenders');
		navigate.mockClear();
		replaceState.mockClear();
		currentLocale.value = 'en';
		capturedLadders.current = [];
		payload.current = seed();
		resetRepeatState();
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(resetRepeatState);

	it('renders one article h1, the exact two quiet controls, and three simultaneous cards', () => {
		const { container } = render(RepeatOffenders);
		expect(screen.getAllByRole('heading', { level: 1, name: 'Repeat offenders' })).toHaveLength(1);
		const controls = screen.getByTestId('quiet-mode-controls');
		expect(within(controls).getAllByRole('button')).toHaveLength(2);
		expect(within(controls).getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell"]')).not.toBeNull();

		const cards = ['repeat-worst', 'repeat-trips', 'repeat-vehicles'].map((id) =>
			card(container, id),
		);
		expect(cards.every(Boolean)).toBe(true);
		expect(cards.map((element) => element.getAttribute('data-header-variant'))).toEqual([
			'article-summary',
			'article-summary',
			'article-summary',
		]);
		expect(
			cards.map((element) => element.querySelector('[data-slot="badge"]')?.textContent?.trim()),
		).toEqual(['01', '02', '03']);
		expect(container.querySelector('[role="tablist"]')).toBeNull();
		expect(container.querySelector('[role="tab"]')).toBeNull();
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		expect(header).toHaveTextContent('AS OF');
		expect(header).toHaveTextContent('3 sections');
		expect(header).not.toHaveTextContent('Recurrence read over the latest trailing week');
	});

	it('puts window, number shown, context, and contents in one independently persisted rail', async () => {
		const entries = Array.from({ length: 6 }, (_, index) => ({
			rank: index + 1,
			type: 'trip' as const,
			id: `T${index}`,
			route: `${index}`,
			route_name: `Line ${index}`,
			severe_pct: 60 - index,
			observation_count: 100,
			recurrence_days: 4,
			observed_days: 7,
		}));
		payload.current = {
			...seed(),
			by_grain: [
				{
					grain: 'week',
					window_days: 7,
					total_ranked_trips: 6,
					entries,
					tray: [],
				},
				seed().by_grain![1]!,
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		const { container } = render(RepeatOffenders);
		expect(container.querySelectorAll('[data-slot="surface-rail-mobile"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="toc-pill"]')).toBeNull();
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const filters = within(desktop).getByRole('button', { name: 'View controls' });
		const toc = within(desktop).getByRole('button', { name: 'On this page' });
		expect(within(desktop).getByRole('radiogroup', { name: 'Window' })).toBeInTheDocument();
		expect(within(desktop).getByRole('radiogroup', { name: 'Show' })).toBeInTheDocument();
		expect(desktop.querySelector('[data-slot="active-window"]')).not.toBeNull();

		await fireEvent.click(filters);
		expect(filters).toHaveAttribute('aria-expanded', 'false');
		expect(toc).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:repeat-offenders-controls')).toBe('false');
		await fireEvent.click(toc);
		expect(sessionStorage.getItem('transit.persisted:repeat-offenders-toc')).toBe('false');
	});

	it('keeps both week and month visible while disabling and describing the unavailable grain', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [seed().by_grain![0]!],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		const { container } = render(RepeatOffenders);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const windowPicker = within(rail).getByRole('radiogroup', { name: 'Window' });
		const week = within(windowPicker).getByRole('radio', { name: 'Week' });
		const month = within(windowPicker).getByRole('radio', { name: 'Month' });
		expect(week).toBeEnabled();
		expect(month).toBeDisabled();
		const describedBy = month.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(
			/not enough readings yet/i,
		);
	});

	it('keeps conditional cards and contents destinations in the same fixed-number registry', () => {
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		const { container } = render(RepeatOffenders);
		expect(card(container, 'repeat-worst')).not.toBeNull();
		expect(card(container, 'repeat-trips')).not.toBeNull();
		expect(container.querySelector('[data-toc="repeat-vehicles"]')).toBeNull();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getByRole('button', { name: 'Worst repeat offender' })).toBeInTheDocument();
		expect(within(rail).getByRole('button', { name: 'Trips' })).toBeInTheDocument();
		expect(within(rail).queryByRole('button', { name: 'Vehicles' })).toBeNull();
		expect(card(container, 'repeat-trips').querySelector('[data-slot="badge"]')).toHaveTextContent(
			'02',
		);
	});

	it('Collapse all and Expand all synchronize both rail disclosures and every card', async () => {
		const { container } = render(RepeatOffenders);
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(desktop).getByRole('button', { name: 'View controls' }),
			within(desktop).getByRole('button', { name: 'On this page' }),
		];
		const ids = ['repeat-worst', 'repeat-trips', 'repeat-vehicles'];

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');
	});

	it('Always start collapsed closes both rail disclosures and every current card', async () => {
		const { container } = render(RepeatOffenders);
		const desktop = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(desktop).getByRole('button', { name: 'View controls' }),
			within(desktop).getByRole('button', { name: 'On this page' }),
		];

		await fireEvent.click(screen.getByTestId('quiet-mode-remember'));

		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ['repeat-worst', 'repeat-trips', 'repeat-vehicles']) {
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
		}
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
	});

	it('restores independent rail choices across a full same-tab remount', async () => {
		const first = render(RepeatOffenders);
		const firstDesktop = first.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const firstControls = within(firstDesktop).getByRole('button', { name: 'View controls' });
		const firstToc = within(firstDesktop).getByRole('button', { name: 'On this page' });
		await fireEvent.click(firstControls);
		expect(firstControls).toHaveAttribute('aria-expanded', 'false');
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');
		first.unmount();

		const second = render(RepeatOffenders);
		const secondDesktop = second.container.querySelector(
			'[data-slot="surface-rail"]',
		) as HTMLElement;
		await waitFor(() =>
			expect(within(secondDesktop).getByRole('button', { name: 'View controls' })).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
		expect(within(secondDesktop).getByRole('button', { name: 'On this page' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
	});

	it('a TOC jump opens only its closed Trips card before scrolling', async () => {
		const { container } = render(RepeatOffenders);
		const statesAtScroll: Array<{ trips: string | null; worst: string | null }> = [];
		const scrollIntoView = vi.fn(() => {
			statesAtScroll.push({
				trips: cardTrigger(container, 'repeat-trips').getAttribute('aria-expanded'),
				worst: cardTrigger(container, 'repeat-worst').getAttribute('aria-expanded'),
			});
		});
		Element.prototype.scrollIntoView = scrollIntoView;
		await fireEvent.click(cardTrigger(container, 'repeat-worst'));
		await fireEvent.click(cardTrigger(container, 'repeat-trips'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await fireEvent.click(within(rail).getByRole('button', { name: 'Trips' }));
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
		expect(statesAtScroll).toEqual([{ trips: 'true', worst: 'false' }]);
	});

	it('applies remembered collapsed mode to a Vehicle card that mounts after a grain change', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		const { container } = render(RepeatOffenders);
		expect(container.querySelector('[data-toc="repeat-vehicles"]')).toBeNull();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const week = within(rail)
			.getAllByRole('radio')
			.find((radio) => radio.textContent?.trim() === 'Week');
		expect(week).toBeDefined();
		await fireEvent.click(week!);

		await waitFor(() => {
			expect(card(container, 'repeat-vehicles')).not.toBeNull();
			expect(cardTrigger(container, 'repeat-vehicles')).toHaveAttribute('aria-expanded', 'false');
		});
	});

	it('reconciles an active Vehicle destination to the nearest surviving Trip card', async () => {
		reconciliationIntersectionCallback = undefined;
		vi.stubGlobal('IntersectionObserver', ReconciliationIntersectionObserver);

		try {
			const { container } = render(RepeatOffenders);
			await waitFor(() => expect(reconciliationIntersectionCallback).toBeDefined());
			await act(() =>
				reconciliationIntersectionCallback!(
					[
						{
							isIntersecting: true,
							target: card(container, 'repeat-vehicles'),
						} as unknown as IntersectionObserverEntry,
					],
					{} as IntersectionObserver,
				),
			);
			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			expect(within(rail).getByRole('button', { name: 'Vehicles' })).toHaveAttribute(
				'aria-current',
				'location',
			);

			await fireEvent.click(within(rail).getByRole('radio', { name: 'Month' }));
			await waitFor(() => {
				expect(container.querySelector('[data-toc="repeat-vehicles"]')).toBeNull();
				expect(within(rail).getByRole('button', { name: 'Trips' })).toHaveAttribute(
					'aria-current',
					'location',
				);
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('builds an opt-in mobile popover with localized recurrence evidence and only an explicit action', () => {
		render(RepeatOffenders);
		expect(capturedRow('trip-T1-11').tapPopover).toEqual({
			key: 'trip-T1-11',
			heading: 'Montagne / Sommet',
			meta: 'Trip · T1',
			rows: [
				{ label: 'Severe-delay rate', value: '62%' },
				{ label: '95% CI', value: '56%–70%' },
				{ label: 'Recurrence', value: 'Late-prone on 5 of 7 observed days' },
				{ label: 'Average delay', value: '9.4 min' },
				{ label: 'Readings', value: '210' },
			],
			action: {
				href: '/lines/11',
				label: 'View line',
				ariaLabel: 'View detail for Montagne / Sommet',
			},
		});
	});

	it('keeps null evidence absent, served zero honest, and an unmapped row actionless', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [
				{
					grain: 'week',
					entries: [
						{
							rank: 1,
							type: 'trip',
							id: 'T0',
							route: null,
							severe_pct: null,
							observation_count: 0,
							avg_delay_min: null,
						},
					],
					tray: [],
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		render(RepeatOffenders);
		expect(capturedRow('trip-T0-').tapPopover).toEqual({
			key: 'trip-T0-',
			heading: 'Item T0',
			meta: 'Trip · T0',
			rows: [
				{ label: 'Recurrence', value: 'recurrence not recorded' },
				{ label: 'Readings', value: '0' },
			],
		});
	});

	it('uses the approved bilingual chart-popover vocabulary', () => {
		expect(repeatCopy.en.chart.popover).toEqual({
			recurrence: 'Recurrence',
			averageDelay: 'Average delay',
			readings: 'Readings',
			viewLine: 'View line',
		});
		expect(repeatCopy.fr.chart.popover).toEqual({
			recurrence: 'Récurrence',
			averageDelay: 'Retard moyen',
			readings: 'Relevés',
			viewLine: 'Voir la ligne',
		});
	});

	it('keeps the exact approved bilingual article, rail, and card copy', () => {
		expect(repeatCopy.en.article).toEqual({
			watermark: 'Repeat',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['offenders', 'trips', 'vehicles', 'recurrence'],
			sections: expect.any(Function),
		});
		expect(repeatCopy.fr.article).toEqual({
			watermark: 'Récidive',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['récidivistes', 'voyages', 'véhicules', 'récurrence'],
			sections: expect.any(Function),
		});
		expect(repeatCopy.en.rail).toEqual({
			label: 'View & contents',
			open: 'Open view controls and contents',
			close: 'Close view controls and contents',
			controls: 'View controls',
			toc: 'On this page',
			counterPrefix: 'SEC',
		});
		expect(repeatCopy.fr.rail).toEqual({
			label: 'Vue et sommaire',
			open: 'Ouvrir les commandes et le sommaire',
			close: 'Fermer les commandes et le sommaire',
			controls: 'Commandes de vue',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		});
		expect(repeatCopy.en.cards).toEqual({
			worst: {
				title: 'Worst repeat offender',
				subtitle: 'The current worst repeat offender, its severe rate, and its streak',
			},
			trips: {
				title: 'Trips',
				subtitle: 'Trips ranked by repeated severe lateness across observed days',
			},
			vehicles: {
				title: 'Vehicles',
				subtitle: 'Vehicles ranked by repeated severe lateness across observed days',
			},
		});
		expect(repeatCopy.fr.cards).toEqual({
			worst: {
				title: 'Pire récidiviste',
				subtitle: 'Le pire récidiviste actuel, son taux de retards graves et sa série',
			},
			trips: {
				title: 'Voyages',
				subtitle: 'Voyages classés selon la répétition des retards graves sur les jours observés',
			},
			vehicles: {
				title: 'Véhicules',
				subtitle: 'Véhicules classés selon la répétition des retards graves sur les jours observés',
			},
		});
	});

	it('keeps the French recurrence sentence grammatical for singular and plural days', () => {
		expect(repeatCopy.fr.recurrence.naturalFrequency(1, 1)).toBe(
			'Sujet aux retards 1 jour sur 1 observé',
		);
		expect(repeatCopy.fr.recurrence.naturalFrequency(2, 3)).toBe(
			'Sujet aux retards 2 jours sur 3 observés',
		);
	});

	it('keeps a touch datum activation inside the card and exposes only the popover action', async () => {
		const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
		const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
		const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
		Object.defineProperty(Element.prototype, 'animate', {
			configurable: true,
			value: vi.fn(() => ({
				cancel: vi.fn(),
				currentTime: 0,
				effect: null,
				onfinish: null,
				playState: 'finished',
			})),
		});

		try {
			const { container } = render(RepeatOffenders);
			const tripsCard = card(container, 'repeat-trips');
			const overlay = await waitFor(() => {
				const element = tripsCard.querySelector<SVGRectElement>('rect.lc-tooltip-rect');
				if (!element) throw new Error('Expected the real LayerChart row overlay');
				return element;
			});
			const initialHref = window.location.href;

			await fireEvent(
				overlay,
				new PointerEvent('click', {
					bubbles: true,
					cancelable: true,
					clientX: 120,
					clientY: 240,
					pointerType: 'touch',
				}),
			);

			const dialog = await screen.findByRole('dialog', { name: 'Montagne / Sommet' });
			expect(within(dialog).getAllByRole('link')).toHaveLength(1);
			expect(within(dialog).getByRole('link', { name: /View detail/ })).toHaveAttribute(
				'href',
				'/lines/11',
			);
			expect(navigate).not.toHaveBeenCalled();
			expect(window.location.href).toBe(initialHref);
			expect(cardTrigger(container, 'repeat-trips')).toHaveAttribute('aria-expanded', 'true');
		} finally {
			width.mockRestore();
			height.mockRestore();
			if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
			else Reflect.deleteProperty(Element.prototype, 'animate');
			document.querySelectorAll('[role="dialog"]').forEach((element) => element.remove());
		}
	});

	it('renders the legacy fallback as one Worst card with one matching contents entry', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '11',
					route: '11',
					route_name: 'Montagne / Sommet',
					avg_delay_min: 12.4,
					recurrence: 'most weekday afternoons',
					severity: 'critical',
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		const { container } = render(RepeatOffenders);
		expect(card(container, 'repeat-worst')).not.toBeNull();
		expect(container.querySelector('[data-toc="repeat-trips"]')).toBeNull();
		expect(container.querySelector('[data-toc="repeat-vehicles"]')).toBeNull();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getAllByRole('button', { name: 'Worst repeat offender' })).toHaveLength(1);
		expect(within(card(container, 'repeat-worst')).getByRole('link')).toHaveAttribute(
			'href',
			'/lines/11',
		);
	});

	it('keeps the published-empty state outside cards and removes the combined rail', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [{ grain: 'week', entries: [], tray: [] }],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		const { container } = render(RepeatOffenders);
		expect(container.querySelector('[data-slot="offenders-empty"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="surface-rail"]')).toBeNull();
		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		expect(container.querySelectorAll('[data-toc^="repeat-"]')).toHaveLength(0);
	});
});

describe('RepeatOffenders — S14 re-seat (by_grain ladders)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/repeat-offenders');
		navigate.mockClear();
		replaceState.mockClear();
		currentLocale.value = 'en';
		capturedLadders.current = [];
		payload.current = seed();
		resetRepeatState();
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(resetRepeatState);

	it('renders the head and the worst-first recurrence ladder (a lollipop Chart, NOT a /worst bar)', () => {
		const { container } = render(RepeatOffenders);
		expect(screen.getByRole('heading', { name: 'Repeat offenders' })).toBeInTheDocument();
		// Trip and vehicle ladders are simultaneous article cards. The week grain has one
		// ranked entry per kind, so the two cards expose two sr-only rows in total.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(2);
		expect(card(container, 'repeat-trips')).not.toBeNull();
		expect(card(container, 'repeat-vehicles')).not.toBeNull();
		expect(container.querySelector('[role="tablist"]')).toBeNull();
	});

	it('deep-links ranked trip and vehicle entries to their offending lines', () => {
		const { container } = render(RepeatOffenders);
		const tripLinks = within(card(container, 'repeat-trips')).getAllByRole('link', {
			name: /Montagne/,
		});
		expect(tripLinks).toHaveLength(2);
		expect(tripLinks.every((link) => link.getAttribute('href') === '/lines/11')).toBe(true);
		const vehicleLinks = within(card(container, 'repeat-vehicles')).getAllByRole('link', {
			name: /Boulevard/,
		});
		expect(vehicleLinks).toHaveLength(2);
		expect(vehicleLinks.every((link) => link.getAttribute('href') === '/lines/55')).toBe(true);
	});

	it('surfaces the natural-frequency recurrence line on a ranked row', () => {
		render(RepeatOffenders);
		// Scope to the ladder section (the hero's streak line repeats the same natural
		// frequency for the #1 offender, so a bare query would be ambiguous).
		const section = document.querySelector('[data-slot="offender-section"]') as HTMLElement;
		// The per-row note carries "Late-prone on 5 of 7 observed days" (the sr-only table
		// mirrors the note text).
		expect(within(section).getByText(/Late-prone on 5 of 7 observed days/i)).toBeInTheDocument();
	});

	it('renders only article cards for offered kinds', () => {
		// The month grain has only a trip entry, so no dead Vehicle card or TOC destination.
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		const { container } = render(RepeatOffenders);
		expect(card(container, 'repeat-trips')).not.toBeNull();
		expect(container.querySelector('[data-toc="repeat-vehicles"]')).toBeNull();
		expect(container.querySelector('[role="tab"]')).toBeNull();
	});

	it('renders the un-ranked tray (sub-MIN_N entities), explicitly NOT ranked', () => {
		render(RepeatOffenders);
		// The week tray cell (99999, a VEHICLE) lives in the independent Vehicle card.
		const tray = document.querySelector('[data-slot="offender-tray"]');
		expect(tray).not.toBeNull();
		expect(within(tray as HTMLElement).getByText(/not ranked/i)).toBeInTheDocument();
		// The tray cell is a link but carries NO magnitude bar (not scored).
		expect(within(tray as HTMLElement).queryAllByRole('progressbar')).toHaveLength(0);
	});

	it('seeds the grain rail from ?grain=month (a different ladder than the week default)', () => {
		mockUrl = new URL('http://localhost/repeat-offenders?grain=month');
		render(RepeatOffenders);
		// Scope to the ladder section (the #1-offender hero above it also links the worst).
		const section = document.querySelector('[data-slot="offender-section"]') as HTMLElement;
		// The month ladder ranks Van Horne (161) worst — its link resolves to /lines/161.
		const links = within(section).getAllByRole('link', { name: /Van Horne/ });
		expect(links).toHaveLength(2);
		expect(links.every((link) => link.getAttribute('href') === '/lines/161')).toBe(true);
		// The week-grain trip is NOT shown on the month grain.
		expect(within(section).queryByRole('link', { name: /Montagne/ })).toBeNull();
	});

	it('mirrors a grain change to ?grain and OMITS the week default (clean canonical URL)', async () => {
		render(RepeatOffenders);
		// A clean URL at the week default writes nothing (idempotent default-omit).
		expect(mockUrl.searchParams.get('grain')).toBeNull();
		const month = Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) =>
			(el.textContent ?? '').toLowerCase().includes('month'),
		);
		expect(month).toBeDefined();
		await fireEvent.click(month!);
		expect(mockUrl.searchParams.get('grain')).toBe('month');
	});

	it('drops invalid grain and n seeds back to the canonical week/default-N URL', async () => {
		mockUrl = new URL('http://localhost/repeat-offenders?grain=garbage&n=garbage');
		const { container } = render(RepeatOffenders);
		await waitFor(() => {
			expect(mockUrl.searchParams.get('grain')).toBeNull();
			expect(mockUrl.searchParams.get('n')).toBeNull();
		});
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getByRole('radio', { name: 'Week' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it('clamps an unavailable requested week to the populated month and mirrors the correction', async () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [seed().by_grain![1]!],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		mockUrl = new URL('http://localhost/repeat-offenders?grain=week');
		const { container } = render(RepeatOffenders);
		await waitFor(() => expect(mockUrl.searchParams.get('grain')).toBe('month'));
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).getByRole('radio', { name: 'Week' })).toBeDisabled();
		expect(within(rail).getByRole('radio', { name: 'Month' })).toHaveAttribute(
			'aria-checked',
			'true',
		);
	});

	it('seeds the worst-N cap from ?n and mirrors a change back to ?n', async () => {
		// A week ladder with 6 ranked TRIP entries so the worst-N control renders (total > 5).
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [
				{
					grain: 'week',
					window_days: 7,
					total_ranked_trips: 6,
					entries: Array.from({ length: 6 }, (_, i) => ({
						rank: i + 1,
						type: 'trip',
						id: `T${i}`,
						route: `${i}`,
						severe_pct: 50 - i,
						observation_count: 100,
						recurrence_days: 3,
						observed_days: 7,
					})),
					tray: [],
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		mockUrl = new URL('http://localhost/repeat-offenders?n=5');
		const { container } = render(RepeatOffenders);
		// ?n=5 caps the ladder to 5 of 6 → 5 sr-only body rows.
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(5);
		// The honest shown/total heading surfaces the truncation.
		expect(screen.getByText(/5\/6/)).toBeInTheDocument();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await fireEvent.click(within(rail).getByRole('radio', { name: '10' }));
		expect(mockUrl.searchParams.get('n')).toBeNull();
	});

	it('shows the styled honest-absence empty state when NO grain is populated and no legacy list', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [{ grain: 'week', entries: [], tray: [] }],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		const { container } = render(RepeatOffenders);
		const empty = document.querySelector('[data-slot="offenders-empty"]');
		expect(empty).not.toBeNull();
		const chip = empty?.querySelector('[data-slot="absent-value"]');
		expect(chip?.getAttribute('data-variant')).toBe('block');
		expect(container.querySelectorAll('table.sr-only tbody tr')).toHaveLength(0);
	});
});

describe('RepeatOffenders — legacy fallback ledger (by_grain absent)', () => {
	beforeEach(() => {
		mockUrl = new URL('http://localhost/repeat-offenders');
		navigate.mockClear();
		replaceState.mockClear();
		currentLocale.value = 'en';
		capturedLadders.current = [];
		resetRepeatState();
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(resetRepeatState);

	it('renders the scalar offenders[] as a ranked ledger worst-first, each linking to its route/stop', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '11',
					route: '11',
					route_name: 'Montagne / Sommet',
					avg_delay_min: 12.4,
					recurrence: 'most weekday afternoons',
					severity: 'critical',
				},
				{
					type: 'stop',
					id: '57191',
					route: null,
					route_name: null,
					avg_delay_min: 6.2,
					recurrence: null,
					severity: 'high',
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		render(RepeatOffenders);

		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		// Worst-first order preserved: route 11 (12.4) then stop (6.2).
		expect(links[0]).toHaveTextContent('Montagne / Sommet');
		expect(links[0]).toHaveTextContent('12.4 min');
		expect(links[0]).toHaveAttribute('href', '/lines/11');
		expect(links[1]).toHaveAttribute('href', '/stop/57191');
		expect(links[1]).toHaveTextContent('6.2 min');
	});

	it('shows the styled honest-absence chip for a null average delay, never a fabricated 0', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'route',
					id: '24',
					route: '24',
					route_name: 'Sherbrooke',
					avg_delay_min: null,
					recurrence: 'weekday PM peaks',
					severity: 'watch',
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		const { container } = render(RepeatOffenders);
		const chip = container.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('data-tone')).toBe('unknown');
		expect(chip).toHaveTextContent(/No data/i);
		expect(chip).toHaveTextContent(/not enough readings yet/i);
		expect(screen.queryByText(/0\.0 min/)).not.toBeInTheDocument();
	});

	it('reads the honest recurrence fallback when a legacy row carries no recurrence string', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{
					type: 'stop',
					id: '99',
					route: null,
					route_name: null,
					avg_delay_min: 8,
					recurrence: null,
				},
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		render(RepeatOffenders);
		expect(screen.getByText(/recurrence not recorded/i)).toBeInTheDocument();
	});

	it('renders BOTH rows when two offenders share an id on different routes (no each_key_duplicate)', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [
				{ type: 'route', id: '42010', route: '49', route_name: null, avg_delay_min: 11.3 },
				{ type: 'route', id: '42010', route: '55', route_name: null, avg_delay_min: 9.7 },
			],
		} satisfies RepeatOffendersData as RepeatOffendersData;

		expect(() => render(RepeatOffenders)).not.toThrow();
		const list = screen.getByRole('list', { name: /ranked by average delay/i });
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		const links = within(list).getAllByRole('link');
		expect(links[0]).toHaveAttribute('href', '/lines/49');
		expect(links[1]).toHaveAttribute('href', '/lines/55');
	});

	it('routes an empty payload to the boundary empty state, never an invented row', () => {
		payload.current = {
			generated_utc: GENERATED,
			offenders: [],
			by_grain: [],
		} satisfies RepeatOffendersData as RepeatOffendersData;
		render(RepeatOffenders);
		expect(
			screen.queryByRole('list', { name: /ranked by average delay/i }),
		).not.toBeInTheDocument();
	});
});
