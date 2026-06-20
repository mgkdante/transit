// build-icons — standalone app-icon generator (beauty-pass PR3).
//
// Renders the brand mark — the orange circle on the dark #141414 ground — to an
// OPAQUE 180×180 PNG at `static/apple-touch-icon-180.png`, referenced from
// app.html's `<link rel="apple-touch-icon">`. iOS requires a raster icon (it
// will not use the favicon.svg) and masks corners itself, so the artwork is a
// FULL-BLEED square (no rounded corners, no alpha) — exactly the brand ground
// color edge-to-edge with the brand orange disc centered on it.
//
// Run:  `bun scripts/build-icons.ts`           (regenerate the PNG)
//       `bun scripts/build-icons.ts --check`   (CI: fail if regenerating would change it)
//
// Pipeline: a hand-written SVG string → @resvg/resvg-js (raster) → sharp
// (.flatten → opaque 3-channel RGB PNG, no alpha). resvg always emits RGBA, so
// the sharp flatten is what makes the icon TRULY opaque (Apple renders alpha
// icons on black, so any stray transparency would show as black artifacts). No
// Satori/fonts — the mark is pure vector shapes. Mirrors build-og.ts conventions
// (same resvg dep, same --check drift gate). Colors mirror static/favicon.svg and
// the dark theme in src/lib/styles/tokens.css (brand graphic, not a UI data mark).

import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // web/scripts
const webRoot = resolve(here, '..'); // web/
const OUT_DIR = resolve(webRoot, 'static');

const SIZE = 180; // Apple touch icon recommended baseline (180×180 @3x iPhone).

// ── Brand palette (mirrors static/favicon.svg + tokens.css dark theme) ───────
const GROUND = '#141414'; // --background (dark) — opaque ground, full bleed.
const DISC = '#E07800'; // --primary (brand orange) — the mark.

// The favicon.svg uses a r=6 disc on a 32-box (radius ≈ 0.1875 of the box). Keep
// that proportion so the touch icon reads as the same mark at a larger size.
const DISC_RATIO = 6 / 32;

function buildSvg(): string {
	const center = SIZE / 2;
	const radius = SIZE * DISC_RATIO;
	// No rounded corners: iOS applies its own corner mask. Opaque ground rect so
	// the PNG has zero transparency (Apple renders alpha icons on black).
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
		background: GROUND, // opaque raster background before the flatten.
	});
	const rgba = Buffer.from(resvg.render().asPng());
	// Flatten to a TRUE opaque 3-channel RGB PNG (drop the alpha channel) so the
	// icon carries zero transparency — Apple renders alpha icons on black.
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
