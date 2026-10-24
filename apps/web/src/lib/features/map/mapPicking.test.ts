import { describe, expect, it } from 'vitest';
import { ROUTE_LINE_HIT_LAYER, STOPS_LAYER, VEHICLE_BODY_LAYER } from '$lib/components/map';
import { pickMapSelection } from './mapPicking';

interface FakeFeature {
	layer?: { id?: string };
	properties?: Record<string, unknown>;
}

function feature(layer: string, properties: Record<string, unknown>): FakeFeature {
	return { layer: { id: layer }, properties };
}

describe('pickMapSelection', () => {
	it('prioritizes buses over stops and routes at the same pixel', () => {
		const picked = pickMapSelection([
			feature(ROUTE_LINE_HIT_LAYER, {
				route_id: '161',
				direction: 0,
				variant_key: '161:0:van-horne',
			}),
			feature(STOPS_LAYER, { id: '53355' }),
			feature(VEHICLE_BODY_LAYER, { id: '40061' }),
		]);

		expect(picked).toEqual({ kind: 'vehicle', id: '40061' });
	});

	it('prioritizes stops over route hit lines when no bus is present', () => {
		const picked = pickMapSelection([
			feature(ROUTE_LINE_HIT_LAYER, {
				route_id: '161',
				direction: 1,
				variant_key: '161:1:plamondon',
			}),
			feature(STOPS_LAYER, { id: '53355' }),
		]);

		expect(picked).toEqual({ kind: 'stop', id: '53355' });
	});

	it('returns the selected route variant from a route hit line', () => {
		const picked = pickMapSelection([
			feature(ROUTE_LINE_HIT_LAYER, {
				route_id: '161',
				direction: '1',
				variant_key: '161:1:plamondon',
			}),
		]);

		expect(picked).toEqual({
			kind: 'route',
			id: '161',
			direction: 1,
			variantKey: '161:1:plamondon',
		});
	});

	it('skips invalid higher-priority features and falls back to the next valid pick', () => {
		const picked = pickMapSelection([
			feature(VEHICLE_BODY_LAYER, {}),
			feature(STOPS_LAYER, {}),
			feature(ROUTE_LINE_HIT_LAYER, {
				route_id: '24',
				direction: 0,
				variant_key: '24:0:sherbrooke',
			}),
		]);

		expect(picked).toEqual({
			kind: 'route',
			id: '24',
			direction: 0,
			variantKey: '24:0:sherbrooke',
		});
	});
});
