/// <reference path="./inline-assets.d.ts" />
import interBlack from '../fonts/Inter-Black.ttf?inline';
import interMedium from '../fonts/Inter-Medium.ttf?inline';
import monoMedium from '../fonts/JetBrainsMono-Medium.ttf?inline';
import type { OgFont } from './og.js';

function bytes(dataUrl: string): ArrayBuffer {
	const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

/**
 * The card fonts, inlined by Vite so request-time rendering needs no file lookup: bundlers don't
 * copy binary assets next to server code.
 */
export const ogFonts: readonly OgFont[] = [
	{ name: 'Inter', data: bytes(interMedium), weight: 500, style: 'normal' },
	{ name: 'Inter', data: bytes(interBlack), weight: 900, style: 'normal' },
	{ name: 'JetBrains Mono', data: bytes(monoMedium), weight: 500, style: 'normal' },
];
