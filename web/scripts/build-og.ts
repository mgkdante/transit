// build-og — standalone Open Graph card generator (slice-9.2 P5 deploy glue).
//
// Renders the two DEFAULT social cards (en + fr) at 1200×630 and writes them to
// `static/og/{lang}.png`, where SeoHead.svelte points `og:image` / `twitter:image`.
//
// Run:  `tsx scripts/build-og.ts`           (regenerate both cards)
//       `tsx scripts/build-og.ts --check`   (CI: fail if regenerating would change them)
//
// Pipeline: a plain-object element tree (Satori accepts the same shape
// React.createElement emits — no JSX runtime needed) → Satori (SVG) →
// @resvg/resvg-js (PNG). Fonts are vendored TTFs under scripts/og-fonts/
// (Satori cannot read the WOFF2 that @fontsource ships; TrueType/OTF/WOFF only).
//
// Standalone by design: zero `$lib` / `$app` imports so it runs under bare tsx
// without the SvelteKit module graph. Adapted from the yesid.dev OG renderer
// (apps/web/src/lib/og/{template,render,fonts}.ts), re-themed to transit tokens
// and collapsed into one file. Colors mirror the dark theme in
// src/lib/styles/tokens.css; this is a brand/marketing graphic, so brand orange
// (--primary) is used as the accent here — it is not a UI data mark.

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // web/scripts
const webRoot = resolve(here, '..'); // web/
const FONT_DIR = resolve(here, 'og-fonts');
const OUT_DIR = resolve(webRoot, 'static/og');

const WIDTH = 1200;
const HEIGHT = 630;

// ── Brand palette (mirrors src/lib/styles/tokens.css dark theme) ────────────
const BG = '#141414'; // --background (dark)
const BORDER = '#3A3A3A'; // --border
const TEXT_PRIMARY = '#F5F5F0'; // --foreground
const TEXT_MUTED = '#949494'; // --muted-foreground
const ACCENT = '#E07800'; // --primary (brand orange; brand graphic, not a data mark)
const ACCENT_TEXT = '#FFB627'; // --accent-text
const STATUS_ON_TIME = '#28c840'; // --dataviz-status-on-time (live-network dot)

const WORDMARK = 'transit';
const SITE_HANDLE = 'transit.yesid.dev';
const FOOTER_LOCATION = 'Montréal · QC';

// ── Per-locale copy for the two default cards ───────────────────────────────
type Locale = 'en' | 'fr';

interface CardCopy {
	eyebrow: string; // mono uppercase chip
	tagline: string; // muted subtitle under the wordmark
	statusLabel: string; // text beside the live dot
}

const COPY: Record<Locale, CardCopy> = {
	en: {
		eyebrow: 'STM · NETWORK ANALYTICS',
		tagline: 'On-time performance, crowding and disruptions — measured, never invented.',
		statusLabel: 'LIVE NETWORK',
	},
	fr: {
		eyebrow: 'STM · ANALYSE DU RÉSEAU',
		tagline: 'Ponctualité, achalandage et perturbations — mesurés, jamais inventés.',
		statusLabel: 'RÉSEAU EN DIRECT',
	},
};

// ── Satori element-tree helper (React.createElement-shaped POJOs) ───────────
type El = { type: string; props: Record<string, unknown> };

function el(type: string, props: Record<string, unknown>, children?: unknown): El {
	return { type, props: { ...props, children } };
}

