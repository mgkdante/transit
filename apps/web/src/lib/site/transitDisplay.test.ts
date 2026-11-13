import { describe, expect, it } from 'vitest';
import { lineLabel, stopDisplayName, hasOccupancy } from './transitDisplay';

// Names read from the published OC static/stops_index.json snapshot.
describe('OC stop display names', () => {
	it.each([
		['RIDEAU / CUMBERLAND', 'Rideau / Cumberland'],
		["TUNNEY'S PASTURE A", "Tunney's Pasture A"],
		['ST-LAURENT A', 'St-Laurent A'],
		['SUSSEX / AD. 100', 'Sussex / AD. 100'],
		['RENAUD / DE LA MÉLODIE', 'Renaud / de la Mélodie'],
		['OLD ST PATRICK / DE LA SALLE H.S.', 'Old St Patrick / de la Salle H.S.'],
		['LA SALLE / BANK', 'La Salle / Bank'],
		['UOTTAWA A', 'UOTTAWA A'],
		['RIDEAU NB / O-TRAIN 1', 'Rideau NB / O-TRAIN 1'],
		['Station Berri-UQAM', 'Station Berri-UQAM'],
	])('%s → %s', (raw, display) => expect(stopDisplayName(raw)).toBe(display));
});

it('does not rewrite an id that is missing from the index', () => {
	expect(lineLabel('1-373', [{ id: '1-373', short: '1' }])).toBe('1');
	expect(lineLabel('1-373', [])).toBe('1-373');
	expect(lineLabel('fictional-city:opaque', [])).toBe('fictional-city:opaque');
});

it('derives occupancy availability from provider vehicles and preserves STM', () => {
	expect(hasOccupancy('octranspo', [])).toBe(false);
	expect(hasOccupancy('octranspo', [{ occupancy: null }])).toBe(false);
	expect(hasOccupancy('octranspo', [{ occupancy: 'standing' }])).toBe(true);
	expect(hasOccupancy('stm', [])).toBe(true);
});
