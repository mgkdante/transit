import { describe, expect, it } from 'vitest';
import {
	clearNearTargetSearchParams,
	copyNearTargetSearchParams,
	mapNearId,
	nearTargetFromSearchParams,
	setNearTargetSearchParams,
} from './mapNear';

describe('mapNear URL helpers', () => {
	it('round-trips a Montréal near target through the URL', () => {
		const params = new URLSearchParams('route=161');

		setNearTargetSearchParams(params, {
			lat: 45.5256864,
			lon: -73.5947644,
			label: '5333 Avenue Casgrain, Montréal, Quebec',
			precision: 'address',
		});

		expect(params.toString()).toBe(
			'route=161&near=45.525686%2C-73.594764&nearLabel=5333+Avenue+Casgrain%2C+Montr%C3%A9al%2C+Quebec&nearPrecision=address',
		);
		expect(nearTargetFromSearchParams(params)).toEqual({
			lat: 45.525686,
			lon: -73.594764,
			label: '5333 Avenue Casgrain, Montréal, Quebec',
			precision: 'address',
		});
	});

	it('drops invalid or out-of-provider-bounds targets', () => {
		expect(nearTargetFromSearchParams(new URLSearchParams('near=hello'))).toBeNull();
		expect(nearTargetFromSearchParams(new URLSearchParams('near=46.8,-71.2'))).toBeNull();
	});

	it('copies a valid near target without copying unrelated URL state', () => {
		const source = new URLSearchParams('near=45.5,-73.6&nearLabel=Mile End&status=late');
		const target = new URLSearchParams('route=161');

		copyNearTargetSearchParams(source, target);

		expect(target.toString()).toBe('route=161&near=45.500000%2C-73.600000&nearLabel=Mile+End');
		expect(mapNearId(45.5000001, -73.5999999)).toBe('45.500000,-73.600000');
	});

	it('clears only the near-me target params and keeps filter state intact', () => {
		const params = new URLSearchParams(
			'route=161&vehicle=40061&near=45.5,-73.6&nearLabel=Mile+End&nearPrecision=neighbourhood',
		);

		clearNearTargetSearchParams(params);

		expect(params.toString()).toBe('route=161&vehicle=40061');
	});
});
