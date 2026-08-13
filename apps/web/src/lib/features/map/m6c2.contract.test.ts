import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseCleanupReceipts } from './mapOwnerCleanup';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const CURRENT_SHARED_CLOCK_TO_TTL = `
	// Keep one shared server-time tick alive for map freshness and relative-time copy.
	$effect(() => sharedClock.subscribe());

	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);`;
const BASE_SHARED_CLOCK_TO_TTL = `
	// Keep one shared server-time tick alive for map freshness and relative-time copy.
	$effect(() => sharedClock.subscribe());

	$effect(() => () => {
		untrack(() => vehicleMotion)?.destroy();
		for (const dispose of interactionDisposers) dispose();
	});

	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);`;
const CURRENT_MAP_HANDLE =
	'\t// Track map identity so teardown releases only the matching logical map owner.\n' +
	'\tlet map = $state.raw<MapLibreMap | null>(null);';
const BASE_MAP_HANDLE = '\tlet map = $state<MapLibreMap | null>(null);';
const CURRENT_OWNER_BOUNDARY = `
	function releaseMapOwners(m: MapLibreMap): void {
		if (map !== m) return;
		const motion = vehicleMotion;
		const disposers = interactionDisposers;
		vehicleMotion = null;
		vehicleMotionMap = null;
		interactionDisposers = [];
		interactionsMap = null;
		map = null;

		const releaseErrors: unknown[] = [];
		try {
			motion?.destroy();
		} catch (error) {
			releaseErrors.push(error);
		}
		for (const dispose of disposers) {
			try {
				dispose();
			} catch (error) {
				releaseErrors.push(error);
			}
		}
		try {
			emphasisController.clear(m);
		} catch (error) {
			releaseErrors.push(error);
		}
		if (releaseErrors.length === 1) throw releaseErrors[0];
		if (releaseErrors.length > 1) {
			throw new AggregateError(releaseErrors, 'MapHero owner cleanup failed');
		}
	}

	$effect(() => () => {
		const ownedMap = untrack(() => map);
		if (!ownedMap) return;
		try {
			releaseMapOwners(ownedMap);
		} catch (error) {
			// This fallback covers parent-first destruction. The normal child-first path
			// reports through MapStage's exception-isolated disposal boundary.
			try {
				console.error('MapHero cleanup failed', error);
			} catch {
				// Fault reporting cannot reopen the parent destruction path.
			}
		}
	});`;
const BASE_EMPHASIS_CLEANUP = '\t$effect(() => () => untrack(() => emphasisController.clear()));';
const CURRENT_INTERACTION_PUBLICATION = `
	function ensureMapInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		const previousDisposers = interactionDisposers;
		interactionDisposers = [];
		interactionsMap = null;
		const releaseErrors: unknown[] = [];
		for (const dispose of previousDisposers) {
			try {
				dispose();
			} catch (error) {
				releaseErrors.push(error);
			}
		}
		if (releaseErrors.length > 0) throw releaseErrors[0];
		const nextDisposers = installMapInteractions(m, {
			click: (event) => selectPickedFeature(m, event),
			mousemove: (event) => hoverPickedFeature(m, event),
			mouseleave: () => clearHover(m),
		});
		interactionDisposers = nextDisposers;
		interactionsMap = m;
	}`;
const BASE_INTERACTION_PUBLICATION = `
	function ensureMapInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		for (const dispose of interactionDisposers) dispose();
		interactionsMap = m;
		interactionDisposers = installMapInteractions(m, {
			click: (event) => selectPickedFeature(m, event),
			mousemove: (event) => hoverPickedFeature(m, event),
			mouseleave: () => clearHover(m),
		});
	}`;
const CURRENT_STAGE_WIRING = '\n\t\tonbeforeremove={releaseMapOwners}';
const CURE9_BREAKPOINT_RELEASE =
	"\t\treturn () => releaseMapOwner(() => mql.removeEventListener('change', onChange));";
