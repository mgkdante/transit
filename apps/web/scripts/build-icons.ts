// favicon.svg and the apple-touch icon, both from the package mark. iOS needs an opaque raster icon.
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

const outputs: [string, Buffer][] = [
	['favicon.svg', Buffer.from(`${brandMarkSvg(OG_PALETTE.accent)}\n`)],
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
