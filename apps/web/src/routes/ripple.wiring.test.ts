import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf-8');

function rippleExemptionSources(): string[] {
	return readdirSync(resolve(process.cwd(), 'src'), { recursive: true })
		.filter((path): path is string => typeof path === 'string' && path.endsWith('.svelte'))
		.flatMap((path) => {
			const contents = readFileSync(resolve(process.cwd(), 'src', path), 'utf-8');
			return Array.from(
				contents.matchAll(/<[^>]*\sdata-ripple-exempt(?=\s|=|>)/g),
				() => `src/${path}`,
			);
		})
		.sort();
}

describe('global ripple wiring', () => {
	it('initializes one exempted global ripple and marks exactly the three interactive surfaces it must skip', () => {
		const layout = source('src/routes/+layout.svelte');
		const mapStage = source('src/lib/components/map/MapStage.svelte');
		const mapDetailOverlay = source('src/lib/features/map/MapDetailOverlay.svelte');
		const entityDetail = source('src/lib/components/surface/EntityDetail.svelte');

		expect(layout).toContain("import '@yesid/motion/ripple.css'");
		expect(layout).toContain("import { initGlobalRipple } from '@yesid/motion/utils/globalRipple'");
		expect(layout).toMatch(/initGlobalRipple\(\{ exclude: '\[data-ripple-exempt\]' \}\)/);
		expect(layout).toMatch(
			/const disposeRipple = initGlobalRipple[\s\S]*const disposeVitals = startVitals\(\)[\s\S]*return \(\) => \{[\s\S]*disposeRipple\(\)[\s\S]*disposeVitals\(\)/,
		);

		expect(mapStage).toMatch(
			/<div(?=[^>]*\sdata-ripple-exempt(?=\s|=|>))(?=[^>]*\sdata-slot="map-stage"(?=\s|>))[^>]*>/,
		);
		expect(mapDetailOverlay).toMatch(
			/<div(?=[^>]*\sclass="map-detail-handle"(?=\s|>))(?=[^>]*\sdata-ripple-exempt(?=\s|=|>))[^>]*>/,
		);
		expect(entityDetail).toMatch(
			/<div(?=[^>]*\sclass="entity-tabs__scroll"(?=\s|>))(?=[^>]*\sdata-ripple-exempt(?=\s|=|>))[^>]*>/,
		);
		expect(rippleExemptionSources()).toEqual([
			'src/lib/components/map/MapStage.svelte',
			'src/lib/components/surface/EntityDetail.svelte',
			'src/lib/features/map/MapDetailOverlay.svelte',
		]);
	});
});
