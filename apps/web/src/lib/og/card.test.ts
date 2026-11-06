import { describe, expect, it } from 'vitest';
import { ogFontFiles } from '@yesid/seo-kit/og/files';
import { OG_CTA_TONES, buildOgCardSvg, type OgCard } from './card';
import { createOgCardRenderer } from './render';
import { Resvg } from '@resvg/resvg-js';

const ORANGE = '#E07800';
const renderer = createOgCardRenderer(ogFontFiles);
const card = (overrides: Partial<OgCard> = {}): OgCard => ({
	eyebrow: 'BLOG',
	title: 'Thinking in matrices',
	cta: 'Read the article',
	ctaTone: 'action',
	...overrides,
});
const pixels = (svg: string) =>
	new Resvg(svg, {
		font: { fontFiles: [...ogFontFiles], loadSystemFonts: false, defaultFontFamily: 'Inter' },
	}).render();
const rgbAt = (image: ReturnType<typeof pixels>, x: number, y: number) => {
	const offset = (Math.round(y) * image.width + Math.round(x)) * 4;
	return `#${[...image.pixels.subarray(offset, offset + 3)]
		.map((v) => v.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase()}`;
};

describe('share card', () => {
	it.each([
		['no closing mark', 'Thinking in matrices'],
		['its own period', 'Thinking in matrices.'],
	])('draws one orange dot beside a title with %s', (_label, title) => {
		const svg = renderer.svg(card({ title }));
		const dots = [
			...svg.matchAll(
				/<circle data-title-dot="1" cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="([^"]+)"/g,
			),
		];
		expect(dots).toHaveLength(1);
		expect(dots[0]![3]).toBe(ORANGE);
		expect(svg).not.toContain('matrices.<');
		const image = pixels(svg);
		expect(rgbAt(image, Number(dots[0]![1]), Number(dots[0]![2]))).toBe(ORANGE);
	});

	it('turns a closing question mark orange instead of adding a dot', () => {
		const svg = renderer.svg(card({ title: 'Does your website need instant publishing?' }));
		expect(svg).not.toContain('data-title-dot');
		expect(svg).toContain(`<tspan fill="${ORANGE}">?</tspan>`);
		const image = pixels(svg);
		const rgba = image.pixels;
		let orangePixels = 0;
		for (let y = 120; y < 448; y++)
			for (let x = 80; x < 1120; x++) {
				const offset = (y * image.width + x) * 4;
				if (rgba[offset] === 224 && rgba[offset + 1] === 120 && rgba[offset + 2] === 0)
					orangePixels++;
			}
		expect(orangePixels).toBeGreaterThan(100);
	});

	it('shows the call to action on the tone that matches where it leads', () => {
		const action = renderer.svg(card({ ctaTone: 'action' }));
		const conversion = renderer.svg(card({ cta: 'Book a call', ctaTone: 'conversion' }));
		expect(action).toContain('Read the article');
		expect(action).toContain(`data-cta="1" fill="${OG_CTA_TONES.action}"`);
		expect(conversion).toContain('Book a call');
		expect(conversion).toContain(`data-cta="1" fill="${OG_CTA_TONES.conversion}"`);
	});

	it('escapes copy that would break the SVG', () => {
		const svg = renderer.svg(card({ title: 'R&D <now>', subtitle: 'A & B' }));
		expect(svg).toContain('R&amp;D &lt;now&gt;');
		expect(svg).toContain('A &amp; B');
	});

	it('keeps a dot-only title visible and drops characters XML cannot carry', () => {
		const onlyMark = renderer.svg(card({ title: '...' }));
		expect(onlyMark).toContain('>...<');
		expect(() =>
			pixels(renderer.svg(card({ title: 'Bad \u0001 title', subtitle: 'Also \u0008 bad' }))),
		).not.toThrow();
	});

	it('honours a manual line break in code-owned titles', () => {
		const svg = renderer.svg(card({ title: 'Websites &\nOnline Stores' }));
		expect(svg).toContain('>Websites &amp;<');
		expect(svg).toContain('>Online Stores<');
	});

	it.each([
		['the longest real title', 'What can move forward before the product catalogue is final?'],
		['a long French title', 'Accéléré par l’IA, piloté par l’humain : mon vrai flux de travail'],
		['an absurdly long title', 'word '.repeat(60).trim()],
		['a very long unbroken word', 'Internationalization-and-localization-considerations'],
		['an unbroken word too long for any size', 'x'.repeat(200)],
	])('keeps %s inside the margins and the size budget', (_label, title) => {
		const svg = renderer.svg(
			card({
				title,
				subtitle:
					'Live bus positions and reliability history for Montréal and Ottawa, measured every single day.',
			}),
		);
		const image = pixels(svg);
		expect([image.width, image.height]).toEqual([1200, 630]);
		// Everything but the faint grid stays dark in the side margins.
		for (let y = 0; y < 630; y += 3) {
			for (const x of [40, 60, 79, 1121, 1140, 1160]) {
				const [r, g, b] = rgbAt(image, x, y)
					.slice(1)
					.match(/../g)!
					.map((hex) => parseInt(hex, 16));
				expect(Math.max(r!, g!, b!), `pixel ${x},${y}`).toBeLessThan(60);
			}
		}
		expect(image.asPng().byteLength).toBeLessThan(150_000);
	});

	it('keeps titles beside art clear of the art column', () => {
		const title = 'Sites web et\nboutiques en ligne';
		const measure = (text: string) => text.length * 0.6;
		const narrow = buildOgCardSvg(
			card({ title, art: { svg: '<g data-art/>', contentWidth: 620 } }),
			measure,
		);
		const wide = buildOgCardSvg(card({ title }), measure);
		const size = (svg: string) => Number(/font-weight="900" font-size="(\d+)"/.exec(svg)![1]);
		expect(narrow).toContain('<g data-art/>');
		expect(size(narrow)).toBeLessThan(size(wide));
	});
});
