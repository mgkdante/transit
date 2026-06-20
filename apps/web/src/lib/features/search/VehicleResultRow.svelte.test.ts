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

	it('shows an honest no-data crowding mark when occupancy telemetry is absent', () => {
		render(VehicleResultRow, {
			props: {
				vehicle: vehicle({ occupancy: null, delay_min: null }),
				locale: 'en',
				nextStopName: null,
				copy: VEHICLE_COPY,
				statusLabel: 'Late',
				occupancyLabel: null,
			},
		});
		// No crowding telemetry → the honest label, never a fabricated band.
		expect(screen.getByText('No crowding data')).toBeInTheDocument();
		// No delay → the honest "No delay", never a fabricated 0.
		expect(screen.getByText('No delay')).toBeInTheDocument();
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
		// Falls back to the static bus glyph + the honest "no next stop".
		expect(container.querySelector('.vehicle-row-glyph')).not.toBeNull();
		expect(screen.getByText('No next stop')).toBeInTheDocument();
	});

	it('omits the raw next_stop id when the name is unresolved — shows the honest "no next stop"', () => {
		render(VehicleResultRow, {
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
		// …the row falls to the localized "no next stop" copy instead.
		expect(screen.getByText('No next stop')).toBeInTheDocument();
	});
});
