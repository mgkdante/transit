import { describe, expect, it } from 'vitest';
import { copy } from './map.copy';

describe('map copy', () => {
	it('uses vernacular marker labels', () => {
		expect(copy.en.legendTitle).toBe('Markers');
		expect(copy.fr.legendTitle).toBe('Marqueurs');
		expect(copy.en.entityBus).toBe('Bus');
		expect(copy.fr.entityBus).toBe('Bus');
	});

	it('invites precise near-me address searches', () => {
		expect(copy.en.nearMeSearchPlaceholder).toBe('Address, postal code, or coordinates');
		expect(copy.fr.nearMeSearchPlaceholder).toBe('Adresse, code postal ou coordonnées');
	});

	it('carries bilingual live-feed edge-state notices', () => {
		for (const c of [copy.en, copy.fr]) {
			expect(c.liveUnavailable.trim()).toBeTruthy();
			expect(c.liveNoVehicles.trim()).toBeTruthy();
		}
		expect(copy.en.liveUnavailable).toBe(
			'Live data unavailable right now. The map and stops still work.',
		);
		expect(copy.en.liveNoVehicles).toBe('No vehicles to show right now.');
	});

	it('keeps the edge-state notices em-dash-free (repo doctrine)', () => {
		const all = [copy.en, copy.fr].flatMap((c) => [c.liveUnavailable, c.liveNoVehicles]).join(' ');
		expect(all).not.toContain('—'); // em dash
		expect(all).not.toContain('–'); // en dash
	});

	it('carries a bilingual feed-stall banner that interpolates the last-update age', () => {
		for (const c of [copy.en, copy.fr]) {
			expect(c.feedNotResponding('2 minutes ago').trim()).toBeTruthy();
		}
		expect(copy.en.feedNotResponding('5 minutes ago')).toBe(
			'Live feed not responding. Last update 5 minutes ago.',
		);
		expect(copy.fr.feedNotResponding('il y a 5 minutes')).toBe(
			'Le flux en direct ne répond pas. Dernière mise à jour il y a 5 minutes.',
		);
	});

	it('keeps the feed-stall banner em-dash-free (repo doctrine)', () => {
		const all = [copy.en, copy.fr].map((c) => c.feedNotResponding('2 minutes ago')).join(' ');
		expect(all).not.toContain('—'); // em dash
		expect(all).not.toContain('–'); // en dash
	});
});
