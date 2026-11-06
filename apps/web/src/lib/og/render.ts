// Rasterizes share cards with resvg. resvg-js only loads fonts from file paths,
// so the build script passes the package font paths directly.

import { Resvg } from '@resvg/resvg-js';
import { buildOgCardSvg, escapeXml, OG_CARD_WIDTH, type MeasureText, type OgCard } from './card';

const MEASURE_SIZE = 100;

export interface OgCardRenderer {
	measure: MeasureText;
	svg(card: OgCard): string;
	png(card: OgCard): Uint8Array;
}

export function createOgCardRenderer(fontFiles: readonly string[]): OgCardRenderer {
	const font = { fontFiles: [...fontFiles], loadSystemFonts: false, defaultFontFamily: 'Inter' };
	const measured = new Map<string, number>();

	// Glyph widths scale linearly, so one reference size and a cache are enough.
	const measure: MeasureText = (text, { family, weight, tracking = 0 }) => {
		const key = `${family}|${weight}|${tracking}|${text}`;
		const known = measured.get(key);
		if (known !== undefined) return known;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="0" y="50" font-family="${family}" font-weight="${weight}" font-size="${MEASURE_SIZE}" letter-spacing="${tracking * MEASURE_SIZE}">${escapeXml(text)}</text></svg>`;
		const box = new Resvg(svg, { font }).getBBox();
		const width = box ? (box.x + box.width) / MEASURE_SIZE : 0;
		measured.set(key, width);
		return width;
	};

	const svg = (card: OgCard) => buildOgCardSvg(card, measure);
	return {
		measure,
		svg,
		png: (card) =>
			new Resvg(svg(card), { font, fitTo: { mode: 'width', value: OG_CARD_WIDTH } })
				.render()
				.asPng(),
	};
}
