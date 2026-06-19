import { describe, expect, it } from 'vitest';
import { stopGroupKey, stopModeHint } from './stopMode';

describe('stopModeHint — real mode field wins over the name', () => {
	it('tags metro/rail from the real mode regardless of the name', () => {
		expect(stopModeHint({ name: 'Berri / Fleury', mode: 'metro' })).toEqual({
			glyph: '◉',
			label: 'Métro',
		});
		expect(stopModeHint({ name: 'Ordinary Stop', mode: 'rail' })).toEqual({
			glyph: '╪',
			label: 'Train',
		});
	});

	it('renders tram/bus/ferry as a plain stop (no tag), even with a Station-like name', () => {
		expect(stopModeHint({ name: 'Station Berri-UQAM', mode: 'bus' })).toEqual({
			glyph: '■',
			label: null,
		});
		expect(stopModeHint({ name: 'X', mode: 'tram' })).toEqual({ glyph: '■', label: null });
		expect(stopModeHint({ name: 'X', mode: 'ferry' })).toEqual({ glyph: '■', label: null });
	});
});

describe('stopModeHint — name-prefix fallback when mode is absent/null', () => {
	it('tags métro platform stops from the "Station" prefix (accent/case insensitive)', () => {
		expect(stopModeHint({ name: 'Station Berri-UQAM' })).toEqual({ glyph: '◉', label: 'Métro' });
		expect(stopModeHint({ name: 'station crémazie' })).toEqual({ glyph: '◉', label: 'Métro' });
		// mode explicitly null (published but unlinked) also falls back to the name.
		expect(stopModeHint({ name: 'Station Jarry', mode: null })).toEqual({
			glyph: '◉',
			label: 'Métro',
		});
	});

	it('tags commuter-rail stops from the "Gare" prefix', () => {
		expect(stopModeHint({ name: 'Gare Centrale' })).toEqual({ glyph: '╪', label: 'Train' });
	});

	it('leaves ordinary bus/intersection stops untagged with the default glyph', () => {
		expect(stopModeHint({ name: 'Berri / Fleury' })).toEqual({ glyph: '■', label: null });
		expect(stopModeHint({ name: '' })).toEqual({ glyph: '■', label: null });
		expect(stopModeHint({ name: null })).toEqual({ glyph: '■', label: null });
	});
});

describe('stopGroupKey', () => {
	it('collapses all platforms of one metro station (same name, real mode) to one key', () => {
		const a = stopGroupKey({ id: '1', code: '10280', name: 'Station Berri-UQAM', mode: 'metro' });
		const b = stopGroupKey({
			id: '50301',
			code: '50301',
			name: 'Station Berri-UQAM',
			mode: 'metro',
		});
		expect(a).toBe(b);
		expect(a).toBe('name:station berri uqam');
	});

	it('keys a metro-tagged stop by name even without a "Station" prefix', () => {
		expect(stopGroupKey({ id: '9', code: '900', name: 'Lionel-Groulx', mode: 'metro' })).toBe(
			'name:lionel groulx',
		);
	});

	it('groups a station by name via the prefix fallback when mode is absent', () => {
		const a = stopGroupKey({ id: '1', code: '10280', name: 'Station Henri-Bourassa' });
		const b = stopGroupKey({ id: '50301', code: '50301', name: 'Station Henri-Bourassa' });
		expect(a).toBe(b);
		expect(a).toBe('name:station henri bourassa');
	});

	it('groups ordinary stops by rider code, keeping distinct codes separate', () => {
		const a = stopGroupKey({
			id: '52819',
			code: '52618',
			name: 'Montgomery / Sherbrooke',
			mode: 'bus',
		});
		const b = stopGroupKey({ id: '57191', code: '57191', name: 'Van Horne / Rockland' });
		expect(a).toBe('code:52618');
		expect(b).toBe('code:57191');
		expect(a).not.toBe(b);
	});
});
