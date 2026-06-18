import { describe, expect, it } from 'vitest';
import { stopModeHint } from './stopMode';

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
