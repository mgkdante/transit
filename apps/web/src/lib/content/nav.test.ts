import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as navigation from './nav';
import { NAV_GROUPS, NAV_ITEMS, visibleNav } from './nav';
import { providerHasAlerts, PublicProviderCatalogSchema } from '#lib/v1/providers.ts';
import catalog from '../../../e2e/providers.json';

describe('grouped navigation', () => {
	it('the menu has four groups in order', () => {
		expect(NAV_GROUPS.map((group) => group.key)).toEqual(['now', 'explore', 'reports', 'about']);
		expect([...new Set(NAV_ITEMS.map((item) => item.group))]).toEqual(
			NAV_GROUPS.map((group) => group.key),
		);
	});
	it('every earlier URL is still listed', () => {
		for (const item of [...SURFACE_NAV, ...AUDIT_NAV])
			expect(NAV_ITEMS.map((item) => item.href)).toContain(item.href);
	});
	it('alerts hide only when the capability is known false', () => {
		const alerts = NAV_ITEMS.find((item) => item.key === 'alerts')!;
		for (const capability of [true, null])
			expect(visibleNav({ alerts: capability })).toContain(alerts);
		const provider = {
			...PublicProviderCatalogSchema.parse(catalog).providers[0],
			id: 'made-up',
			inputs: {
				...PublicProviderCatalogSchema.parse(catalog).providers[0].inputs,
				i3_alerts: false,
				service_alerts: false,
			},
		};
		expect(visibleNav({ alerts: providerHasAlerts(provider) })).not.toContain(alerts);
	});
	it('the home item is active on the home page only', () => {
		const home = NAV_ITEMS.find((item) => item.key === 'overview')!;
		expect(isSurfaceActive(home, '/')).toBe(true);
		for (const path of ['/map', '/lines/1', '/unknown'])
			expect(isSurfaceActive(home, path)).toBe(false);
	});
	it('the bar is Overview, Map, Lines, Stops', () => {
		expect(NAV_ITEMS.filter((item) => item.barLabel).map((item) => item.key)).toEqual([
			'overview',
			'map',
			'lines',
			'stops',
		]);
	});
	it('the landmark is Overview on home and Search on search', () => {
		expect(mainLandmarkLabel('/')).toEqual(NAV_ITEMS[0].label);
		expect(mainLandmarkLabel('/search')).toEqual(navigation.SEARCH_LABEL);
	});
	it('an unknown path names no landmark', () => expect(mainLandmarkLabel('/unknown')).toBeNull());
});
import {
	SURFACE_NAV,
	SECONDARY_NAV,
	AUDIT_NAV,
	YESID_HOUSE_LINK,
	isSurfaceActive,
	mainLandmarkLabel,
} from './nav';

const ROUTES = resolve(process.cwd(), 'src/routes/[[lang=locale]]');
const surface = (key: SurfaceKey) => SURFACE_NAV.find((i) => i.key === key)!;
type SurfaceKey = (typeof SURFACE_NAV)[number]['key'];

describe('SURFACE_NAV manifest', () => {
	it('every surface href resolves to a real +page.svelte (no dead links)', () => {
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

	it('derives the legal destinations into SECONDARY_NAV', () => {
		const legal = (
			navigation as typeof navigation & {
				LEGAL_NAV: readonly {
					href: string;
					label: { en: string; fr: string };
				}[];
			}
		).LEGAL_NAV;

		expect(legal.map(({ href }) => href)).toEqual(['/privacy', '/terms', '/accessibility']);
		expect(SECONDARY_NAV.slice(-legal.length)).toEqual(legal);
	});
});

describe('AUDIT_NAV (side-nav Audit group)', () => {
	it('exposes the accountability/meta surfaces as a side-nav-consumable group', () => {
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

	it('keeps SECONDARY_NAV as the derived compatibility view for main-landmark resolution', () => {
		const secondaryHrefs = SECONDARY_NAV.map((i) => i.href);
		for (const item of AUDIT_NAV) {
			expect(secondaryHrefs, `${item.href} dropped from the derived view`).toContain(item.href);
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
	it('names each destination with its menu label', () => {
		for (const item of NAV_ITEMS) expect(mainLandmarkLabel(item.href)).toEqual(item.label);
	});
});

describe('YESID_HOUSE_LINK', () => {
	it('is the one exported parent-brand destination for every chrome consumer', () => {
		expect(YESID_HOUSE_LINK.href).toBe('https://yesid.dev');
		expect(YESID_HOUSE_LINK.label.en).toBeTruthy();
		expect(YESID_HOUSE_LINK.label.fr).toBeTruthy();
		expect(YESID_HOUSE_LINK.href).toMatch(/^https:\/\//);
		expect(navigation).not.toHaveProperty('MENU_EXTRAS');
	});
});
