import { describe, it, expect } from 'vitest';
import { mapSearchFor } from './mapTarget';
import { fromSearchParams } from './url';

const parse = (search: string) => fromSearchParams(new URLSearchParams(search));

describe('mapSearchFor', () => {
	it('targets a single route', () => {
		expect([...parse(mapSearchFor({ route: '161' })).routes]).toEqual(['161']);
	});

	it('targets a single stop', () => {
		expect([...parse(mapSearchFor({ stop: '57191' })).stops]).toEqual(['57191']);
	});

	it('targets a single vehicle', () => {
		expect([...parse(mapSearchFor({ vehicle: '40061' })).vehicles]).toEqual(['40061']);
	});

	it('applies status chips', () => {
		expect(parse(mapSearchFor({ status: ['late'] })).status).toEqual(['late']);
	});

	it('is empty for an empty target', () => {
		expect(mapSearchFor({})).toBe('');
	});
});
