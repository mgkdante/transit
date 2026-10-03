import { describe, expect, it } from 'vitest';
import { copy, mapCopy } from './map.copy';

describe('map copy', () => {
	it.each(['en', 'fr'] as const)(
		'names the selected city in %s map status and fallbacks',
		(locale) => {
			for (const city of ['Montréal', 'Ottawa', 'Example City']) {
				const selected = mapCopy(locale, city);
				for (const key of [
					'staticHeading',
					'staticImageAlt',
					'staticKicker',
					'mapLabel',
					'mapBooting',
					'mapImportError',
					'staticUnavailable',
				] as const) {
					expect(selected[key]).toContain(city);
					expect(selected[key]).not.toContain('{city}');
				}
				expect(selected.bootBody).toMatch(/automatically|automatiquement/u);
				expect(selected.staticBody).toMatch(/Static|statique/u);
				expect(selected.staticNoScript).toContain('JavaScript');
			}
		},
	);

	it('uses vernacular marker labels', () => {
		expect(copy.en.legendTitle).toBe('Markers');
		expect(copy.fr.legendTitle).toBe('Marqueurs');
		expect(copy.en.entityBus).toBe('Bus');
		expect(copy.fr.entityBus).toBe('Bus');
	});

	it('carries a bilingual accessible label for the detail-panel resize handle', () => {
		expect(copy.en.detailResizeLabel).toBe('Resize details panel');
		expect(copy.fr.detailResizeLabel).toBe('Redimensionner le panneau de détails');
	});

	it('invites precise near-me address searches', () => {
		expect(copy.en.nearMeSearchPlaceholder).toBe('Address, postal code, or coordinates');
		expect(copy.fr.nearMeSearchPlaceholder).toBe('Adresse, code postal ou coordonnées');
	});

	it('discloses the near-me search recipients in both languages', () => {
		expect(copy.en.nearMeCollectionNotice).toBe(
			'Your searches are sent to our server and the Government of Canada Geo.ca service.',
		);
		expect(copy.fr.nearMeCollectionNotice).toBe(
			'Vos recherches sont envoyées à notre serveur et au service Géo.ca du gouvernement du Canada.',
		);
	});

	it('carries bilingual live-feed edge-state notices', () => {
		for (const c of [copy.en, copy.fr]) {
			expect(c.liveUnavailable.trim()).toBeTruthy();
			expect(c.liveNoVehicles.trim()).toBeTruthy();
		}
		expect(copy.en.liveUnavailable).toBe(
			'Live vehicle positions unavailable right now. The map and stops still work.',
		);
		expect(copy.fr.liveUnavailable).toBe(
			'Positions des véhicules en direct indisponibles pour l’instant. La carte et les arrêts fonctionnent toujours.',
		);
		expect(copy.en.liveNoVehicles).toBe('No vehicles to show right now.');
	});

	it('keeps the edge-state notices em-dash-free (repo doctrine)', () => {
		const all = [copy.en, copy.fr].flatMap((c) => [c.liveUnavailable, c.liveNoVehicles]).join(' ');
		expect(all).not.toContain('—');
		expect(all).not.toContain('–');
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
		expect(all).not.toContain('—');
		expect(all).not.toContain('–');
	});

	it('carries the bilingual motion-mode switch copy (raw default + almost real-time)', () => {
		for (const c of [copy.en, copy.fr]) {
			for (const key of [
				'label',
				'smooth',
				'raw',
				'toRaw',
				'toSmooth',
				'hintSmooth',
				'hintRaw',
				'explain',
			] as const) {
				expect(c.motion[key].trim()).toBeTruthy();
			}
		}
		expect(copy.en.motion.smooth).toBe('Estimated');
		expect(copy.en.motion.raw).toBe('Reported');
		expect(copy.fr.motion.smooth).toBe('Estimées');
		expect(copy.fr.motion.raw).toBe('Signalées');
	});

	it('uses frozen prefix-matching rail abbreviations and drawer actions', () => {
		expect(copy.en.rail).toEqual({
			motion: 'Pos.',
			markers: 'Mark.',
			alerts: 'Alerts',
			active: 'Active',
			status: 'Status',
			crowding: 'Crowd',
		});
		expect(copy.fr.rail).toEqual({
			motion: 'Pos.',
			markers: 'Marq.',
			alerts: 'Alertes',
			active: 'Actifs',
			status: 'Statut',
			crowding: 'Achal.',
		});
		expect(copy.en.activeTitle).toBe('Active');
		expect(copy.fr.activeTitle).toBe('Actifs');
		expect(copy.en.controlsDone).toBe('Done');
		expect(copy.fr.controlsDone).toBe('Terminé');
	});
});
