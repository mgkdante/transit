// app.html's `<link rel="apple-touch-icon">`. iOS requires a raster icon (it
// Pipeline: a hand-written SVG string → @resvg/resvg-js (raster) → sharp

import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const OUT_DIR = resolve(webRoot, 'static');

const SIZE = 180;

const GROUND = '#141414';
const DISC = '#E07800';

const DISC_RATIO = 6 / 32;

function buildSvg(): string {
	const center = SIZE / 2;
	const radius = SIZE * DISC_RATIO;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
		`<rect width="${SIZE}" height="${SIZE}" fill="${GROUND}" />`,
		`<circle cx="${center}" cy="${center}" r="${radius}" fill="${DISC}" />`,
		`</svg>`,
	].join('');
}

async function renderPng(): Promise<Buffer> {
	const resvg = new Resvg(buildSvg(), {
		fitTo: { mode: 'width', value: SIZE },
		background: GROUND,
	});
	const rgba = Buffer.from(resvg.render().asPng());
	return sharp(rgba).flatten({ background: GROUND }).png({ compressionLevel: 9 }).toBuffer();
}

async function main(): Promise<void> {
	const checkOnly = process.argv.includes('--check');
	mkdirSync(OUT_DIR, { recursive: true });

	const png = await renderPng();
	const outPath = resolve(OUT_DIR, 'apple-touch-icon-180.png');

	if (checkOnly) {
		const current = existsSync(outPath) ? readFileSync(outPath) : null;
		if (!current || !current.equals(png)) {
			console.error(`[build-icons] DRIFT: ${outPath} is missing or stale.`);
			console.error('[build-icons] Icon is out of date. Run `bun scripts/build-icons.ts`.');
			process.exit(1);
		}
		console.log(`[build-icons] ok: ${outPath}`);
		return;
	}

	writeFileSync(outPath, png);
	console.log(`[build-icons] wrote ${outPath} (${png.length} bytes)`);
}

main().catch((err) => {
	console.error('[build-icons] failed:', err);
	process.exit(1);
});
