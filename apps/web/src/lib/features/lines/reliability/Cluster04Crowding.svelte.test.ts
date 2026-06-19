import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Cluster04Crowding from './Cluster04Crowding.svelte';
import { reliabilityCopy } from './reliability.copy';
import type { CrowdingVM } from './clusters';

const copy = reliabilityCopy.en;

// A populated mix: `standing` is the dominant band (0.45 of a 1.0 total).
const populated: CrowdingVM = {
	mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.15, standing: 0.45, full: 0.1 },
	isEmpty: false,
};

// The honest empty state: no telemetry → the VM is empty (no mix to draw).
const empty: CrowdingVM = { mix: null, isEmpty: true };

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
});
