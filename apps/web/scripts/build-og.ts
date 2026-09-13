// Generate static/og/{en,fr}.png with `bun run og:build`; verify with `bun run og:check`.

import { Resvg } from '@resvg/resvg-js';
import { renderSatoriPng } from '@yesid/seo-kit/satori';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOYMENT_IDENTITY } from '../src/lib/site/deployment';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
// Satori requires TTF, OTF, or WOFF; it cannot read @fontsource's WOFF2 files.
const FONT_DIR = resolve(here, 'og-fonts');
const OUT_DIR = resolve(webRoot, 'static/og');

const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors the dark theme in src/lib/styles/tokens.css.
const BG = '#141414'; // --background (dark)
const BORDER = '#3A3A3A'; // --border
const TEXT_PRIMARY = '#F5F5F0'; // --foreground
const TEXT_MUTED = '#949494'; // --muted-foreground
const ACCENT = '#E07800'; // --primary (brand orange; brand graphic, not a data mark)
const ACCENT_TEXT = '#FFB627'; // --accent-text

const WORDMARK = 'transit';
const SITE_HANDLE = 'transit.yesid.dev';
const FOOTER_LOCATION = 'Montréal · QC';

type Locale = 'en' | 'fr';

interface CardCopy {
	eyebrow: string;
	tagline: string;
	badgeLabel: string;
}

// Provider identity stays deployment-owned; bare Bun requires a relative import.
const PROVIDER = DEPLOYMENT_IDENTITY.providerShortName.toUpperCase();

const COPY: Record<Locale, CardCopy> = {
	en: {
		eyebrow: `${PROVIDER} · NETWORK ANALYTICS`,
		tagline: 'Transit reports, from live observations to daily reliability.',
		badgeLabel: 'PUBLIC REPORTS',
	},
	fr: {
		eyebrow: `${PROVIDER} · ANALYSE DU RÉSEAU`,
		tagline: 'Le réseau en chiffres, des observations aux bilans quotidiens.',
		badgeLabel: 'BILANS PUBLICS',
	},
};

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
				border: `1px solid ${BORDER}`,
			},
		},
		[
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
							// Static cards cannot report network health.
							el(
								'div',
								{
									style: {
										width: '18px',
										height: '18px',
										borderRadius: '9999px',
										backgroundColor: TEXT_MUTED,
									},
								},
								'',
							),
							el('span', {}, copy.badgeLabel),
						],
					),
				],
			),

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

async function renderPng(copy: CardCopy, fonts: OgFont[]): Promise<Buffer> {
	return Buffer.from(
		await renderSatoriPng(
			buildTree(copy),
			{
				width: WIDTH,
				height: HEIGHT,
				fonts: fonts.map((f) => ({
					name: f.name,
					data: f.data,
					weight: f.weight,
					style: f.style,
				})),
			},
			(svg) => new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng(),
		),
	);
}

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
		console.error('[build-og] OG cards are out of date. Run `bun scripts/build-og.ts`.');
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('[build-og] failed:', err);
	process.exit(1);
});
