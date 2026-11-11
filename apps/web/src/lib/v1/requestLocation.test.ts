import { expect, it } from 'vitest';
import { readRequestLocation } from './requestLocation';

function request(cf?: unknown): Request {
	return Object.assign(new Request('https://transit.test/'), { cf });
}

it('reads approximate coordinates only from the runtime request metadata', () => {
	expect(readRequestLocation(request({ latitude: '45.42', longitude: '-75.70' }))).toEqual({
		lat: 45.42,
		lon: -75.7,
	});
	expect(
		readRequestLocation(
			new Request('https://transit.test/?latitude=45.42&longitude=-75.70', {
				headers: { 'cf-iplatitude': '45.42', 'cf-iplongitude': '-75.70' },
			}),
		),
	).toBeNull();
});

it.each([
	undefined,
	null,
	'Ottawa',
	{},
	{ latitude: '45.42' },
	{ latitude: '', longitude: '-75.70' },
	{ latitude: '   ', longitude: '-75.70' },
	{ latitude: null, longitude: '-75.70' },
	{ latitude: 'NaN', longitude: '-75.70' },
	{ latitude: '45.42north', longitude: '-75.70' },
	{ latitude: '91', longitude: '-75.70' },
	{ latitude: '45.42', longitude: '-181' },
	{ latitude: '45.42', longitude: 'Infinity' },
])('ignores missing or invalid runtime coordinates: %j', (cf) => {
	expect(readRequestLocation(request(cf))).toBeNull();
});