const BASE_BREAKPOINT_RELEASE = "\t\treturn () => mql.removeEventListener('change', onChange);";
const CURE9_RAIL_RELEASE = `
		const dispose = publishRailOffset(el, detailWidthPx, open, detailCollapsed, detailDragging);
		return () => releaseMapOwner(dispose);`;
const BASE_RAIL_RELEASE =
	'\n\t\treturn publishRailOffset(el, detailWidthPx, open, detailCollapsed, detailDragging);';
const CURE8_OWNER_IMPORT = "\n\timport * as ownerCleanup from './mapOwnerCleanup';";
const CURE8_FETCH = '\t\tfetch: (input, init) => globalThis.fetch(input, init),';
const GATE7_FETCH = '\t\tfetch: (input) => globalThis.fetch(input),';
const CURE8_LIVE_BOUNDARY = `
	function reportMapCleanupFailure(error: unknown): void {
		ownerCleanup.reportCleanupFailure('MapHero cleanup failed', error);
	}
	function releaseMapOwner(dispose: () => void): void {
		ownerCleanup.releaseWithRetry(dispose, reportMapCleanupFailure);
	}
	$effect(() => () => {
		releaseMapOwner(nearMeController.dispose);
		releaseMapOwner(urlCoordinator.dispose);
	});
	onMount(() => {
		live.start();
		return () => releaseMapOwner(() => live.stop());
	});

	// Keep one shared server-time tick alive for map freshness and relative-time copy.
	$effect(() => {
		const unsubscribe = sharedClock.subscribe();
		return () => releaseMapOwner(unsubscribe);
	});`;
const GATE7_LIVE_BOUNDARY = `
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Keep one shared server-time tick alive for map freshness and relative-time copy.
	$effect(() => sharedClock.subscribe());`;
const CURE8_OWNER_BOUNDARY = `
	function releaseMapOwners(m: MapLibreMap): void {
		if (map !== m) return;
		const released = ownerCleanup.releaseMapOwnerReceipts(vehicleMotion, interactionDisposers, () =>
			emphasisController.clear(m),
		);
		vehicleMotion = released.motion;
		vehicleMotionMap = released.motion ? m : null;
		interactionDisposers = released.disposers;
		interactionsMap = released.disposers.length > 0 ? m : null;
		map = released.motion || released.disposers.length > 0 || released.emphasisPending ? m : null;
		ownerCleanup.throwCleanupErrors(released.errors, 'MapHero owner cleanup failed');
	}

	$effect(() => () => {
		const ownedMap = untrack(() => map);
		if (!ownedMap) return;
		try {
			releaseMapOwners(ownedMap);
		} catch (error) {
			// This fallback covers parent-first destruction. The normal child-first path
			// reports through MapStage's exception-isolated disposal boundary.
			reportMapCleanupFailure(error);
		}
	});`;
const CURE8_INTERACTION_PUBLICATION = `
	function ensureMapInteractions(m: MapLibreMap): void {
		if (interactionsMap === m) return;
		const previousMap = interactionsMap;
		const released = ownerCleanup.releaseCleanupReceipts(interactionDisposers);
		interactionDisposers = released.pending;
		interactionsMap = released.pending.length > 0 ? previousMap : null;
		ownerCleanup.throwCleanupErrors(released.errors, 'Map interaction replacement cleanup failed');
		const nextDisposers = ownerCleanup.installCleanupReceipts(
			() =>
				installMapInteractions(m, {
					click: (event) => selectPickedFeature(m, event),
					mousemove: (event) => hoverPickedFeature(m, event),
					mouseleave: () => clearHover(m),
				}),
			(partial) => {
				interactionDisposers = partial;
				interactionsMap = null;
			},
		);
		interactionDisposers = nextDisposers;
		interactionsMap = m;
	}`;
