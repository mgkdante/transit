import { describe, expect, it } from 'vitest';
import { stopGroupKey, stopModeHint } from './stopMode';

describe('stopModeHint', () => {
	it('tags métro platform stops from the "Station" prefix (accent/case insensitive)', () => {
		expect(stopModeHint('Station Berri-UQAM')).toEqual({ glyph: '◉', label: 'Métro' });
		expect(stopModeHint('station crémazie')).toEqual({ glyph: '◉', label: 'Métro' });
	});

	it('tags commuter-rail stops from the "Gare" prefix', () => {
		expect(stopModeHint('Gare Centrale')).toEqual({ glyph: '╪', label: 'Train' });
	});

	it('leaves ordinary bus/intersection stops untagged with the default glyph', () => {
		expect(stopModeHint('Berri / Fleury')).toEqual({ glyph: '■', label: null });
		expect(stopModeHint('')).toEqual({ glyph: '■', label: null });
		expect(stopModeHint(null)).toEqual({ glyph: '■', label: null });
	});
});

describe('stopGroupKey', () => {
	it('groups all platforms/poles of a station under one name key (any code)', () => {
		const a = stopGroupKey({ id: '1', code: '10280', name: 'Station Henri-Bourassa' });
		const b = stopGroupKey({ id: '50301', code: '50301', name: 'Station Henri-Bourassa' });
		expect(a).toBe(b);
		expect(a).toBe('name:station henri bourassa');
	});

	it('groups ordinary stops by rider code, keeping distinct codes separate', () => {
		const a = stopGroupKey({ id: '52819', code: '52618', name: 'Montgomery / Sherbrooke' });
		const b = stopGroupKey({ id: '57191', code: '57191', name: 'Van Horne / Rockland' });
		expect(a).toBe('code:52618');
		expect(b).toBe('code:57191');
		expect(a).not.toBe(b);
	});
});
