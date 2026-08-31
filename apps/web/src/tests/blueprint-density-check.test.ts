import { describe, expect, it } from 'vitest';
import {
	BLUEPRINT_TOKEN_VALUES,
	parseBlueprintDensityArgs,
	validateBlueprintDensity,
} from '../../scripts/blueprint-density-core.mjs';

type Theme = 'dark' | 'light';

const tokensByTheme = {
	dark: {
		'--blueprint-ink-quiet': 0.14,
		'--blueprint-ink-mid': 0.22,
		'--blueprint-ink-accent': 0.3,
	},
	light: {
		'--blueprint-ink-quiet': 0.28,
		'--blueprint-ink-mid': 0.42,
		'--blueprint-ink-accent': 0.56,
	},
} as const;

function measuredPart(
	part: string,
	overrides: Partial<{
		hero: boolean;
		hPct: number;
		renderedOpacity: number;
		authoredInk: string;
		band: number;
		weightedInk: number;
		intersectsCopyZone: boolean;
		collisions: Array<{ zone: string; text: string }>;
	}> = {},
) {
	return {
		part,
		hero: false,
		xPct: 0,
		yPct: 0,
		wPct: 20,
		hPct: 40,
		ownOpacity: 1,
		renderedOpacity: 0.14,
		authoredInk: 'var(--blueprint-ink-quiet)',
		band: 0,
		weightedInk: 10,
		intersectsCopyZone: false,
		collisions: [],
		...overrides,
	};
}

function validMeasurement(theme: Theme = 'dark') {
	const tokenValues = tokensByTheme[theme];
	const quiet = tokenValues['--blueprint-ink-quiet'];
	const details = [
		measuredPart('part-1', { hPct: 60, renderedOpacity: quiet, band: 0, weightedInk: 10 }),
		measuredPart('part-2', { hPct: 60, renderedOpacity: quiet, band: 0, weightedInk: 10 }),
		measuredPart('part-3', { hPct: 40, renderedOpacity: quiet, band: 0, weightedInk: 10 }),
		measuredPart('part-4', { hPct: 40, renderedOpacity: quiet, band: 1, weightedInk: 9 }),
		measuredPart('part-5', { hPct: 40, renderedOpacity: quiet, band: 1, weightedInk: 9 }),
		measuredPart('part-6', { hPct: 40, renderedOpacity: quiet, band: 1, weightedInk: 9 }),
		measuredPart('part-7', { hPct: 20, renderedOpacity: quiet, band: 1, weightedInk: 8 }),
		measuredPart('part-8', { hPct: 20, renderedOpacity: quiet, band: 2, weightedInk: 12 }),
		measuredPart('part-9', { hPct: 20, renderedOpacity: quiet, band: 2, weightedInk: 12 }),
		measuredPart('part-10', { hPct: 20, renderedOpacity: quiet, band: 2, weightedInk: 11 }),
	];
	return {
		name: 'lines',
		url: 'https://preview.example.test/lines',
		appliedTheme: theme,
		header: { width: 1280, height: 256 },
		tokens: { ...tokenValues },
		copyZones: [
			{ name: 'title-lede', xPct: 0, yPct: 60, wPct: 50, hPct: 30 },
			{ name: 'metrics', xPct: 70, yPct: 60, wPct: 25, hPct: 30 },
		],
		parts: [
			measuredPart('hero', {
				hero: true,
				hPct: 100,
				renderedOpacity: 0.16,
				authoredInk: '',
				band: Number.NaN,
				weightedInk: 10_000,
			}),
			...details,
		],
		refLabelWarnings: [] as Array<{
			text: string;
			zone: string;
			xPct: number;
			yPct: number;
			wPct: number;
			hPct: number;
		}>,
	};
}