const CURE8_SELECTION_RELEASE = `
	$effect(() => {
		const release =
			selected?.kind === 'vehicle'
				? live.subscribeFamilies(['trips'])
				: selected?.kind === 'stop'
					? live.subscribeFamilies(['departures'])
					: null;
		if (!release) return;
		return () => releaseMapOwner(release);
	});`;
const GATE7_SELECTION_RELEASE = `
	$effect(() => {
		if (selected?.kind === 'vehicle') return live.subscribeFamilies(['trips']);
		if (selected?.kind === 'stop') return live.subscribeFamilies(['departures']);
	});`;
const M6E_HOVER_CONTEXT = `
			alerts: live.alerts?.alerts ?? null,
			departuresAvailable,
			hoverRoute:
				hovered?.kind === 'route' && focusedRoute.data?.id === hovered.id
					? focusedRoute.data
					: null,`;
const M6E_DESKTOP_PREVIEW =
	'\n\t\t\t\tonpreview={(next) => void selectionController.setHovered(next)}';
const M6E_MOBILE_PREVIEW =
	'\n\t\t\tonpreview={(next) => void selectionController.setHovered(next)}';
const M6E_PICK_COMPACTION = `
		commitPickedSelection(next);
		detailCollapsed = false;
		focusSelection(next);`;
const BASE_PICK_COMMENTS = `
		commitPickedSelection(next);
		// A fresh pick always shows its detail: if the panel was sitting collapsed in
		// the icon strip, expand it so the new selection is visible, never stranded.
		detailCollapsed = false;
		// Zoom to whatever was clicked, same as a search pick (data is already
		// loaded — it's on the map). Point entities centre + zoom in; a route frames
		// its linework.
		focusSelection(next);`;
const M6E_NEARBY_COMPACTION = `
		commitPickedSelection({ kind: 'stop', id: stop.id });
		detailCollapsed = false;`;
const BASE_NEARBY_COMMENT = `
		commitPickedSelection({ kind: 'stop', id: stop.id });
		// A fresh pick always shows its detail: expand the panel if it was collapsed.
		detailCollapsed = false;`;

function reconstructBaseMapHero(hero: string): string {
	const replacements: ReadonlyArray<readonly [string, string]> = [
		[M6E_HOVER_CONTEXT, ''],
		[M6E_DESKTOP_PREVIEW, ''],
		[M6E_MOBILE_PREVIEW, ''],
		[M6E_PICK_COMPACTION, BASE_PICK_COMMENTS],
		[M6E_NEARBY_COMPACTION, BASE_NEARBY_COMMENT],
		[CURE9_BREAKPOINT_RELEASE, BASE_BREAKPOINT_RELEASE],
		[CURE9_RAIL_RELEASE, BASE_RAIL_RELEASE],
		[CURE8_OWNER_IMPORT, ''],
		[CURE8_FETCH, GATE7_FETCH],
		[CURE8_LIVE_BOUNDARY, GATE7_LIVE_BOUNDARY],
		[CURE8_OWNER_BOUNDARY, CURRENT_OWNER_BOUNDARY],
		[CURE8_INTERACTION_PUBLICATION, CURRENT_INTERACTION_PUBLICATION],
		[CURE8_SELECTION_RELEASE, GATE7_SELECTION_RELEASE],
		[CURRENT_SHARED_CLOCK_TO_TTL, BASE_SHARED_CLOCK_TO_TTL],
		[CURRENT_MAP_HANDLE, BASE_MAP_HANDLE],
		[CURRENT_OWNER_BOUNDARY, BASE_EMPHASIS_CLEANUP],
		[CURRENT_INTERACTION_PUBLICATION, BASE_INTERACTION_PUBLICATION],
		[CURRENT_STAGE_WIRING, ''],
	];
	let reconstructed = hero;
	for (const [index, [current, base]] of replacements.entries()) {
		expect(reconstructed.split(current), `reconstruction replacement ${index}`).toHaveLength(2);
		reconstructed = reconstructed.replace(current, base);
	}
	return reconstructed;
}

