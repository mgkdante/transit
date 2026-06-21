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
	isEmpty: false,
};

// The honest empty state: no telemetry → the VM is empty (no mix to draw).
const empty: CrowdingVM = { mix: null, delayByCrowding: [], isEmpty: true };

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
		render(Cluster04Crowding, { props: { vm: empty, locale: 'en', copy } });

		// The overline still anchors the band.
		expect(screen.getByText(copy.clusters.crowding)).toBeInTheDocument();

		// Explicit no-data note, NOT a fabricated occupancy bar.
		expect(screen.getByText(copy.strip.noDataNote)).toBeInTheDocument();
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
		isEmpty: false,
	};

	it('renders the present bands with their avg delay, ordered empty→full', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: withDelay, locale: 'en', copy },
		});
		const sub = container.querySelector('[data-slot="delay-by-crowding"]');
		expect(sub).not.toBeNull();
		expect(within(sub as HTMLElement).getByText(copy.delayByCrowding.heading)).toBeInTheDocument();
		// Present bands read their delay.
		expect(within(sub as HTMLElement).getByText('1.2 min')).toBeInTheDocument();
		expect(within(sub as HTMLElement).getByText('4.5 min')).toBeInTheDocument();
		// Secondary p50 caption rides the many_seats band.
		expect(
			within(sub as HTMLElement).getByText(copy.delayByCrowding.typical('0.4 min')),
		).toBeInTheDocument();
		// Natural occupancy order (empty→full): standing precedes full in the DOM.
		const rows = sub!.querySelectorAll('[data-slot="delay-by-crowding-row"]');
		const order = [...rows].map((r) => r.getAttribute('data-band'));
		expect(order).toEqual(['empty', 'many_seats', 'few_seats', 'standing', 'full']);
	});

	it('shows the no-data message (never "·"/0) for a band with a null delay', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: withDelay, locale: 'en', copy },
		});
		const sub = container.querySelector('[data-slot="delay-by-crowding"]') as HTMLElement;
		// `full` is present with a null delay → its cell reads the no-data message.
		const fullCell = sub.querySelector('[data-band="full"] [data-empty="true"]');
		expect(fullCell?.textContent?.trim()).toBe(copy.strip.noData);
		// `empty` + `few_seats` are absent from the contract → also no-data, not "·".
		expect(sub.querySelector('[data-band="empty"] [data-empty="true"]')?.textContent?.trim()).toBe(
			copy.strip.noData,
		);
		// No middot leak anywhere in the sub-block.
		expect(sub.textContent).not.toContain('·');
	});

	it('shows ONE honest no-data note when there is no delay-by-crowding data at all', () => {
		const { container } = render(Cluster04Crowding, {
			props: { vm: populated, locale: 'en', copy },
		});
		const sub = container.querySelector('[data-slot="delay-by-crowding"]') as HTMLElement;
		expect(within(sub).getByText(copy.delayByCrowding.empty)).toBeInTheDocument();
		// Not a fabricated per-band grid.
		expect(sub.querySelector('[data-slot="delay-by-crowding-row"]')).toBeNull();
	});

	it('surfaces delay-by-crowding even when the occupancy mix is empty (no telemetry)', () => {
		const mixEmptyWithDelay: CrowdingVM = {
			mix: null,
			delayByCrowding: [{ band: 'standing', avg_delay_min: 3.3 }],
			isEmpty: true,
		};
		const { container } = render(Cluster04Crowding, {
			props: { vm: mixEmptyWithDelay, locale: 'en', copy },
		});
		// The mix block shows its own no-data note...
		expect(screen.getByText(copy.strip.noDataNote)).toBeInTheDocument();
		// ...but the delay-by-crowding sub-block still renders its data.
		const sub = container.querySelector('[data-slot="delay-by-crowding"]') as HTMLElement;
		expect(within(sub).getByText('3.3 min')).toBeInTheDocument();
	});
});
