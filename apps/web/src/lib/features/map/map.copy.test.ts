import { describe, expect, it } from 'vitest';
import { copy } from './map.copy';

describe('map copy', () => {
	it('uses vernacular marker labels', () => {
		expect(copy.en.legendTitle).toBe('Markers');
		expect(copy.fr.legendTitle).toBe('Marqueurs');
		expect(copy.en.entityBusDirection).toBe('Bus - direction');
		expect(copy.en.entityBusNoDirection).toBe('Bus - no direction');
		expect(copy.fr.entityBusDirection).toBe('Bus - direction');
		expect(copy.fr.entityBusNoDirection).toBe('Bus - sans direction');
	});

	it('invites precise near-me address searches', () => {
		expect(copy.en.nearMeSearchPlaceholder).toBe('Address, postal code, or coordinates');
		expect(copy.fr.nearMeSearchPlaceholder).toBe('Adresse, code postal ou coordonnées');
	});
});