function withoutComments(value: string): string {
	return value
		.replace(/<!--[^]*?-->/g, '')
		.replace(/\/\*[^]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '');
}

function productionTokenFingerprint(): string[] {
	const root = resolve(process.cwd(), 'src');
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (!/\.(?:test|spec)\.[^.]+$/.test(entry.name)) files.push(path);
		}
	};
	walk(root);

	return files
		.flatMap((path) =>
			readFileSync(path, 'utf8')
				.split('\n')
				.filter((line) => /--(?:size-tap-min|strip-)/.test(line))
				.map((line) => `${relative(root, path)}:${line.trim()}`),
		)
		.sort();
}

describe('M6C-2 token and protected-surface contract', () => {
	it('releases cleanup receipts for exactly one pass', () => {
		const failure = new Error('cleanup failed');
		let attempts = 0;
		const dispose = () => {
			attempts += 1;
			throw failure;
		};

		const released = Reflect.apply(releaseCleanupReceipts, undefined, [[dispose], 2]);

		expect(attempts).toBe(1);
		expect(released.pending).toEqual([dispose]);
		expect(released.errors).toEqual([failure]);
	});

	it('keeps disclosure summaries as list-items so the ::marker affordance survives', () => {
		// display:flex/grid/block on a summary drops the UA disclosure triangle —
		// the collapsed sections' only expand cue (red-team blocker, cured).
		for (const file of [
			'src/lib/features/map/detail/DetailSection.svelte',
			'src/lib/features/map/MapSelectionDetail.svelte',
		]) {
			const source = readFileSync(resolve(process.cwd(), file), 'utf-8');
			for (const block of source.matchAll(/summary[^{]*\{([^}]*)\}/g)) {
				expect(block[1]).not.toMatch(/display\s*:\s*(flex|grid|block|inline)/);
			}
		}
	});

	it('declares the two app-local size tokens beside the byte-stable tap token', () => {
		const appCss = source('src/app.css');
		const root = appCss.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? '';

		expect(root).toContain('--size-tap-min: 44px');
		expect(root).toContain('--size-detail-panel: 360px');
		expect(root).toContain('--size-detail-rail: 3.7rem');
		expect(appCss.match(/--size-tap-min\s*:/g)).toHaveLength(1);
	});

	it('replaces only the named raw size consumers while preserving the numeric clamp export', () => {
		const rightPanel = withoutComments(source('src/lib/components/shell/RightPanel.svelte'));
		const overlay = withoutComments(source('src/lib/features/map/MapDetailOverlay.svelte'));
		const panes = withoutComments(source('src/lib/features/map/mapDetailPanes.ts'));
		const hero = withoutComments(source('src/lib/features/map/MapHero.svelte'));

		expect(rightPanel).toContain('width: var(--size-detail-panel)');
		expect(hero).toContain('--app-right-detail-offset: var(--size-detail-panel)');
		expect(overlay).toContain("collapsed ? 'var(--size-detail-rail)'");
		expect(panes).toContain("collapsed ? 'var(--size-detail-rail)' : detailWidth");
		expect(rightPanel.match(/var\(--size-detail-rail\)/g)).toHaveLength(3);
		expect(panes).toContain('export const DEFAULT_DETAIL_PANEL_WIDTH = 360');

		expect(rightPanel).not.toContain('width: 360px');
		expect(hero).not.toContain('--app-right-detail-offset: 360px');
		expect(overlay).not.toMatch(/collapsed \? '3\.7rem'/);
		expect(panes).not.toMatch(/collapsed \? '3\.7rem'/);
	});

	it('replaces the live directional shadow with a theme-aware semantic token', () => {
		const appCss = source('src/app.css');
		const rightPanel = withoutComments(source('src/lib/components/shell/RightPanel.svelte'));

		expect(appCss).toMatch(/:root\s*\{[\s\S]*--shadow-detail-panel:/);
		expect(appCss).toMatch(
			/\[data-theme='light'\],[\s\S]*\.theme-light\s*\{[\s\S]*--shadow-detail-panel:/,
		);
		expect(rightPanel).toContain('box-shadow: var(--shadow-detail-panel)');
		expect(rightPanel).not.toContain('rgba(0, 0, 0, 0.45)');
	});

	it('reconstructs the exact pre-M6H MapHero after removing only approved disposal seams', () => {
		const hero = source('src/lib/features/map/MapHero.svelte');
		const reconstructed = reconstructBaseMapHero(hero);
		expect(hero).not.toContain('attachMapDetailRouteExit');
		expect(hero).not.toContain('mapDetailNavigationLifecycle');
		expect(hero).not.toContain('mapDisposalBarrier');
		expect(
			hero.split('\tconst selectionController = createMapSelectionController();'),
		).toHaveLength(2);
		const liveConsumer = '--app-right-detail-offset: var(--size-detail-panel);';
		expect(hero.split(liveConsumer)).toHaveLength(2);
		expect(hero.match(/function releaseMapOwners\(/gu)).toHaveLength(1);
		expect(hero).toContain('onbeforeremove={releaseMapOwners}');
		// M6f-2 F19: the STM licence is a RUNTIME manifest value, so the hero hands
		// the manifest's own string straight to the stage — no repo constant, no
		// local rewording, nothing between the manifest and the credit surface.
		expect(hero).toContain('customAttribution={manifest.attribution}');
		expect(hero).not.toMatch(/CC BY|Contains STM/);
		expect(hero).toContain('const nextDisposers = ownerCleanup.installCleanupReceipts');
		expect(createHash('sha256').update(reconstructed).digest('hex')).toBe(
			// M6f-2: +1 line — `customAttribution={manifest.attribution}` on MapStage.
			'70008fbff011bb3b945113e8e4b022880e4c83cc976748cf6d1b5edbc7716530',
		);
	});

	it('keeps the whole production tap and strip token fingerprint byte-stable', () => {
		expect(productionTokenFingerprint()).toEqual([
			'app.css:--size-tap-min: 44px;',
			'app.css:--strip-h: 68px;',
			'lib/components/layout/Footer.svelte:<FooterGroup label={t.auditLabel} style="--size-tap-min: 0px;">',
			'lib/components/layout/Footer.svelte:<FooterGroup label={t.exploreLabel} style="--size-tap-min: 0px;">',
			'lib/components/layout/Footer.svelte:<FooterGroup label={t.legalLabel} style="--size-tap-min: 0px;">',
			'lib/components/layout/ListingPageShell.svelte:min-height: var(--size-tap-min);',
			'lib/components/surface/EntityDetail.svelte:min-height: var(--size-tap-min);',
			'lib/components/surface/EntityDetail.svelte:padding-block: calc((var(--strip-h) - 3px - var(--size-tap-min)) / 2);',
			'lib/components/surface/MapDrilldownLink.svelte:min-height: var(--size-tap-min);',
			'lib/components/surface/SearchInput.svelte:min-height: var(--size-tap-min);',
			'lib/features/metrics/MetricInfo.svelte:HIT area is expanded to --size-tap-min via a centered transparent overlay.',
			'lib/features/metrics/MetricInfo.svelte:min-block-size: var(--size-tap-min);',
			'lib/features/metrics/MetricInfo.svelte:min-inline-size: var(--size-tap-min);',
			'lib/features/stops/StopsIndex.svelte:min-height: var(--size-tap-min);',
			'lib/features/trips/TripDetail.svelte:min-height: var(--size-tap-min);',
		]);
	});

	it('keeps the forced-hover probe on the real passive peek seam', () => {
		const probe = source('scripts/live-resilience-probe.mjs');

		expect(probe).toContain('vehicleHover: \'.map-peek .map-hover-peek[data-kind="vehicle"]\'');
		expect(probe).not.toContain('.map-peek .map-selection-detail[data-kind="vehicle"]');
	});
});
