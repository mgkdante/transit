import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Vehicle } from '$lib/v1/schemas';
import { copy } from './search.copy';
import VehicleResultRow from './VehicleResultRow.svelte';

const VEHICLE_COPY = copy.en.vehicle;

function vehicle(partial: Partial<Vehicle>): Vehicle {
	return {
		id: '40061',
		lat: 45.5,
		lon: -73.6,
		status: 'late',
		updated_utc: '2026-06-16T00:00:00Z' as Vehicle['updated_utc'],
		...partial,
	};
}

describe('VehicleResultRow', () => {
	it('renders status, signed delay, route tag, and resolved next stop', () => {
		const { container } = render(VehicleResultRow, {
			props: {
				vehicle: vehicle({ route: '161', delay_min: 4, occupancy: 'few_seats', bearing: 90 }),
				locale: 'en',
				nextStopName: 'Van Horne / Rockland',
				copy: VEHICLE_COPY,
				statusLabel: 'Late',
				occupancyLabel: 'Few seats',
			},
		});
		expect(screen.getByRole('link', { name: 'Live bus 40061' })).toHaveAttribute(
			'href',
			'/map?vehicle=40061',
		);
		expect(screen.getByText('Late')).toBeInTheDocument();
		expect(screen.getByText('+4 min')).toBeInTheDocument();
		expect(screen.getByText('Route 161')).toBeInTheDocument();
		expect(screen.getByText('Next: Van Horne / Rockland')).toBeInTheDocument();
		// A bearing → a rotated heading arrow.
		const arrow = container.querySelector('.vehicle-row-arrow') as HTMLElement | null;
		expect(arrow?.getAttribute('style')).toContain('rotate(90deg)');
	});

	it('shows the styled honest-absence chip for crowding AND delay when both are absent', () => {
		const { container } = render(VehicleResultRow, {
			props: {
				vehicle: vehicle({ occupancy: null, delay_min: null }),
				locale: 'en',
				nextStopName: null,
				copy: VEHICLE_COPY,
				statusLabel: 'Late',
				occupancyLabel: null,
			},
		});
		// No crowding telemetry + no delay reading + no next stop → three styled
		// honest-absence chips ("Unknown · not reported"), never a fabricated band /
		// "No delay" / 0, and never a plain easy-to-miss "no data".
		const chips = container.querySelectorAll('[data-slot="absent-value"]');
		expect(chips.length).toBe(3);
		// Each chip says it is unknown AND why (the live feed omitted it).
		expect(screen.getAllByText('Unknown').length).toBe(3);
		expect(screen.getAllByText('not reported in the live feed').length).toBe(3);
		// The fabricated plain strings are gone.
		expect(screen.queryByText('No crowding data')).toBeNull();
		expect(screen.queryByText('No delay')).toBeNull();
	});

	it('omits the heading arrow when the bearing is absent (no fabricated heading)', () => {
		const { container } = render(VehicleResultRow, {
			props: {
				vehicle: vehicle({ bearing: null }),
				locale: 'en',
				nextStopName: null,
				copy: VEHICLE_COPY,
				statusLabel: 'Late',
				occupancyLabel: null,
			},
		});
		expect(container.querySelector('.vehicle-row-arrow')).toBeNull();
		// Falls back to the static bus glyph + the styled honest-absence chip for the
		// next stop (the next-stop subtitle carries an "absent-value" chip).
		expect(container.querySelector('.vehicle-row-glyph')).not.toBeNull();
		const sub = container.querySelector('.vehicle-row-sub') as HTMLElement;
		expect(sub.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(screen.queryByText('No next stop')).toBeNull();
	});

	it('omits the raw next_stop id when the name is unresolved — shows the styled honest-absence chip', () => {
		const { container } = render(VehicleResultRow, {
			props: {
				vehicle: vehicle({ next_stop: '99999' }),
				locale: 'en',
				nextStopName: null,
				copy: VEHICLE_COPY,
				statusLabel: 'Late',
				occupancyLabel: null,
			},
		});
		// The meaningless raw GTFS id is never surfaced to a rider…
		expect(screen.queryByText('Next: 99999')).toBeNull();
		// …the next-stop subtitle falls to the styled honest-absence chip instead.
		const sub = container.querySelector('.vehicle-row-sub') as HTMLElement;
		expect(sub.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(screen.queryByText('No next stop')).toBeNull();
	});
});