function buildTree(copy: CardCopy): El {
	return el(
		'div',
		{
			style: {
				width: `${WIDTH}px`,
				height: `${HEIGHT}px`,
				backgroundColor: BG,
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				padding: '80px',
				fontFamily: 'Inter',
				color: TEXT_PRIMARY,
				// Hairline inner frame (signage feel) — solid surface, no alpha.
				border: `1px solid ${BORDER}`,
			},
		},
		[
			// Top rail: eyebrow chip (left) + live-network status dot (right).
			el(
				'div',
				{
					style: {
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
					},
				},
				[
					el(
						'div',
						{
							style: {
								fontFamily: 'JetBrains Mono',
								fontSize: '20px',
								fontWeight: 500,
								letterSpacing: '0.14em',
								textTransform: 'uppercase',
								color: ACCENT,
							},
						},
						copy.eyebrow,
					),
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'center',
								gap: '14px',
								fontFamily: 'JetBrains Mono',
								fontSize: '18px',
								fontWeight: 500,
								letterSpacing: '0.14em',
								textTransform: 'uppercase',
								color: TEXT_MUTED,
							},
						},
						[
							// On-time green dot = the network-healthy data hue (not orange).
							el(
								'div',
								{
									style: {
										width: '18px',
										height: '18px',
										borderRadius: '9999px',
										backgroundColor: STATUS_ON_TIME,
									},
								},
								'',
							),
							el('span', {}, copy.statusLabel),
						],
					),
				],
			),

			// Middle: wordmark + accent dot, then the muted tagline.
			el(
				'div',
				{
					style: {
						display: 'flex',
						flexDirection: 'column',
						gap: '28px',
					},
				},
				[
					el(
						'div',
						{
							style: {
								display: 'flex',
								alignItems: 'baseline',
								fontFamily: 'Inter',
								fontWeight: 900,
								fontSize: '168px',
								letterSpacing: '-0.04em',
								lineHeight: 1,
							},
						},
						[
							el('span', { style: { color: TEXT_PRIMARY } }, WORDMARK),
							el('span', { style: { color: ACCENT } }, '.'),
						],
					),
					el(
						'div',
						{
							style: {
								fontFamily: 'Inter',
								fontWeight: 500,
								fontSize: '40px',
								letterSpacing: '-0.01em',
								color: TEXT_MUTED,
								maxWidth: '960px',
								lineHeight: 1.2,
							},
						},
						copy.tagline,
					),
				],
			),

			// Bottom rail: accent bar + handle (left) / location (right).
			el(
				'div',
				{
					style: {
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'flex-end',
						fontFamily: 'JetBrains Mono',
						fontSize: '20px',
						fontWeight: 500,
						letterSpacing: '0.12em',
						textTransform: 'uppercase',
						color: TEXT_MUTED,
					},
				},
				[
					el(
						'div',
						{
							style: { display: 'flex', flexDirection: 'column', gap: '18px' },
						},
						[
							el(
								'div',
								{
									style: {
										width: '140px',
										height: '4px',
										backgroundColor: ACCENT,
									},
								},
								'',
							),
							el('span', { style: { color: ACCENT_TEXT } }, SITE_HANDLE),
						],
					),
					el('span', {}, FOOTER_LOCATION),
				],
			),
		],
	);
}

// ── Fonts ───────────────────────────────────────────────────────────────────
interface OgFont {
	name: string;
	data: Buffer;
	weight: 400 | 500 | 900;
	style: 'normal';
}

function loadFonts(): OgFont[] {
	const read = (file: string): Buffer => {
		const p = resolve(FONT_DIR, file);
		if (!existsSync(p)) {
			throw new Error(
				`OG font missing: ${p}. Expected vendored TTFs in scripts/og-fonts/ ` +
					`(Inter-Medium.ttf, Inter-Black.ttf, JetBrainsMono-Medium.ttf).`,
			);
		}
		return readFileSync(p);
	};
	return [
		{ name: 'Inter', data: read('Inter-Medium.ttf'), weight: 500, style: 'normal' },
		{ name: 'Inter', data: read('Inter-Black.ttf'), weight: 900, style: 'normal' },
		{
			name: 'JetBrains Mono',
			data: read('JetBrainsMono-Medium.ttf'),
			weight: 500,
			style: 'normal',
		},
	];
}

// ── Render one card to PNG bytes ─────────────────────────────────────────────
async function renderPng(copy: CardCopy, fonts: OgFont[]): Promise<Buffer> {
	const svg = await satori(buildTree(copy) as Parameters<typeof satori>[0], {
		width: WIDTH,
		height: HEIGHT,
		fonts: fonts.map((f) => ({
			name: f.name,
			data: f.data,
			weight: f.weight,
			style: f.style,
		})),
	});
	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } });
	return Buffer.from(resvg.render().asPng());
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
	const checkOnly = process.argv.includes('--check');
	const fonts = loadFonts();
	mkdirSync(OUT_DIR, { recursive: true });

	const locales: Locale[] = ['en', 'fr'];
	let drift = false;

	for (const lang of locales) {
		const png = await renderPng(COPY[lang], fonts);
		const outPath = resolve(OUT_DIR, `${lang}.png`);

		if (checkOnly) {
			const current = existsSync(outPath) ? readFileSync(outPath) : null;
			if (!current || !current.equals(png)) {
				drift = true;
				console.error(`[build-og] DRIFT: ${outPath} is missing or stale.`);
			} else {
				console.log(`[build-og] ok: ${outPath}`);
			}
			continue;
		}

		writeFileSync(outPath, png);
		console.log(`[build-og] wrote ${outPath} (${png.length} bytes)`);
	}

	if (checkOnly && drift) {
		console.error('[build-og] OG cards are out of date. Run `tsx scripts/build-og.ts`.');
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[build-og] failed:', err);
	process.exit(1);
});
