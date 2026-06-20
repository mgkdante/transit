// nav.test.ts — guards the navigation manifest against the failure that prompted
// it: a stale inventory shipping dead links (/history, /data-trust never existed).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SURFACE_NAV, SECONDARY_NAV, MENU_EXTRAS, isSurfaceActive } from './nav';

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

describe('isSurfaceActive', () => {
	it('matches exact surface paths', () => {
		expect(isSurfaceActive(surface('map'), '/map')).toBe(true);
		expect(isSurfaceActive(surface('network'), '/network')).toBe(true);
	});

	it('keeps Lines active on a route-detail page, Stops on a stop-detail page', () => {
		expect(isSurfaceActive(surface('lines'), '/lines')).toBe(true);
		expect(isSurfaceActive(surface('lines'), '/route/1')).toBe(true);
		expect(isSurfaceActive(surface('stops'), '/stop/5')).toBe(true);
	});

	it('does not cross-match surfaces or the home hub', () => {
		expect(isSurfaceActive(surface('map'), '/network')).toBe(false);
		expect(isSurfaceActive(surface('stops'), '/route/1')).toBe(false);
		expect(isSurfaceActive(surface('map'), '/')).toBe(false);
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
