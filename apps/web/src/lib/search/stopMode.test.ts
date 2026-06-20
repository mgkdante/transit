import { describe, expect, it } from 'vitest';
import { modeKeyForTag, routeModeHint, stopGroupKey, stopModeHint, stopModeTag } from './stopMode';

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

describe('stopModeTag — a visible tag for EVERY mode', () => {
	it('tags tram/bus/ferry too (where stopModeHint.label is null)', () => {
		expect(stopModeTag({ name: 'X', mode: 'tram' })).toBe('Tram');
		expect(stopModeTag({ name: 'X', mode: 'bus' })).toBe('Bus');
		expect(stopModeTag({ name: 'X', mode: 'ferry' })).toBe('Ferry');
	});

	it('tags metro/rail from the real mode', () => {
		expect(stopModeTag({ name: 'Anywhere', mode: 'metro' })).toBe('Métro');
		expect(stopModeTag({ name: 'Anywhere', mode: 'rail' })).toBe('Train');
	});

	it('falls back to the name prefix when mode is absent', () => {
		expect(stopModeTag({ name: 'Station Crémazie' })).toBe('Métro');
		expect(stopModeTag({ name: 'Gare Centrale' })).toBe('Train');
		expect(stopModeTag({ name: 'Berri / Fleury' })).toBeNull();
	});

	it('returns null for an unknown future mode — no fabricated tag', () => {
		expect(stopModeTag({ name: 'X', mode: 'monorail' })).toBeNull();
	});
});

describe('routeModeHint — GTFS route_type → glyph + tag', () => {
	it('maps the known route types to the shared glyph + a mode tag', () => {
		expect(routeModeHint(0)).toEqual({ glyph: '╤', tag: 'Tram' });
		expect(routeModeHint(1)).toEqual({ glyph: '◉', tag: 'Métro' });
		expect(routeModeHint(2)).toEqual({ glyph: '╪', tag: 'Train' });
		expect(routeModeHint(3)).toEqual({ glyph: '═', tag: 'Bus' });
		expect(routeModeHint(4)).toEqual({ glyph: '≈', tag: 'Ferry' });
	});

	it('defaults an unmapped type to the bus glyph with no tag', () => {
		expect(routeModeHint(99)).toEqual({ glyph: '═', tag: null });
	});
});

describe('modeKeyForTag — reverse of MODE_TAGS, single source of truth', () => {
	it('maps each visible tag back to its mode key', () => {
		expect(modeKeyForTag('Métro')).toBe('metro');
		expect(modeKeyForTag('Tram')).toBe('tram');
		expect(modeKeyForTag('Train')).toBe('rail');
		expect(modeKeyForTag('Bus')).toBe('bus');
		expect(modeKeyForTag('Ferry')).toBe('ferry');
	});

	it('round-trips with stopModeTag for every known mode (no drift)', () => {
		for (const mode of ['metro', 'tram', 'rail', 'bus', 'ferry'] as const) {
			const tag = stopModeTag({ name: 'X', mode });
			expect(modeKeyForTag(tag)).toBe(mode);
		}
	});

	it('returns null for null/undefined (no fabricated mode)', () => {
		expect(modeKeyForTag(null)).toBeNull();
		expect(modeKeyForTag(undefined)).toBeNull();
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
