import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const MAP_DIR = resolve(process.cwd(), 'static/map');

interface PosterReceipt {
	schema_version: number;
	source: {
		descriptor_url: string;
		descriptor_etag: string;
		publish_generation_id: string;
		generated_utc: string;
		pmtiles_url: string;
		pmtiles_etag: string;
		pmtiles_size_bytes: number;
		attribution: string;
		min_zoom: number;
		max_zoom: number;
	};
	reproduced_with: {
		playwright_core_version: string;
		chromium_version: string;
	};
	render_inputs: Array<{ path: string; sha256: string }>;
	posters: Array<{
		filename: string;
		theme: 'dark' | 'light';
		width: number;
		height: number;
		format: 'avif';
		bytes: number;
		sha256: string;
	}>;
}

async function readReceipt(): Promise<PosterReceipt> {
	return JSON.parse(
		await readFile(resolve(MAP_DIR, 'basemap-montreal-posters.json'), 'utf8'),
	) as PosterReceipt;
}

describe('static Montréal basemap posters', () => {
	it('binds the dated assets to one source identity and renderer receipt', async () => {
		const receipt = await readReceipt();

		expect(receipt).toEqual({
			schema_version: 1,
			source: {
				descriptor_url: 'https://data.yesid.dev/v1/stm/static/basemap.json',
				descriptor_etag: '"45960886b853dd90f0bd275a633855aa"',
				publish_generation_id: 'stm@2026-08-12T07:42:41Z',
				generated_utc: '2026-08-12T07:42:41Z',
				pmtiles_url: 'https://transit.yesid.dev/data/v1/stm/static/basemap/montreal.pmtiles',
				pmtiles_etag: '"6403e3c2777cc710276331111b570633"',
				pmtiles_size_bytes: 86_282_797,
				attribution: '© OpenStreetMap contributors, © Protomaps',
				min_zoom: 0,
				max_zoom: 15,
			},
			reproduced_with: {
				playwright_core_version: '1.62.0',
				chromium_version: '151.0.7922.34',
			},
			render_inputs: [
				{
					path: 'src/lib/components/map/basemap.ts',
					sha256: '3d0f658aaabc0eed0787bbd367949f9bd2b8b3fa32a4b24e29ad30ccbffff7b1',
				},
				{
					path: 'src/lib/components/map/viewport.ts',
					sha256: '0d752d353888887752fce1e0e8f09599b2db3562078608c7c7da489cbe4e8094',
				},
				{
					path: 'src/lib/features/map/mapCameraFraming.ts',
					sha256: 'c2af44c95b30c679210cda9b45e3d89513c937d8bf965c6d9d4c85790419d5e1',
				},
			],
			posters: [
				{
					filename: 'basemap-montreal-dark-mobile-20260812.avif',
					theme: 'dark',
					width: 390,
					height: 844,
					format: 'avif',
					bytes: 39_346,
					sha256: '69a4e7f5218a1a9b624af7d986539b806f60379b4b7bc65dc18ad7c7d7fd8037',
				},
				{
					filename: 'basemap-montreal-light-mobile-20260812.avif',
					theme: 'light',
					width: 390,
					height: 844,
					format: 'avif',
					bytes: 48_756,
					sha256: '98e45dd0d14feb30ba433a00f83acb65f1e842463aed05448f8f09a3d43e6254',
				},
				{
					filename: 'basemap-montreal-dark-desktop-20260812.avif',
					theme: 'dark',
					width: 1280,
					height: 720,
					format: 'avif',
					bytes: 94_947,
					sha256: 'acd80dfa5d45639009a3f76a1da5ecd11cc3d81b40a6c876154a5f6f6dfa537a',
				},
				{
					filename: 'basemap-montreal-light-desktop-20260812.avif',
					theme: 'light',
					width: 1280,
					height: 720,
					format: 'avif',
					bytes: 113_527,
					sha256: 'abae403dcb93a1e968ab9e6eb450a74591659e7d0233849a94722446c4b84b7f',
				},
			],
		});
	});

	it('matches every receipt digest, byte count, viewport, and AVIF limit', async () => {
		const receipt = await readReceipt();

		for (const poster of receipt.posters) {
			const bytes = await readFile(resolve(MAP_DIR, poster.filename));
			const metadata = await sharp(bytes).metadata();

			expect(metadata.format, poster.filename).toBe('heif');
			expect(metadata.width, poster.filename).toBe(poster.width);
			expect(metadata.height, poster.filename).toBe(poster.height);
			expect(bytes.byteLength, poster.filename).toBe(poster.bytes);
			expect(bytes.byteLength, poster.filename).toBeLessThanOrEqual(125 * 1024);
			expect(createHash('sha256').update(bytes).digest('hex'), poster.filename).toBe(poster.sha256);
		}
	});

	it('checks the receipt without network or a browser executable', async () => {
		const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'transit-poster-offline-'));
		try {
			const preload = resolve(temporaryDirectory, 'forbid-network.mjs');
			await writeFile(
				preload,
				"globalThis.fetch = () => { throw new Error('network access forbidden in poster check'); };\n",
			);
			const child = spawn(
				'bun',
				['--preload', preload, 'scripts/build-map-posters.ts', '--check'],
				{
					cwd: process.cwd(),
					env: { ...process.env, CHROME_PATH: '/definitely/no/chromium' },
					stdio: ['ignore', 'pipe', 'pipe'],
				},
			);
			let stderr = '';
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk: string) => (stderr += chunk));
			const code = await new Promise<number | null>((resolveExit) =>
				child.once('close', resolveExit),
			);

			expect(code, stderr).toBe(0);
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}
	});
});
