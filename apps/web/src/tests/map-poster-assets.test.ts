import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const POSTERS = [
	['basemap-montreal-dark-mobile-20260812.avif', 390, 844],
	['basemap-montreal-light-mobile-20260812.avif', 390, 844],
	['basemap-montreal-dark-desktop-20260812.avif', 1280, 720],
	['basemap-montreal-light-desktop-20260812.avif', 1280, 720],
] as const;

describe('static Montréal basemap posters', () => {
	it.each(POSTERS)(
		'%s is the checked-in AVIF at its exact viewport under 125 KB',
		async (filename, width, height) => {
			const bytes = await readFile(resolve(process.cwd(), 'static/map', filename));
			const metadata = await sharp(bytes).metadata();

			expect(metadata.format).toBe('heif');
			expect(metadata.width).toBe(width);
			expect(metadata.height).toBe(height);
			expect(bytes.byteLength).toBeLessThanOrEqual(125 * 1024);
		},
	);
});
