import { Resvg } from '@resvg/resvg-js';
import { OG_WIDTH, renderOgPng } from '@yesid/seo-kit/og';
import { readOgFonts } from '@yesid/seo-kit/og/files';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOYMENT_IDENTITY } from '../src/lib/site/deployment';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../static/og');

// Provider identity stays deployment-owned; bare Bun requires a relative import.
const PROVIDER = DEPLOYMENT_IDENTITY.providerShortName.toUpperCase();

const COPY = {
	en: {
		eyebrow: `${PROVIDER} · Network analytics`,
		title: 'Transit reports, from live observations to daily reliability.',
	},
	fr: {
		eyebrow: `${PROVIDER} · Analyse du réseau`,
		title: 'Le réseau en chiffres, des observations aux bilans quotidiens.',
	},
} as const;

const fonts = readOgFonts();
const rasterize = (svg: string) =>
	new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();

const checkOnly = process.argv.includes('--check');
let drift = false;
mkdirSync(OUT_DIR, { recursive: true });

for (const [locale, copy] of Object.entries(COPY)) {
	const png = Buffer.from(
		await renderOgPng(
			{ ...copy, wordmark: 'transit', handle: 'transit.yesid.dev', location: 'Montréal · QC' },
			fonts,
			rasterize,
		),
	);
	const outPath = resolve(OUT_DIR, `${locale}.png`);
	if (!checkOnly) {
		writeFileSync(outPath, png);
		console.log(`[build-og] wrote ${outPath} (${png.length} bytes)`);
	} else if (!existsSync(outPath) || !readFileSync(outPath).equals(png)) {
		drift = true;
		console.error(
			`[build-og] DRIFT: ${outPath} is missing or stale. Run \`bun scripts/build-og.ts\`.`,
		);
	}
}

if (drift) process.exit(1);
