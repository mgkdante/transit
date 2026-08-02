import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KitNavigationSimulator } from './__fixtures__/KitNavigationSimulator';

const kitPackage = JSON.parse(
	readFileSync(resolve(process.cwd(), 'node_modules/@sveltejs/kit/package.json'), 'utf8'),
) as { version: string };
const client = readFileSync(
	resolve(process.cwd(), 'node_modules/@sveltejs/kit/src/runtime/client/client.js'),
	'utf8',
);
const navigate = client.slice(
	client.indexOf('async function navigate({'),
	client.indexOf('/**\n * Does a full page reload', client.indexOf('async function navigate({')),
);

function ordered(...needles: string[]): number[] {
	const positions = needles.map((needle) => navigate.indexOf(needle));
	expect(positions.every((position) => position >= 0)).toBe(true);
	expect(positions).toEqual([...positions].sort((a, b) => a - b));
	return positions;
}

describe('Kit navigation simulator source contract', () => {
	it('pins the harness to the installed Kit release', () => {
		expect(kitPackage.version).toBe('2.65.1');
	});

	it('suppresses beforeNavigate during an active navigation but publishes every accepted target', () => {
		const beforeGuard = client.indexOf('if (!is_navigating) {');
		const beforeDelivery = client.indexOf('before_navigate_callbacks.forEach', beforeGuard);
		expect(beforeGuard).toBeGreaterThan(0);
		expect(beforeDelivery).toBeGreaterThan(beforeGuard);

		ordered(
			'is_navigating = true;',
			'stores.navigating.set((navigating.current = nav.navigation));',
			'let navigation_result = intent && (await load_route(intent));',
		);
	});

	it('normalizes the accepted URL before the winning-token and commit boundary', () => {
		ordered(
			'url = intent?.url || url;',
			'if (token !== nav_token) {',
			'Array.from(on_navigate_callbacks',
			'navigation_result.props.page.url = url;',
			'root.$set(navigation_result.props);',
			'update(navigation_result.props.page);',
		);
	});

	it('waits for the DOM commit before default focus reset and publishes idle last', () => {
		ordered(
			'const { activeElement } = document;',
			'await commit_promise;',
			'await svelte.tick();',
			'if (!keepfocus && !changed_focus) {',
			'reset_focus(url, !deep_linked);',
			'is_navigating = false;',
			'after_navigate_callbacks.forEach',
			'stores.navigating.set((navigating.current = null));',
		);
	});

	it('pins default focus to Kit reset_focus instead of a test-owned expectation', () => {
		const start = client.indexOf('function reset_focus(url, scroll = true) {');
		const end = client.indexOf('\n}\n', start);
		const resetFocus = client.slice(start, end);
		expect(resetFocus).toContain("document.querySelector('[autofocus]')");
		expect(resetFocus).toContain('const root = document.body;');
		expect(resetFocus).toContain('root.tabIndex = -1;');
		expect(resetFocus).toContain('root.focus({ preventScroll: true, focusVisible: false });');
	});

	it('executes the outcome harness with active-navigation suppression and no intervening flush', async () => {
		const navigating: Array<string | null> = [];
		const pages: string[] = [];
		const body = {};
		const activeElement = {};
		const simulator = new KitNavigationSimulator({
			publishPage: (href) => pages.push(href),
			publishNavigating: (navigation) => navigating.push(navigation?.to?.url.href ?? null),
			flushDom: async () => {},
			activeElement: () => activeElement,
			bodyElement: () => body,
			resetFocus: () => {},
		});
		const beforeTargets: string[] = [];
		simulator.beforeNavigate((navigation) => {
			beforeTargets.push(navigation.to?.url.href ?? 'null');
		});

		const original = simulator.startNavigation('http://localhost/lines');
		const successor = simulator.startNavigation('http://localhost/map');
		const normalizedRedirect = simulator.startNavigation('http://localhost/map/', undefined, {
			redirect: true,
		});

		expect(original.beforeNavigateDelivered).toBe(true);
		expect(successor.beforeNavigateDelivered).toBe(false);
		expect(normalizedRedirect.beforeNavigateDelivered).toBe(false);
		expect(beforeTargets).toEqual(['http://localhost/lines']);
		expect(simulator.acceptedPublications).toEqual([
			{ href: 'http://localhost/lines', flushRevision: 0 },
			{ href: 'http://localhost/map', flushRevision: 0 },
			{ href: 'http://localhost/map/', flushRevision: 0 },
		]);
		expect(successor.navigation.token).toBe(normalizedRedirect.navigation.token);
		await expect(original.navigation.complete).rejects.toThrow('navigation aborted');

		await simulator.commitNavigation('http://localhost/map');
		await expect(normalizedRedirect.navigation.complete).resolves.toBeUndefined();
		expect(pages).toEqual(['http://localhost/map']);
		expect(navigating.at(-1)).toBeNull();
	});

	it('executes accepted-target to committed-URL normalization in Kit commit order', async () => {
		const events: string[] = [];
		const body = {};
		const activeElement = {};
		const simulator = new KitNavigationSimulator({
			publishPage: (href) => events.push(`page:${new URL(href).pathname}`),
			publishNavigating: (navigation) => {
				if (!navigation) events.push('idle');
			},
			flushDom: async () => {
				events.push('flush');
			},
			activeElement: () => activeElement,
			bodyElement: () => body,
			resetFocus: (url) => events.push(`focus:${url.pathname}`),
		});
		simulator.onNavigate(() => events.push('onNavigate'));
		simulator.afterNavigate(() => events.push('afterNavigate'));
		simulator.startNavigation('http://localhost/map/');
		events.length = 0;

		await simulator.commitNavigation('http://localhost/map');

		expect(events).toEqual([
			'onNavigate',
			'page:/map',
			'flush',
			'flush',
			'flush',
			'focus:/map',
			'afterNavigate',
			'idle',
		]);
	});
});
