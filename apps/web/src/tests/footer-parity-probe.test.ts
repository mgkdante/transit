import { describe, expect, it } from 'vitest';
import {
	assertFullBleed,
	buildScenarioMatrix,
	findSystemDateNodeMatch,
	parseCliArgs,
} from '../../scripts/footer-parity-probe.mjs';

describe('footer parity probe script contract', () => {
	it('parses a parameterized HTTP base URL without discarding its path', () => {
		expect(
			parseCliArgs([
				'--base-url',
				'https://preview.example/transit/',
				'--out',
				'/tmp/transit-footer-probe',
				'--executable-path',
				'/opt/chromium',
			]),
		).toEqual({
			baseUrl: 'https://preview.example/transit/',
			outDir: '/tmp/transit-footer-probe',
			executablePath: '/opt/chromium',
		});
	});

	it('rejects incomplete or unsafe base URLs and output paths', () => {
		expect(() => parseCliArgs([])).toThrow(/--base-url/);
		expect(() =>
			parseCliArgs(['--base-url', 'file:///tmp/transit', '--out', '/tmp/transit-footer-probe']),
		).toThrow(/http or https/);
		expect(() =>
			parseCliArgs([
				'--base-url',
				'https://user:secret@preview.example/',
				'--out',
				'/tmp/transit-footer-probe',
			]),
		).toThrow(/credentials/);
		expect(() => parseCliArgs(['--base-url', 'https://preview.example/', '--out', '/'])).toThrow(
			/filesystem root/,
		);
	});

	it('locks seven widths, two themes, and both canonical locale routes', () => {
		const matrix = buildScenarioMatrix();

		expect(matrix).toHaveLength(28);
		expect([...new Set(matrix.map(({ width }) => width))]).toEqual([
			639, 640, 767, 768, 1023, 1024, 1280,
		]);
		expect([...new Set(matrix.map(({ theme }) => theme))]).toEqual(['dark', 'light']);
		expect([...new Set(matrix.map(({ route }) => route))]).toEqual(['/', '/fr']);
		expect(matrix[0]).toEqual({
			id: 'w0639-dark-en',
			width: 639,
			theme: 'dark',
			locale: 'en',
			route: '/',
		});
	});

	it('rejects a constrained row while accepting footer-wide grid and status geometry', () => {
		const fullBleed = {
			footer: { left: 0, right: 1280, width: 1280 },
			grid: { left: 0, right: 1280, width: 1280 },
			statusBar: { left: 0, right: 1280, width: 1280 },
		};
		expect(() => assertFullBleed(fullBleed)).not.toThrow();
		expect(() =>
			assertFullBleed({
				...fullBleed,
				grid: { left: 128, right: 1152, width: 1024 },
			}),
		).toThrow(/grid.*full bleed/);
	});

	it('isolates the exact system-date text node for the narrow mask', () => {
		expect(findSystemDateNodeMatch(['SYSTÈME ', '2026.07.30'])).toEqual({
			nodeIndex: 1,
			start: 0,
			end: 10,
			value: '2026.07.30',
		});
		expect(() => findSystemDateNodeMatch(['SYSTÈME'])).toThrow(/exactly one system date/);
		expect(() => findSystemDateNodeMatch(['2026.07.30', '2026.07.31'])).toThrow(
			/exactly one system date/,
		);
	});
});
