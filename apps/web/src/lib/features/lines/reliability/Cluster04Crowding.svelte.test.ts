import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Cluster04Crowding from './Cluster04Crowding.svelte';
import { reliabilityCopy } from './reliability.copy';
import { metricsCopy } from '$lib/features/metrics/metrics.copy';
import type { CrowdingVM } from './clusters';

const copy = reliabilityCopy.en;
const info = metricsCopy.en.info;

// A populated mix: `standing` is the dominant band (0.45 of a 1.0 total).
const populated: CrowdingVM = {
	mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.15, standing: 0.45, full: 0.1 },
	delayByCrowding: [],
	mixByGrain: null,
	weekdayWeekend: null,
	byWeekday: null,
	isEmpty: false,
};

// The honest empty state: no telemetry → the VM is empty (no mix to draw).
const empty: CrowdingVM = {
	mix: null,
	delayByCrowding: [],
	mixByGrain: null,
	weekdayWeekend: null,
	byWeekday: null,
	isEmpty: true,
};

describe('Cluster04Crowding', () => {
	it('renders the cluster overline + occupancy bar with a populated VM', () => {
		render(Cluster04Crowding, { props: { vm: populated, locale: 'en', copy } });

		// Numbered cluster overline.
		expect(screen.getByText(copy.clusters.crowding)).toBeInTheDocument();

		// Dominant band lifted to a MetricDisplay headline: standing at 45%. The
		// label + share legitimately appear in BOTH the headline and the legend.
		expect(screen.getAllByText('Standing').length).toBeGreaterThan(0);
		expect(screen.getAllByText('45%').length).toBeGreaterThan(0);

		// SPEC CHANGE (#11): the StackedBar is now `interactive`, so its wrapper is a
		// role=group carrying the full share summary as its aria-label (an interactive
		// bar descends into per-slice focus stops, so a role=img would flatten them).
		expect(
			screen.getByRole('group', {
				name: new RegExp(`${copy.clusters.crowding}.*Standing 45%`, 'i'),
			}),
		).toBeInTheDocument();
		expect(screen.queryByText(copy.strip.noDataNote)).not.toBeInTheDocument();
	});

	it('exposes each occupancy band as a focusable slice that reads its share (#11 hover/focus)', () => {
		render(Cluster04Crowding, { props: { vm: populated, locale: 'en', copy } });

		// Each slice is a focusable role=img rect labelled "<band>: <share>%". The
		// dominant `standing` band reads 45%; the slice is keyboard-reachable.
		const slice = screen.getByRole('img', { name: 'Standing: 45%' });
		expect(slice).toBeInTheDocument();
		expect(slice).toHaveAttribute('tabindex', '0');
	});

	it('renders the trailing-window caption on the crowding band', () => {
		render(Cluster04Crowding, { props: { vm: populated, locale: 'en', copy } });
		expect(screen.getByText(copy.windows.crowding)).toBeInTheDocument();
	});

	it('renders the honest empty state with an empty VM (no fake bar, no crash)', () => {
		const { container } = render(Cluster04Crowding, { props: { vm: empty, locale: 'en', copy } });

		// The overline still anchors the band.
		expect(screen.getByText(copy.clusters.crowding)).toBeInTheDocument();

		// The styled honest-absence chip (says WHY), NOT a fabricated occupancy bar.
		expect(
			container.querySelector('[data-slot="crowding-empty"] [data-slot="absent-value"]'),
		).not.toBeNull();
		expect(screen.queryByRole('img', { name: /Standing/i })).not.toBeInTheDocument();
	});

	it('honours the FR canonical voice for labels', () => {
		render(Cluster04Crowding, {
			props: { vm: populated, locale: 'fr', copy: reliabilityCopy.fr },
		});

		expect(screen.getByText(reliabilityCopy.fr.clusters.crowding)).toBeInTheDocument();
		// FR band label for `standing` (headline + legend → multiple matches).
		expect(screen.getAllByText('Debout').length).toBeGreaterThan(0);
	});

	it('deep-links the occupancy (i) affordance to /metrics#occupancy', async () => {
		render(Cluster04Crowding, { props: { vm: populated, locale: 'en', copy } });

		const trigger = screen.getByRole('button', { name: info.trigger(copy.clusters.crowding) });
		await fireEvent.click(trigger);
		const link = screen.getByRole('link', { name: new RegExp(info.link, 'i') });
		expect(link).toHaveAttribute('href', '/metrics#occupancy');
		expect(link).not.toHaveAttribute('target');
	});

	it('localizes the occupancy (i) deep link in FR (/fr/metrics#occupancy)', async () => {
		render(Cluster04Crowding, {
			props: { vm: populated, locale: 'fr', copy: reliabilityCopy.fr },
		});
		const frInfo = metricsCopy.fr.info;
		const trigger = screen.getByRole('button', {
			name: frInfo.trigger(reliabilityCopy.fr.clusters.crowding),
		});
		await fireEvent.click(trigger);
		expect(screen.getByRole('link', { name: new RegExp(frInfo.link, 'i') })).toHaveAttribute(
			'href',
			'/fr/metrics#occupancy',
		);
	});
});

