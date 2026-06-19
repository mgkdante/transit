import { describe, expect, it } from 'vitest';
import {
	clearMapFocusSearchParams,
	mapFocusValue,
	parseMapFocus,
	setMapFocusSearchParams,
} from './mapFocus';

describe('mapFocus', () => {
	it('round-trips a focus target through the URL param', () => {
		const params = new URLSearchParams();
		setMapFocusSearchParams(params, 'stop', '57191');
		expect(params.get('focus')).toBe('stop:57191');
		expect(parseMapFocus(params)).toEqual({ kind: 'stop', id: '57191' });
	});

	it('builds the param value', () => {
		expect(mapFocusValue('route', '161')).toBe('route:161');
	});

	it('rejects an absent or malformed focus param', () => {
		expect(parseMapFocus(new URLSearchParams())).toBeNull();
		expect(parseMapFocus(new URLSearchParams('focus=bogus'))).toBeNull();
		expect(parseMapFocus(new URLSearchParams('focus=alert:1'))).toBeNull();
		expect(parseMapFocus(new URLSearchParams('focus=stop:'))).toBeNull();
	});

	it('parses an id that itself contains a colon', () => {
		expect(parseMapFocus(new URLSearchParams('focus=stop:a:b'))).toEqual({
			kind: 'stop',
			id: 'a:b',
		});
	});

	it('clears the focus param without touching others', () => {
		const params = new URLSearchParams('stop=57191&focus=stop:57191');
		clearMapFocusSearchParams(params);
		expect(params.get('focus')).toBeNull();
		expect(params.get('stop')).toBe('57191');
	});
});