describe('blueprint density receipt contract', () => {
	it('parses the requested theme and matrix viewport', () => {
		expect(
			parseBlueprintDensityArgs([
				'https://preview.example.test',
				'--theme',
				'light',
				'--viewport',
				'390x844',
			]),
		).toEqual({
			previewUrl: new URL('https://preview.example.test'),
			theme: 'light',
			viewport: { width: 390, height: 844 },
		});
		expect(() =>
			parseBlueprintDensityArgs(['https://preview.example.test', '--theme', 'sepia']),
		).toThrow(/--theme must be dark or light/);
		expect(() => parseBlueprintDensityArgs([])).toThrow(
			'Preview URL is required; call parseBlueprintDensityArgs([url, ...options])',
		);
	});

	it('defines the adjudicated token ladders for both themes', () => {
		expect(BLUEPRINT_TOKEN_VALUES).toEqual(tokensByTheme);
	});

	it('fails when the applied document theme differs from the requested matrix cell', () => {
		const result = validMeasurement('light');
		result.appliedTheme = 'dark';

		expect(
			validateBlueprintDensity(result, {
				theme: 'light',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toContain('lines: applied theme is dark, expected light');
	});

	it('excludes the hero from scale roles and desktop band ink while retaining it in partCount', () => {
		const validation = validateBlueprintDensity(validMeasurement(), {
			theme: 'dark',
			viewport: { width: 1280, height: 900 },
		});

		expect(validation.failures).toEqual([]);
		expect(validation.summary).toMatchObject({
			partCount: 11,
			roleCounts: { anchor: 2, support: 4, detail: 4 },
			bandInk: [30, 35, 35],
			bandPct: [30, 35, 35],
		});
	});

	it('keeps the hero partCount-only while detail engraved-label collisions remain gating', () => {
		const heroCollision = validMeasurement();
		heroCollision.parts[0].collisions.push({ zone: 'title-lede', text: 'HERO TITLE BLOCK' });
		expect(
			validateBlueprintDensity(heroCollision, {
				theme: 'dark',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toEqual([]);

		const detailCollision = validMeasurement();
		detailCollision.parts[1].collisions.push({ zone: 'title-lede', text: 'DETAIL LABEL' });
		expect(
			validateBlueprintDensity(detailCollision, {
				theme: 'dark',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toContain('lines/part-1: label "DETAIL LABEL" intersects title-lede');
	});

	it('fails closed when either copy-zone selector rots', () => {
		const result = validMeasurement();
		result.copyZones.pop();

		expect(
			validateBlueprintDensity(result, {
				theme: 'dark',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toContain('lines: 1 copy zones, expected exactly 2');
	});

	it('fails closed for zero rendered detail ink and a non-finite detail band', () => {
		const zeroInk = validMeasurement();
		for (const part of zeroInk.parts.filter((part) => !part.hero)) part.weightedInk = 0;
		expect(
			validateBlueprintDensity(zeroInk, {
				theme: 'dark',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toContain('lines: total rendered detail ink is 0');

		const badBand = validMeasurement();
		badBand.parts[1].band = Number.NaN;
		expect(
			validateBlueprintDensity(badBand, {
				theme: 'dark',
				viewport: { width: 1280, height: 900 },
			}).failures,
		).toContain('lines/part-1: band index is not finite');
	});

	it('limits the narrow matrix cell to tokens, ladder, and copy-zone checks', () => {
		const result = validMeasurement('light');
		for (const part of result.parts.filter((part) => !part.hero)) {
			part.hPct = 5;
			part.band = 2;
			part.weightedInk = 1;
		}

		const validation = validateBlueprintDensity(result, {
			theme: 'light',
			viewport: { width: 390, height: 844 },
		});
		expect(validation.failures).toEqual([]);
	});

	it('keeps the desktop band gate tied to the 1280px layout width', () => {
		const result = validMeasurement();
		for (const part of result.parts.filter((part) => !part.hero)) {
			part.band = 2;
			part.weightedInk = 1;
		}

		expect(
			validateBlueprintDensity(result, {
				theme: 'dark',
				viewport: { width: 1280, height: 844 },
			}).failures,
		).toContain('lines: band 1 carries 0% rendered detail ink');
	});

	it('keeps vendor reference-label intersections as non-gating warnings', () => {
		const result = validMeasurement();
		result.refLabelWarnings.push({
			text: 'DWG: TRANSIT-LINE-ELEV',
			zone: 'title-lede',
			xPct: 4,
			yPct: 88,
			wPct: 14,
			hPct: 4,
		});

		const validation = validateBlueprintDensity(result, {
			theme: 'dark',
			viewport: { width: 1280, height: 900 },
		});
		expect(validation.failures).toEqual([]);
		expect(validation.summary.refLabelWarningCount).toBe(1);
	});
});
