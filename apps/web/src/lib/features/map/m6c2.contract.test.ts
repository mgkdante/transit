import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const OBSOLETE_M6H_ROUTE_EXIT = 'attachMapDetailRouteExit';
const M6H_CURE2_MAP_HANDLE =
	'\t// MapLibre is an opaque lifecycle owner. Track handle replacement, never proxy\n' +
	'\t// the instance itself; teardown callbacks must compare and release the exact map.\n' +
	'\tlet map = $state.raw<MapLibreMap | null>(null);';
const M6H_CURE2_OWNER_RELEASE = `
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
		if (releaseErrors.length > 0) throw releaseErrors[0];
	}
`;
const M6H_CURE2_STAGE_WIRING = '\n\t\tonbeforeremove={releaseMapOwners}';
const M6H_CURE3_RECOVERY_IMPORT =
	"\timport { attachMapDetailNavigationRecovery } from './mapDetailNavigationRecovery';\n";
const M6H_CURE4_PAGE_STORES_IMPORT = "\timport { navigating, page } from '$app/stores';\n";
const PRE_M6H_PAGE_STORES_IMPORT = "\timport { page } from '$app/stores';\n";
const M6H_CURE3_RECOVERY_WIRING = `
	const mapDetailNavigationRecovery = attachMapDetailNavigationRecovery({
		currentUrl: urlCoordinator.currentUrl,
		goto: urlCoordinator.goto,
	});
`;
const PRE_M6H_URL_INGESTION = `
	let ingestedUrlIdentity = '';
	$effect(() => {
		const url = $page.url;
		const urlIdentity = \`\${url.pathname}\${url.search}\`;
		if (urlIdentity === ingestedUrlIdentity) return;
		ingestedUrlIdentity = urlIdentity;
		filters.replaceFromUrl(fromSearchParams(url.searchParams), urlCoordinator.settle(url));`;
const M6H_CURE4_RECOVERY_INGESTION = `
	let observedPageUrl: URL | null = null;
	let ingestedUrlIdentity = '';
	$effect(() => {
		const url = $page.url;
		if (url === observedPageUrl) return;
		observedPageUrl = url;
		const urlIdentity = \`\${url.pathname}\${url.search}\`;
		const mapSettlement = mapDetailNavigationRecovery.settle(
			url,
			urlCoordinator.settle,
			$navigating?.to?.url ?? null,
		);
		if (mapSettlement === 'recovered') return;
		if (urlIdentity === ingestedUrlIdentity) return;
		ingestedUrlIdentity = urlIdentity;
		filters.replaceFromUrl(fromSearchParams(url.searchParams), mapSettlement);`;

function withoutM6hLifecycle(value: string): string {
	return value
		.replace(M6H_CURE2_MAP_HANDLE, '\tlet map = $state<MapLibreMap | null>(null);')
		.replace(M6H_CURE2_OWNER_RELEASE, '')
		.replace(M6H_CURE2_STAGE_WIRING, '')
		.replace(M6H_CURE4_PAGE_STORES_IMPORT, PRE_M6H_PAGE_STORES_IMPORT)
		.replace(M6H_CURE3_RECOVERY_IMPORT, '')
		.replace(M6H_CURE3_RECOVERY_WIRING, '')
		.replace(M6H_CURE4_RECOVERY_INGESTION, PRE_M6H_URL_INGESTION);
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

	it('keeps the M6C-2 MapHero bytes fixed outside the registered M6H lifecycle seams', () => {
		const hero = source('src/lib/features/map/MapHero.svelte');
		expect(hero).not.toContain(OBSOLETE_M6H_ROUTE_EXIT);
		expect(
			hero.split('\tconst selectionController = createMapSelectionController();'),
		).toHaveLength(2);
		expect(hero.split(M6H_CURE2_MAP_HANDLE)).toHaveLength(2);
		expect(hero.split(M6H_CURE2_OWNER_RELEASE)).toHaveLength(2);
		expect(hero.split(M6H_CURE2_STAGE_WIRING)).toHaveLength(2);
		expect(hero.split(M6H_CURE4_PAGE_STORES_IMPORT)).toHaveLength(2);
		expect(hero.split(M6H_CURE3_RECOVERY_IMPORT)).toHaveLength(2);
		expect(hero.split(M6H_CURE3_RECOVERY_WIRING)).toHaveLength(2);
		expect(hero.split(M6H_CURE4_RECOVERY_INGESTION)).toHaveLength(2);
		const protectedHero = withoutM6hLifecycle(hero);
		const protectedRegion = protectedHero.split('\n').slice(19, 882).join('\n') + '\n';
		const digest = createHash('sha256').update(protectedRegion).digest('hex');
		const liveConsumer = '--app-right-detail-offset: var(--size-detail-panel);';
		const reconstructedPreEditHero = protectedHero.replace(
			liveConsumer,
			'--app-right-detail-offset: 360px;',
		);

		expect(digest).toBe('f1dcbc7ca685a9e31b581571e0f2d4ab27d5a025cff86792c5970ff9b3633a02');
		expect(protectedHero.split(liveConsumer)).toHaveLength(2);
		expect(createHash('sha256').update(reconstructedPreEditHero).digest('hex')).toBe(
			'4e00edb78af11065fbd2f04d18e37fbead6a2acc4df71a231c7906c5a310820f',
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
