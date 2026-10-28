import tokens from '@yesid/tokens/tokens.json';
import { renderSatoriPng, type SvgRasterizer } from './satori.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const dark = tokens.color.dark;

/** Cards always sit on the dark board. */
export const OG_PALETTE = {
	background: dark.background.$value,
	foreground: dark.foreground.$value,
	muted: dark['muted-foreground'].$value,
	accent: dark.primary.$value,
	accentText: dark['accent-text'].$value,
} as const;

export interface OgFont {
	name: 'Inter' | 'JetBrains Mono';
	data: ArrayBuffer;
	weight: 500 | 900;
	style: 'normal';
}

export interface OgCardInput {
	/** Mono overline, set in capitals. */
	eyebrow: string;
	/** The product name; the card adds the accent dot. */
	wordmark: string;
	title: string;
	/** Bottom left, usually the host. */
	handle: string;
	/** Bottom right, usually the city. */
	location: string;
}

function el(type: string, style: Record<string, unknown>, children?: unknown) {
	return { type, props: { style, children } };
}

const mono = {
	fontFamily: 'JetBrains Mono',
	fontSize: '18px',
	fontWeight: 500,
	letterSpacing: '0.12em',
	textTransform: 'uppercase',
};

function ogCard({ eyebrow, wordmark, title, handle, location }: OgCardInput) {
	return el(
		'div',
		{
			width: `${OG_WIDTH}px`,
			height: `${OG_HEIGHT}px`,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: '80px',
			backgroundColor: OG_PALETTE.background,
			color: OG_PALETTE.foreground,
			fontFamily: 'Inter',
		},
		[
			el('div', { ...mono, color: OG_PALETTE.accent }, eyebrow),
			el('div', { display: 'flex', flexDirection: 'column', gap: '24px' }, [
				el(
					'div',
					{
						display: 'flex',
						alignItems: 'baseline',
						fontWeight: 900,
						fontSize: '180px',
						letterSpacing: '-0.04em',
						lineHeight: 1,
					},
					[el('span', {}, wordmark), el('span', { color: OG_PALETTE.accent }, '.')],
				),
				el(
					'div',
					{
						fontWeight: 500,
						fontSize: '48px',
						letterSpacing: '-0.01em',
						lineHeight: 1.15,
						maxWidth: '1040px',
						color: OG_PALETTE.muted,
					},
					title,
				),
			]),
			el(
				'div',
				{
					...mono,
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'flex-end',
					color: OG_PALETTE.muted,
				},
				[
					el('div', { display: 'flex', flexDirection: 'column', gap: '16px' }, [
						el('div', { width: '120px', height: '3px', backgroundColor: OG_PALETTE.accent }, ''),
						el('span', {}, handle),
					]),
					el('span', {}, location),
				],
			),
		],
	);
}

/** Renders the yesid share card; the consumer rasterizes Satori's SVG (resvg, for example). */
export function renderOgPng<Bytes extends Uint8Array = Uint8Array>(
	card: OgCardInput,
	fonts: readonly OgFont[],
	rasterize: SvgRasterizer<Bytes>,
): Promise<Bytes> {
	return renderSatoriPng(ogCard(card), { width: OG_WIDTH, height: OG_HEIGHT, fonts: [...fonts] }, rasterize);
}
