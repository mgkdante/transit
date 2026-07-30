import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { buildLiveIndex } from '$lib/v1/live';
import type { IsoUtc, StopFile, StopIndexEntry } from '$lib/v1/schemas';
import MapSelectionDetail from './MapSelectionDetail.svelte';
import { resolveMapSelection } from './mapSelection';

const utc = (value: string) => value as IsoUtc;

const stops: StopIndexEntry[] = [
	{ id: 'stop-1', name: 'Sherbrooke / Saint-Denis', code: '52618', lat: 45.51, lon: -73.57 },
];

const stopFiles: StopFile[] = [
	{
		generated_utc: utc('2026-06-15T00:00:00Z'),
		id: 'stop-1',
		name: 'Sherbrooke / Saint-Denis',
		lat: 45.51,
		lon: -73.57,
		code: '52618',
		routes_served: ['24'],
		scheduled: [{ route: '24', headsign: 'East', times: ['12:00'] }],
	},
];

describe('stop departures resilience', () => {
	it('keeps an unavailable departures source distinct from a successfully empty board', () => {
		const index = buildLiveIndex({ stopDepartures: null });
		const unavailable = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, stopFiles, departuresAvailable: false },
		);
		const empty = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{ index, stops, stopFiles, departuresAvailable: true },
		);

		if (unavailable?.kind !== 'stop' || empty?.kind !== 'stop') {
			throw new Error('expected stop details');
		}

		expect(unavailable.departures).toBeNull();
		expect(unavailable.routeTimes[0].liveDepartures).toBeNull();
		expect(empty.departures).toEqual([]);
		expect(empty.routeTimes[0].liveDepartures).toEqual([]);
	});

	it('renders an unavailable departure source without fabricating an empty board or no prediction', () => {
		const detail = resolveMapSelection(
			{ kind: 'stop', id: 'stop-1' },
			{
				index: buildLiveIndex({ stopDepartures: null }),
				stops,
				stopFiles,
				departuresAvailable: false,
			},
		);
		const { getAllByText, queryByText } = render(MapSelectionDetail, {
			props: { detail, locale: 'en' },
		});

		expect(getAllByText('Live departures unavailable').length).toBeGreaterThan(0);
		expect(queryByText('0 departures')).not.toBeInTheDocument();
		expect(queryByText('No prediction')).not.toBeInTheDocument();
	});
});
