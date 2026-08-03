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

	it('does not let an accepted option bypass the real beforeNavigate cancellation callback', () => {
		const simulator = new KitNavigationSimulator({
			publishPage: () => {},
			publishNavigating: () => {},
			settled: async () => {},
			tick: async () => {},
			activeElement: () => null,
			bodyElement: () => null,
			resetFocus: () => {},
		});
		const bypass = simulator.startNavigation('http://localhost/lines', undefined, {
			accepted: false,
		} as Parameters<KitNavigationSimulator['startNavigation']>[2]);
		expect(bypass.accepted).toBe(true);

		simulator.reset();
		const release = simulator.beforeNavigate((navigation) => navigation.cancel());
		const cancelled = simulator.startNavigation('http://localhost/lines');
		release();

		expect(cancelled.accepted).toBe(false);
		expect(simulator.acceptedPublications).toEqual([]);
	});

	it('rejects superseded work only when that work reaches Kit stale-token checkpoints', async () => {
		const simulator = new KitNavigationSimulator({
			publishPage: () => {},
			publishNavigating: () => {},
			settled: async () => {},
			tick: async () => {},
			activeElement: () => null,
			bodyElement: () => null,
			resetFocus: () => {},
		});
		const predecessor = simulator.startNavigation('http://localhost/lines');
		let predecessorState: 'pending' | 'fulfilled' | 'rejected' = 'pending';
		void predecessor.navigation.complete.then(
			() => (predecessorState = 'fulfilled'),
			() => (predecessorState = 'rejected'),
		);

		simulator.startNavigation('http://localhost/map');
		await Promise.resolve();
		expect(predecessorState).toBe('pending');
		expect(simulator.reachLoadCheckpoint(predecessor.navigation)).toBe(false);
		await expect(predecessor.navigation.complete).rejects.toThrow('navigation aborted');
	});

	it('normalizes the full shared navigation URL object before onNavigate', async () => {
		const seenHrefs: string[] = [];
		const simulator = new KitNavigationSimulator({
			publishPage: () => {},
			publishNavigating: () => {},
			settled: async () => {},
			tick: async () => {},
			activeElement: () => null,
			bodyElement: () => null,
			resetFocus: () => {},
		});
		simulator.onNavigate((navigation) => seenHrefs.push(navigation.to?.url.href ?? 'null'));
		const started = simulator.startNavigation('http://localhost/map/?queued=1#old');
		const acceptedUrl = started.navigation.to?.url;

		await simulator.commitNavigation('http://localhost/map?settled=1#new');

		expect(started.navigation.to?.url).toBe(acceptedUrl);
		expect(started.navigation.to?.url.href).toBe('http://localhost/map?settled=1#new');
		expect(seenHrefs).toEqual(['http://localhost/map?settled=1#new']);
	});

	it('executes the outcome harness with active-navigation suppression and no intervening flush', async () => {
		const navigating: Array<string | null> = [];
		const pages: string[] = [];
		const body = {};
		const activeElement = {};
		const simulator = new KitNavigationSimulator({
			publishPage: (href) => pages.push(href),
			publishNavigating: (navigation) => navigating.push(navigation?.to?.url.href ?? null),
			settled: async () => {},
			tick: async () => {},
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
		expect(simulator.reachLoadCheckpoint(original.navigation)).toBe(false);
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
			settled: async () => {
				events.push('settled');
			},
			tick: async () => {
				events.push('tick');
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
			'settled',
			'tick',
			'tick',
			'focus:/map',
			'afterNavigate',
			'idle',
		]);
	});

	it('keeps Kit commit work before the post-DOM stale-token checkpoint', async () => {
		const events: string[] = [];
		const simulator = new KitNavigationSimulator({
			publishPage: (href) => events.push(`page:${new URL(href).pathname}`),
			publishNavigating: (navigation) =>
				events.push(navigation ? `navigating:${navigation.to?.url.pathname}` : 'idle'),
			settled: async () => {
				events.push('settled');
			},
			tick: async () => {
				events.push('tick');
			},
			activeElement: () => null,
			bodyElement: () => null,
			resetFocus: () => {},
		});
		let superseded = false;
		simulator.onNavigate((navigation) => {
			events.push(`onNavigate:${navigation.to?.url.pathname}`);
			if (!superseded) {
				superseded = true;
				simulator.startNavigation('http://localhost/second');
			}
		});
		simulator.startNavigation('http://localhost/first');
		events.length = 0;

		await expect(simulator.commitNavigation('http://localhost/first')).rejects.toThrow(
			'navigation superseded',
		);

		expect(events).toEqual([
			'onNavigate:/first',
			'navigating:/second',
			'page:/first',
			'settled',
			'tick',
			'tick',
		]);
	});
});
