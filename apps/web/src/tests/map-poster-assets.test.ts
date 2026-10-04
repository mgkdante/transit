import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import stm from '../../static/map/basemap-montreal-posters.json';
import oc from '../../static/map/basemap-ottawa-posters.json';

const MAP_DIR = resolve(process.cwd(), 'static/map');

describe('provider basemap posters', () => {
	it.each([
		[stm, 'stm', 'montreal', [-74.17628, 45.23742, -73.27628, 45.86764]],
		[oc, 'octranspo', 'ottawa', [-76.15, 45, -75.24, 45.65]],
	] as const)(
		'binds $1 images to their own archive and renderer',
		async (receipt, id, city, bounds) => {
			expect(receipt.provider_id).toBe(id);
			expect(receipt.source.pmtiles_url).toBe(`/data/v1/${id}/static/basemap/${city}.pmtiles`);
			expect(receipt.source.bounds).toEqual(bounds);
			expect(receipt.source.sha256).toMatch(/^[0-9a-f]{64}$/u);
			expect(receipt.render_inputs.map((input) => input.path)).toContain(
				`../db/config/providers/${id}.yaml`,
			);
			for (const poster of receipt.posters) {
				const bytes = await readFile(resolve(MAP_DIR, poster.filename));
				const metadata = await sharp(bytes).metadata();
				expect(poster.filename).toMatch(new RegExp(`^basemap-${city}-${poster.theme}-`));
				expect(metadata.format).toBe('heif');
				expect([metadata.width, metadata.height]).toEqual([poster.width, poster.height]);
				expect(bytes.byteLength).toBe(poster.bytes);
				expect(bytes.byteLength).toBeLessThanOrEqual(125 * 1024);
				expect(createHash('sha256').update(bytes).digest('hex')).toBe(poster.sha256);
			}
		},
	);

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
					env: process.env,
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
