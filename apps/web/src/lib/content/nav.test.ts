// nav.test.ts — guards the navigation manifest against the failure that prompted
// it: a stale inventory shipping dead links (/history, /data-trust never existed).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	SURFACE_NAV,
	SECONDARY_NAV,
	AUDIT_NAV,
	MENU_EXTRAS,
	YESID_HOUSE_LINK,
	isSurfaceActive,
	mainLandmarkLabel,
} from './nav';

const ROUTES = resolve(process.cwd(), 'src/routes/[[lang=locale]]');
const surface = (key: SurfaceKey) => SURFACE_NAV.find((i) => i.key === key)!;
type SurfaceKey = (typeof SURFACE_NAV)[number]['key'];

describe('SURFACE_NAV manifest', () => {
	it('every surface href resolves to a real +page.svelte (no dead links)', () => {
		// Both the primary rail surfaces AND the secondary footer links (/metrics,
		// /status live here) — a typo in either ships a dead link.
		for (const item of [...SURFACE_NAV, ...SECONDARY_NAV]) {
			const page = resolve(ROUTES, item.href.replace(/^\//, ''), '+page.svelte');
			expect(existsSync(page), `${item.href} -> ${page}`).toBe(true);
		}
	});

	it('every surface carries EN + FR label and description', () => {
		for (const item of SURFACE_NAV) {
			expect(item.label.en, item.key).toBeTruthy();
			expect(item.label.fr, item.key).toBeTruthy();
			expect(item.description.en, item.key).toBeTruthy();
			expect(item.description.fr, item.key).toBeTruthy();
		}
	});

	it('keys are unique', () => {
		const keys = SURFACE_NAV.map((i) => i.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('registers the four accountability surfaces in SECONDARY_NAV with EN + FR labels', () => {
		// slice-9.6: the audit/meta surfaces ride SECONDARY_NAV beside /metrics +
		// /status. Each must be present (so it is reachable) and carry both labels.
		const hrefs = SECONDARY_NAV.map((i) => i.href);
		for (const href of ['/hotspots', '/receipt', '/repeat-offenders', '/alerts']) {
			expect(hrefs, `${href} missing from SECONDARY_NAV`).toContain(href);
			const item = SECONDARY_NAV.find((i) => i.href === href)!;
			expect(item.label.en, `${href} en label`).toBeTruthy();
			expect(item.label.fr, `${href} fr label`).toBeTruthy();
		}
	});

	it('every SECONDARY_NAV href carries an EN + FR label (no half-localized link)', () => {
		for (const item of SECONDARY_NAV) {
			expect(item.label.en, item.href).toBeTruthy();
			expect(item.label.fr, item.href).toBeTruthy();
		}
	});
});

describe('AUDIT_NAV (side-nav Audit group)', () => {
	it('exposes the accountability/meta surfaces as a side-nav-consumable group', () => {
		// PR-5: the Audit group rides AUDIT_NAV for the NavPill hamburger menu. The
		// four accountability surfaces (plus the methodology + data-health anchors)
		// must be present with a stable icon key + EN/FR label.
		const hrefs = AUDIT_NAV.map((i) => i.href);
		for (const href of [
			'/metrics',
			'/status',
			'/hotspots',
			'/receipt',
			'/repeat-offenders',
			'/alerts',
		]) {
			expect(hrefs, `${href} missing from AUDIT_NAV`).toContain(href);
		}
	});

	it('each audit item carries a key, EN + FR label, and active prefixes', () => {
		for (const item of AUDIT_NAV) {
			expect(item.key, item.href).toBeTruthy();
			expect(item.label.en, item.href).toBeTruthy();
			expect(item.label.fr, item.href).toBeTruthy();
			expect(item.activePrefixes.length, item.href).toBeGreaterThan(0);
		}
	});

	it('keys are unique', () => {
		const keys = AUDIT_NAV.map((i) => i.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('every audit href resolves to a real +page.svelte (no dead links)', () => {
		for (const item of AUDIT_NAV) {
			const page = resolve(ROUTES, item.href.replace(/^\//, ''), '+page.svelte');
			expect(existsSync(page), `${item.href} -> ${page}`).toBe(true);
		}
	});

	it('stays footer-reachable: every audit surface is still in SECONDARY_NAV', () => {
		// The footer consumes SECONDARY_NAV — promoting these into the side-nav must
		// NOT drop footer reachability. SECONDARY_NAV is derived from AUDIT_NAV, so
		// the two can never drift.
		const secondaryHrefs = SECONDARY_NAV.map((i) => i.href);
		for (const item of AUDIT_NAV) {
			expect(secondaryHrefs, `${item.href} dropped from footer`).toContain(item.href);
		}
	});

	it('isSurfaceActive highlights the audit item on its own path', () => {
		const hotspots = AUDIT_NAV.find((i) => i.key === 'hotspots')!;
		expect(isSurfaceActive(hotspots, '/hotspots')).toBe(true);
		expect(isSurfaceActive(hotspots, '/status')).toBe(false);
	});
});

describe('isSurfaceActive', () => {
	it('matches exact surface paths', () => {
		expect(isSurfaceActive(surface('map'), '/map')).toBe(true);
		expect(isSurfaceActive(surface('network'), '/network')).toBe(true);
	});

	it('keeps Lines active on a route-detail page, Stops on a stop-detail page', () => {
		expect(isSurfaceActive(surface('lines'), '/lines')).toBe(true);
		expect(isSurfaceActive(surface('lines'), '/lines/1')).toBe(true);
		expect(isSurfaceActive(surface('stops'), '/stop/5')).toBe(true);
	});

	it('does not cross-match surfaces or the home hub', () => {
		expect(isSurfaceActive(surface('map'), '/network')).toBe(false);
		expect(isSurfaceActive(surface('stops'), '/lines/1')).toBe(false);
		expect(isSurfaceActive(surface('map'), '/')).toBe(false);
	});
});

describe('mainLandmarkLabel', () => {
	it('names the active primary surface (not a stale "Network map" everywhere)', () => {
		expect(mainLandmarkLabel('/lines')).toEqual({ en: 'Lines', fr: 'Lignes' });
		expect(mainLandmarkLabel('/lines/1')).toEqual({ en: 'Lines', fr: 'Lignes' });
		expect(mainLandmarkLabel('/stop/5')).toEqual({ en: 'Stops', fr: 'Arrêts' });
		expect(mainLandmarkLabel('/network')).toEqual({ en: 'Network', fr: 'Réseau' });
	});

	it('names secondary (accountability/methodology) surfaces too', () => {
		expect(mainLandmarkLabel('/receipt')).toEqual({ en: 'Daily receipt', fr: 'Reçu quotidien' });
		expect(mainLandmarkLabel('/metrics')).toEqual({
			en: 'How we measure',
			fr: 'Comment on mesure',
		});
	});

	it('falls back to the map label for the home hub, the map, and unmapped paths', () => {
		const mapLabel = { en: 'Map', fr: 'Carte' };
		expect(mainLandmarkLabel('/')).toEqual(mapLabel);
		expect(mainLandmarkLabel('/map')).toEqual(mapLabel);
		expect(mainLandmarkLabel('/totally-unknown')).toEqual(mapLabel);
	});
});

describe('MENU_EXTRAS', () => {
	it('are absolute off-site URLs with bilingual labels', () => {
		for (const link of MENU_EXTRAS) {
			expect(link.href).toMatch(/^https?:\/\//);
			expect(link.label.en).toBeTruthy();
			expect(link.label.fr).toBeTruthy();
		}
	});
});

describe('YESID_HOUSE_LINK', () => {
	it('is the external "Yesid" link out to the yesid.dev portfolio (bilingual)', () => {
		expect(YESID_HOUSE_LINK.href).toBe('https://yesid.dev');
		expect(YESID_HOUSE_LINK.label.en).toBe('Yesid');
		expect(YESID_HOUSE_LINK.label.fr).toBe('Yesid');
	});
});
