import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OgFont } from './og.js';

const FONTS = [
	{ name: 'Inter', weight: 500, file: 'Inter-Medium.ttf' },
	{ name: 'Inter', weight: 900, file: 'Inter-Black.ttf' },
	{ name: 'JetBrains Mono', weight: 500, file: 'JetBrainsMono-Medium.ttf' },
] as const;

/** The card font files, for Bun build scripts that rasterize their own SVG. */
export const ogFontFiles: readonly string[] = FONTS.map(({ file }) =>
	fileURLToPath(new URL(`../fonts/${file}`, import.meta.url)),
);

/** The card fonts read from disk, for Bun build scripts. */
export function readOgFonts(): OgFont[] {
	return FONTS.map(({ name, weight }, index) => {
		const file = readFileSync(ogFontFiles[index]!);
		const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
		return { name, weight, style: 'normal', data };
	});
}