describe('Cluster04Crowding — delay by crowding (G1)', () => {
	// A sparse delay×crowding set: two present bands with a real delay, one present
	// band with a NULL delay (must show the no-data message, never a "·"/0).
	const withDelay: CrowdingVM = {
		mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.15, standing: 0.45, full: 0.1 },
		delayByCrowding: [
			{ band: 'many_seats', avg_delay_min: 1.2, p50_min: 0.4 },
			{ band: 'standing', avg_delay_min: 4.5 },
			{ band: 'full', avg_delay_min: null, day_count: 3 },
		],
		mixByGrain: null,
		weekdayWeekend: null,
		byWeekday: null,
		isEmpty: false,
	};

	// S7 P1.5: the delay-by-crowding rows are now the A12 magnitude-bars mark on the fixed
	// occupancy axis. The LayerChart bars mount only behind ChartFrame's measured-size gate
	// (not in the no-layout test env), so we assert the mark + its AT-fallback table (rows
	// keyed by occupancy code); the bar geometry + tooltip are verified in headless Chrome.
	it('renders the present bands with their avg delay, ordered empty→full', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: withDelay, locale: 'en', copy },
		});
		const sub = container.querySelector('[data-slot="delay-by-crowding"]');
		expect(sub).not.toBeNull();
		// The heading appears as the SectionLabel + the mark's sr-table caption.
		expect(
			within(sub as HTMLElement).getAllByText(copy.delayByCrowding.heading).length,
		).toBeGreaterThan(0);
		const mark = sub!.querySelector('[data-slot="magnitude-bars-mark"]') as HTMLElement;
		expect(mark).not.toBeNull();
		// Fixed occupancy order (empty→full).
		const order = [...mark.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-key'));
		expect(order).toEqual(['empty', 'many_seats', 'few_seats', 'standing', 'full']);
		// Present bands carry their delay value in the AT table.
		expect(mark.querySelector('tr[data-key="many_seats"] td')?.textContent).toContain('1.2');
		expect(mark.querySelector('tr[data-key="standing"] td')?.textContent).toContain('4.5');
	});

	it('marks an absent band "no data" (never "·"/0) instead of a fabricated bar', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: withDelay, locale: 'en', copy },
		});
		const mark = container.querySelector('[data-slot="magnitude-bars-mark"]') as HTMLElement;
		// `full` is present with a null delay → its row label reads "no data", value cell empty.
		const full = mark.querySelector('tr[data-key="full"]') as HTMLElement;
		expect(full.querySelector('th')?.textContent).toContain(copy.strip.noData);
		expect(full.querySelector('td')?.textContent?.trim()).toBe('');
		// `empty` is contract-omitted → also the "no data" marker, never a fabricated 0.
		expect(mark.querySelector('tr[data-key="empty"] th')?.textContent).toContain(copy.strip.noData);
	});

	it('shows ONE honest no-data chip when there is no delay-by-crowding data at all', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: populated, locale: 'en', copy },
		});
		const sub = container.querySelector('[data-slot="delay-by-crowding"]') as HTMLElement;
		// The <Chart> renders the styled honest-absence chip itself (says WHY), no bars mark.
		expect(sub.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(sub.querySelector('[data-slot="magnitude-bars-mark"]')).toBeNull();
	});

	it('surfaces delay-by-crowding even when the occupancy mix is empty (no telemetry)', () => {
		const mixEmptyWithDelay: CrowdingVM = {
			mix: null,
			delayByCrowding: [{ band: 'standing', avg_delay_min: 3.3 }],
			mixByGrain: null,
			weekdayWeekend: null,
			byWeekday: null,
			isEmpty: true,
		};
		const { container } = render(Cluster04Crowding, {
			props: { vm: mixEmptyWithDelay, locale: 'en', copy },
		});
		// The mix block shows its own styled honest-absence chip...
		expect(
			container.querySelector('[data-slot="crowding-empty"] [data-slot="absent-value"]'),
		).not.toBeNull();
		// ...but the delay-by-crowding sub-block still renders its data.
		const mark = container.querySelector('[data-slot="magnitude-bars-mark"]') as HTMLElement;
		expect(mark.querySelector('tr[data-key="standing"] td')?.textContent).toContain('3.3');
	});

	it('drives the headline off the GRAIN-AWARE mix (mixByGrain) when present', () => {
		// scalar mix → standing/full 50/50; grain mix → many_seats 90%. The headline
		// must follow mixByGrain (90%), proving §04 responds to the rail's grain.
		const grainAware: CrowdingVM = {
			mix: { empty: 0, many_seats: 0, few_seats: 0, standing: 0.5, full: 0.5 },
			delayByCrowding: [],
			mixByGrain: { empty: 0, many_seats: 0.9, few_seats: 0.1, standing: 0, full: 0 },
			weekdayWeekend: null,
			byWeekday: null,
			isEmpty: false,
		};
		const { container } = render(Cluster04Crowding, {
			props: { vm: grainAware, locale: 'en', copy },
		});
		// Scope to the dominant-band headline (the bar also echoes the 90% share).
		const head = container.querySelector('.crowding-headline-row') as HTMLElement;
		expect(within(head).getByText('90%')).toBeInTheDocument();
	});

	it('renders the weekday vs weekend 2-col split from weekdayWeekend', () => {
		const split: CrowdingVM = {
			mix: { empty: 0.1, many_seats: 0.4, few_seats: 0.3, standing: 0.15, full: 0.05 },
			delayByCrowding: [],
			mixByGrain: null,
			weekdayWeekend: {
				weekday: { empty: 0, many_seats: 1, few_seats: 0, standing: 0, full: 0 },
				weekend: { empty: 0.6, many_seats: 0.4, few_seats: 0, standing: 0, full: 0 },
			},
			byWeekday: null,
			isEmpty: false,
		};
		const { container } = render(Cluster04Crowding, { props: { vm: split, locale: 'en', copy } });
		const block = container.querySelector('[data-slot="crowding-weekday-weekend"]') as HTMLElement;
		expect(block).not.toBeNull();
		// Both sides render their own occupancy bar (not an honest-absence chip).
		expect(block.querySelector('[data-slot="crowding-weekday"]')).not.toBeNull();
		expect(block.querySelector('[data-slot="crowding-weekend"]')).not.toBeNull();
		expect(within(block).getByText(copy.peak.weekday)).toBeInTheDocument();
		expect(within(block).getByText(copy.peak.weekend)).toBeInTheDocument();
	});

	it('omits the weekday/weekend split when weekdayWeekend is absent', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(container.querySelector('[data-slot="crowding-weekday-weekend"]')).toBeNull();
	});
});

