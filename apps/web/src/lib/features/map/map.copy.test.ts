import { describe, expect, it } from 'vitest';
import { copy } from './map.copy';

describe('map copy', () => {
	it('describes automatic live boot and the static no-JS fallback honestly in both locales', () => {
		for (const c of [copy.en, copy.fr]) {
			expect(c.staticHeading.trim()).toBeTruthy();
			expect(c.staticBody.toLowerCase()).toMatch(/static|statique/u);
			expect(c.staticHeading.toLowerCase()).not.toMatch(/preview|aperçu/u);
			expect(c.bootHeading.trim()).toBeTruthy();
			expect(c.bootBody.toLowerCase()).toMatch(/automatically|automatiquement/u);
			expect(c.bootBody.toLowerCase()).toMatch(/static|statique/u);
			expect(c.bootBody.toLowerCase()).not.toMatch(/choice|choix/u);
			expect(c).not.toHaveProperty('activateMap');
			expect(c.mapBooting.trim()).toBeTruthy();
			expect(c.mapImportError.trim()).toBeTruthy();
			expect(c.mapImportRetry.trim()).toBeTruthy();
			expect(c.staticNoScript.toLowerCase()).toMatch(/static|statique/u);
		}
		expect(copy.en.staticHeading).toBe('Montréal transit map');
		expect(copy.en.staticBody).toBe(
			'Static, non-live basemap. No vehicles, stops, service alerts, or freshness data are shown.',
		);
		expect(copy.fr.staticHeading).toBe('Carte du réseau de Montréal');
		expect(copy.fr.staticBody).toBe(
			'Fond de carte statique, pas en direct. Aucun véhicule, arrêt, avis de service ou renseignement de fraîcheur n’est affiché.',
		);
		expect(copy.en.bootHeading).toBe('Live map');
		expect(copy.en.bootBody).toBe(
			'The live interactive map loads automatically. This static basemap stays visible until it is ready.',
		);
		expect(copy.fr.bootHeading).toBe('Carte en direct');
		expect(copy.fr.bootBody).toBe(
			'La carte interactive en direct se charge automatiquement. Ce fond de carte statique reste visible jusqu’à ce qu’elle soit prête.',
		);
		expect(copy.en.mapBooting).toBe('Loading live map…');
		expect(copy.fr.mapBooting).toBe('Chargement de la carte en direct…');
		expect(copy.en.staticNoScript).toBe(
			'JavaScript is required to load the live interactive map. This static, non-live basemap remains available.',
		);
		expect(copy.fr.staticNoScript).toBe(
			'JavaScript est requis pour charger la carte interactive en direct. Ce fond de carte statique reste accessible.',
		);
		expect(copy.en.staticSnapshot).toBe('Basemap snapshot · Aug 12, 2026');
		expect(copy.fr.staticSnapshot).toBe('Fond de carte · 12 août 2026');
	});

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
		expect(copy.en.motion.smooth).toBe('Almost real-time');
		expect(copy.en.motion.raw).toBe('Raw');
		expect(copy.fr.motion.smooth).toBe('Presque en temps réel');
		expect(copy.fr.motion.raw).toBe('Brut');
	});

	it('uses frozen prefix-matching rail abbreviations and drawer actions', () => {
		expect(copy.en.rail).toEqual({
			motion: 'Motion',
			markers: 'Mark.',
			alerts: 'Alerts',
			active: 'Active',
			status: 'Status',
			crowding: 'Crowd',
		});
		expect(copy.fr.rail).toEqual({
			motion: 'Mouv.',
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
