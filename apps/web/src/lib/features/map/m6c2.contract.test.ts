import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseCleanupReceipts } from './mapOwnerCleanup';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
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