describe('Cluster04Crowding — per-ISO-weekday small multiple (P11)', () => {
	// A 7-day frame: Mon (iso 1) + Wed (iso 3) carry telemetry; the rest are honest-null.
	const byDow: CrowdingVM = {
		mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.15, standing: 0.45, full: 0.1 },
		delayByCrowding: [],
		mixByGrain: null,
		weekdayWeekend: null,
		byWeekday: [
			{ iso: 1, mix: { empty: 0, many_seats: 1, few_seats: 0, standing: 0, full: 0 } },
			{ iso: 2, mix: null },
			{ iso: 3, mix: { empty: 0.2, many_seats: 0, few_seats: 0, standing: 0.8, full: 0 } },
			{ iso: 4, mix: null },
			{ iso: 5, mix: null },
			{ iso: 6, mix: null },
			{ iso: 7, mix: null },
		],
		isEmpty: false,
	};

	it('renders one strip per weekday (Mon→Sun) under the byDow heading', () => {
		const { container } = render(Cluster04Crowding, { props: { vm: byDow, locale: 'en', copy } });
		const block = container.querySelector('[data-slot="crowding-by-dow"]') as HTMLElement;
		expect(block).not.toBeNull();
		expect(within(block).getByText(copy.byDow.heading)).toBeInTheDocument();
		// Exactly 7 strips, in ISO order 1..7.
		const cells = block.querySelectorAll('[data-slot="crowding-dow-cell"]');
		expect(cells.length).toBe(7);
		expect([...cells].map((c) => c.getAttribute('data-iso'))).toEqual([
			'1',
			'2',
			'3',
			'4',
			'5',
			'6',
			'7',
		]);
		// Each strip is labelled by its full weekday name (Monday … Sunday).
		expect(within(block).getByText('Monday')).toBeInTheDocument();
		expect(within(block).getByText('Sunday')).toBeInTheDocument();
	});

	it('draws an occupancy bar for a weekday WITH telemetry (Monday = many_seats 100%)', () => {
		const { container } = render(Cluster04Crowding, { props: { vm: byDow, locale: 'en', copy } });
		const mon = container.querySelector(
			'[data-slot="crowding-dow-cell"][data-iso="1"]',
		) as HTMLElement;
		// A real StackedBar (not a no-data chip): the slice reads its share.
		expect(within(mon).getByRole('img', { name: 'Many seats: 100%' })).toBeInTheDocument();
		expect(mon.querySelector('[data-slot="absent-value"]')).toBeNull();
	});

	it('shows the honest no-data chip (no fabricated bar) for a weekday with mix:null', () => {
		const { container } = render(Cluster04Crowding, { props: { vm: byDow, locale: 'en', copy } });
		// Tuesday (iso 2) has mix:null → the styled honest-absence chip, never a bar.
		const tue = container.querySelector(
			'[data-slot="crowding-dow-cell"][data-iso="2"]',
		) as HTMLElement;
		expect(tue.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(within(tue).queryByRole('img', { name: /:/ })).not.toBeInTheDocument();
	});

	it('omits the small multiple entirely when byWeekday is absent', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(container.querySelector('[data-slot="crowding-by-dow"]')).toBeNull();
	});

	it('uses the FR weekday vocabulary (Lundi … Dimanche)', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: byDow, locale: 'fr', copy: reliabilityCopy.fr },
		});
		const block = container.querySelector('[data-slot="crowding-by-dow"]') as HTMLElement;
		expect(within(block).getByText('Lundi')).toBeInTheDocument();
		expect(within(block).getByText('Dimanche')).toBeInTheDocument();
	});
});
