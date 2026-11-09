// favicon.svg, favicon.ico and the apple-touch icon, all from the package mark. iOS needs an opaque
// raster icon; icon services (and Plausible through them) read only the root favicon.ico.
import { Resvg } from '@resvg/resvg-js';
import { OG_PALETTE } from '@yesid/seo-kit/og';
import { brandMarkSvg, touchIconSvg } from '@yesid/seo-kit/icons';
import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC = resolve(dirname(fileURLToPath(import.meta.url)), '../static');
const SIZE = 180;

async function touchIcon(): Promise<Buffer> {
	const svg = touchIconSvg(OG_PALETTE.background, OG_PALETTE.accent, SIZE);
	const rgba = Buffer.from(
		new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng(),
	);
	return sharp(rgba)
		.flatten({ background: OG_PALETTE.background })
		.png({ compressionLevel: 9 })
		.toBuffer();
}

const ICO_SIZES = [16, 32, 48];

// An ICO of PNG images: a 6-byte header, one 16-byte entry per image, then the PNGs.
function favicon(): Buffer {
	const svg = brandMarkSvg(OG_PALETTE.accent);
	const pngs = ICO_SIZES.map((size) =>
		Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()),
	);
	const header = Buffer.alloc(6 + pngs.length * 16);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	let offset = header.length;
	pngs.forEach((png, i) => {
		const entry = 6 + i * 16;
		header.writeUInt8(ICO_SIZES[i]!, entry);
		header.writeUInt8(ICO_SIZES[i]!, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(png.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...pngs]);
}

const outputs: [string, Buffer][] = [
	['favicon.svg', Buffer.from(`${brandMarkSvg(OG_PALETTE.accent)}\n`)],
	['favicon.ico', favicon()],
	['apple-touch-icon-180.png', await touchIcon()],
];

const checkOnly = process.argv.includes('--check');
let drift = false;
for (const [name, bytes] of outputs) {
	const outPath = resolve(STATIC, name);
	if (!checkOnly) {
		writeFileSync(outPath, bytes);
		console.log(`[build-icons] wrote ${outPath} (${bytes.length} bytes)`);
	} else if (!existsSync(outPath) || !readFileSync(outPath).equals(bytes)) {
		drift = true;
		console.error(
			`[build-icons] DRIFT: ${outPath} is missing or stale. Run \`bun scripts/build-icons.ts\`.`,
		);
	}
}

if (drift) process.exit(1);
