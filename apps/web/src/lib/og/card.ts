// The one share-card layout: eyebrow, title with its orange closing mark, short
// support line, wordmark and call to action. Used by the static card generator
// for Transit. Pure: text measurement is injected.

import { OG_PALETTE } from '@yesid/seo-kit/og';
import tokens from '@yesid/tokens/tokens.json';

export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

const MARGIN = 80;
const {
	background: BG,
	foreground: TEXT,
	muted: MUTED,
	accent: ORANGE,
	accentText: YELLOW,
} = OG_PALETTE;
const INK = tokens.color.dark['accent-foreground'].$value;

/**
 * Follows the design tokens' colour doctrine: yellow is reserved for "talk to
 * Yesid" conversion actions, every other action stays orange.
 */
export const OG_CTA_TONES = { conversion: YELLOW, action: ORANGE } as const;
export type OgCtaTone = keyof typeof OG_CTA_TONES;

export interface OgCardArt {
	/** SVG fragment drawn behind the copy. */
	svg: string;
	/** Width the title and support line must stay within to clear the art. */
	contentWidth: number;
}

export interface OgCard {
	eyebrow: string;
	/** A closing period becomes the orange dot; one is added when the title has no closing mark. */
	title: string;
	subtitle?: string;
	cta: string;
	ctaTone: OgCtaTone;
	art?: OgCardArt;
}

export interface OgFontSpec {
	family: 'Inter' | 'JetBrains Mono';
	weight: 500 | 900;
	/** Tracking in em. */
	tracking?: number;
}

/** Ink width of one line, in em. */
export type MeasureText = (text: string, font: OgFontSpec) => number;
type MeasureLine = (line: string) => number;

const TITLE_FONT: OgFontSpec = { family: 'Inter', weight: 900, tracking: -0.015 };
const SUBTITLE_FONT: OgFontSpec = { family: 'Inter', weight: 500 };
const EYEBROW_FONT: OgFontSpec = { family: 'JetBrains Mono', weight: 500, tracking: 0.12 };
const CTA_FONT: OgFontSpec = { family: 'Inter', weight: 900 };

const TITLE_SIZE = { max: 112, min: 48 };
const TITLE_MAX_LINES = 3;
const TITLE_LEADING = 1.08;
const SUBTITLE_SIZE = { max: 38, oneLineMin: 32, min: 28 };
const SUBTITLE_MAX_LINES = 2;
const SUBTITLE_LEADING = 1.3;
const BLOCK_GAP = 26;
const COPY_TOP = 146;
const COPY_BOTTOM = 448;

const DOT_GAP_EM = 0.05;
const DOT_RADIUS_EM = 0.095;
const DOT_RESERVE_EM = DOT_GAP_EM + 2 * DOT_RADIUS_EM;

/** Escapes markup and drops the control characters XML cannot carry. */
export function escapeXml(text: string): string {
	return (
		text
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
	);
}

function fontAttrs({ family, weight, tracking = 0 }: OgFontSpec, size: number): string {
	const spacing = tracking ? ` letter-spacing="${(tracking * size).toFixed(2)}"` : '';
	return `font-family="${family}" font-weight="${weight}" font-size="${size}"${spacing}`;
}

interface TitleParts {
	body: string;
	/** Text mark kept and coloured, such as "?". A period is drawn as the dot instead. */
	mark: string;
}

function splitClosingMark(title: string): TitleParts {
	const trimmed = title.trim();
	const body = trimmed.replace(/[.!?…]+$/u, '').trimEnd();
	// A title of nothing but punctuation keeps it as the text.
	if (!body) return { body: trimmed, mark: '' };
	const mark = trimmed.slice(body.length).trim();
	return { body, mark: mark === '.' ? '' : mark };
}

/** Last resort for one word wider than the line: break it between characters. */
function breakLongWord(word: string, maxEm: number, measure: MeasureLine): string[] {
	if (measure(word) <= maxEm) return [word];
	const pieces: string[] = [];
	let piece = '';
	for (const character of word) {
		if (piece && measure(piece + character) > maxEm) {
			pieces.push(piece);
			piece = character;
		} else {
			piece += character;
		}
	}
	return [...pieces, piece];
}

function wrapGreedy(text: string, maxEm: number, measure: MeasureLine): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/u).flatMap((part) => breakLongWord(part, maxEm, measure))) {
		const candidate = line ? `${line} ${word}` : word;
		if (line && measure(candidate) > maxEm) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	return line ? [...lines, line] : lines;
}

/** Greedy wrap, then the narrowest width with the same line count so lines come out even. */
function wrapBalanced(text: string, maxEm: number, measure: MeasureLine): string[] {
	const lineCount = wrapGreedy(text, maxEm, measure).length;
	if (lineCount < 2) return wrapGreedy(text, maxEm, measure);
	let low = Math.min(maxEm, Math.max(...text.split(/\s+/u).map(measure)));
	let high = maxEm;
	for (let step = 0; step < 12; step += 1) {
		const middle = (low + high) / 2;
		if (wrapGreedy(text, middle, measure).length > lineCount) low = middle;
		else high = middle;
	}
	return wrapGreedy(text, high, measure);
}

function wrapParagraphs(text: string, maxEm: number, measure: MeasureLine): string[] {
	return text.split('\n').flatMap((part) => wrapBalanced(part, maxEm, measure));
}

/** Keeps the first lines and closes the last one with an ellipsis, trimming it until it fits. */
function clipLines(
	lines: readonly string[],
	maxLines: number,
	maxEm: number,
	measure: MeasureLine,
): string[] {
	if (lines.length <= maxLines) return [...lines];
	const closing = (text: string) => `${text.replace(/[\s,;:]+$/u, '')}…`;
	let last = lines[maxLines - 1] ?? '';
	while (last && measure(closing(last)) > maxEm) {
		last = last.includes(' ') ? last.slice(0, last.lastIndexOf(' ')) : last.slice(0, -1);
	}
	return [...lines.slice(0, maxLines - 1), closing(last)];
}

interface TextBlock {
	lines: string[];
	size: number;
	height: number;
}

function subtitleBlock(
	subtitle: string,
	width: number,
	size: number,
	measure: MeasureText,
): TextBlock {
	const lineEm: MeasureLine = (line) => measure(line, SUBTITLE_FONT);
	const lines = clipLines(
		wrapParagraphs(subtitle, width / size, lineEm),
		SUBTITLE_MAX_LINES,
		width / size,
		lineEm,
	);
	return { lines, size, height: lines.length * size * SUBTITLE_LEADING };
}

function fitSubtitle(
	subtitle: string | undefined,
	width: number,
	measure: MeasureText,
): TextBlock | undefined {
	if (!subtitle) return undefined;
	// One clean line beats two slightly bigger ones.
	for (let size = SUBTITLE_SIZE.max; size >= SUBTITLE_SIZE.oneLineMin; size -= 2) {
		const wrapped = wrapParagraphs(subtitle, width / size, (line) => measure(line, SUBTITLE_FONT));
		if (wrapped.length === 1) return subtitleBlock(subtitle, width, size, measure);
	}
	for (let size = SUBTITLE_SIZE.max; size > SUBTITLE_SIZE.min; size -= 2) {
		const wrapped = wrapParagraphs(subtitle, width / size, (line) => measure(line, SUBTITLE_FONT));
		if (wrapped.length <= SUBTITLE_MAX_LINES) return subtitleBlock(subtitle, width, size, measure);
	}
	return subtitleBlock(subtitle, width, SUBTITLE_SIZE.min, measure);
}

function layoutTitle(
	body: string,
	reserve: number,
	width: number,
	size: number,
	measure: MeasureText,
): string[] {
	const lineEm: MeasureLine = (line) => measure(line, TITLE_FONT);
	const available = width / size;
	const lines = wrapParagraphs(body, available, lineEm);
	// The closing mark sits on the last line, so it has to fit there too.
	const overflows = lineEm(lines[lines.length - 1] ?? '') + reserve > available;
	return overflows ? wrapParagraphs(body, available - reserve, lineEm) : lines;
}

function fitTitle(
	body: string,
	mark: string,
	width: number,
	budget: number,
	measure: MeasureText,
): TextBlock {
	const lineEm: MeasureLine = (line) => measure(line, TITLE_FONT);
	const reserve = mark ? measure(mark, TITLE_FONT) : DOT_RESERVE_EM;
	const longestWord = Math.max(...body.split(/\s+/u).map(lineEm));
	for (let size = TITLE_SIZE.max; size >= TITLE_SIZE.min; size -= 2) {
		// Shrink before ever breaking a word.
		if (longestWord + reserve > width / size) continue;
		const lines = layoutTitle(body, reserve, width, size, measure);
		const height = lines.length * size * TITLE_LEADING;
		if (lines.length <= TITLE_MAX_LINES && height <= budget) return { lines, size, height };
	}
	const size = TITLE_SIZE.min;
	const available = width / size - reserve;
	const lines = clipLines(
		layoutTitle(body, reserve, width, size, measure),
		TITLE_MAX_LINES,
		available,
		lineEm,
	);
	return { lines, size, height: lines.length * size * TITLE_LEADING };
}

function titleSvg(block: TextBlock, mark: string, top: number, measure: MeasureText): string {
	const { lines, size } = block;
	const leading = size * TITLE_LEADING;
	const baseline = (index: number) => top + size * 0.86 + index * leading;
	const lastIndex = lines.length - 1;
	const text = lines
		.map((line, index) => {
			const closing =
				index === lastIndex && mark ? `<tspan fill="${ORANGE}">${escapeXml(mark)}</tspan>` : '';
			return `<text x="${MARGIN}" y="${baseline(index).toFixed(1)}" ${fontAttrs(TITLE_FONT, size)} fill="${TEXT}">${escapeXml(line)}${closing}</text>`;
		})
		.join('');
	if (mark) return text;
	const radius = size * DOT_RADIUS_EM;
	const cx =
		MARGIN + measure(lines[lastIndex] ?? '', TITLE_FONT) * size + size * DOT_GAP_EM + radius;
	const cy = baseline(lastIndex) - radius;
	return `${text}<circle data-title-dot="1" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="${ORANGE}"/>`;
}

function subtitleSvg(block: TextBlock, top: number): string {
	const leading = block.size * SUBTITLE_LEADING;
	return block.lines
		.map(
			(line, index) =>
				`<text x="${MARGIN}" y="${(top + block.size * 0.98 + index * leading).toFixed(1)}" ${fontAttrs(SUBTITLE_FONT, block.size)} fill="${MUTED}">${escapeXml(line)}</text>`,
		)
		.join('');
}

function eyebrowSvg(text: string, width: number, measure: MeasureText): string {
	let size = 22;
	while (size > 15 && measure(text, EYEBROW_FONT) * size > width) size -= 1;
	return `<text x="${MARGIN}" y="104" ${fontAttrs(EYEBROW_FONT, size)} fill="${YELLOW}">${escapeXml(text)}</text>`;
}

function domainSvg(): string {
	return `<text x="${OG_CARD_WIDTH - MARGIN}" y="104" ${fontAttrs({ ...EYEBROW_FONT, tracking: 0.04 }, 22)} fill="${MUTED}" text-anchor="end">transit.yesid.dev</text>`;
}

function ctaSvg(label: string, tone: OgCtaTone, measure: MeasureText): string {
	const size = 30;
	const height = 72;
	const padding = 34;
	const arrow = 30;
	const gap = 16;
	const textWidth = measure(label, CTA_FONT) * size;
	const width = padding * 2 + textWidth + gap + arrow;
	const x = OG_CARD_WIDTH - MARGIN - width;
	const y = 478;
	const middle = y + height / 2;
	const arrowStart = x + padding + textWidth + gap;
	const arrowEnd = arrowStart + arrow;
	return `<rect data-cta="1" fill="${OG_CTA_TONES[tone]}" x="${x.toFixed(1)}" y="${y}" width="${width.toFixed(1)}" height="${height}" rx="10"/>
	<text x="${(x + padding).toFixed(1)}" y="${middle + size * 0.35}" ${fontAttrs(CTA_FONT, size)} fill="${INK}">${escapeXml(label)}</text>
	<path d="M${arrowStart.toFixed(1)} ${middle}H${arrowEnd.toFixed(1)}M${(arrowEnd - 11).toFixed(1)} ${middle - 11}L${arrowEnd.toFixed(1)} ${middle}L${(arrowEnd - 11).toFixed(1)} ${middle + 11}" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function wordmarkSvg(): string {
	return (
		'<text x="80" y="532" font-family="Inter" font-weight="900" font-size="48" fill="' +
		TEXT +
		'">transit<tspan fill="' +
		ORANGE +
		'">.</tspan></text>'
	);
}

function gridSvg(): string {
	const line = (x1: number, y1: number, x2: number, y2: number, major: boolean) =>
		`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ORANGE}" stroke-width="1" opacity="${major ? 0.07 : 0.04}"/>`;
	const lines: string[] = [];
	for (let x = 40; x < OG_CARD_WIDTH; x += 40)
		lines.push(line(x, 0, x, OG_CARD_HEIGHT, x % 200 === 0));
	for (let y = 40; y < OG_CARD_HEIGHT; y += 40)
		lines.push(line(0, y, OG_CARD_WIDTH, y, y % 200 === 0));
	return lines.join('');
}

export function buildOgCardSvg(card: OgCard, measure: MeasureText): string {
	const width = card.art?.contentWidth ?? OG_CARD_WIDTH - 2 * MARGIN;
	const { body, mark } = splitClosingMark(card.title.replaceAll("'", '’'));
	const subtitle = fitSubtitle(card.subtitle, width, measure);
	const subtitleSpace = subtitle ? subtitle.height + BLOCK_GAP : 0;
	const title = fitTitle(body, mark, width, COPY_BOTTOM - COPY_TOP - subtitleSpace, measure);
	const copyHeight = title.height + subtitleSpace;
	const top = COPY_TOP + (COPY_BOTTOM - COPY_TOP - copyHeight) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_CARD_WIDTH}" height="${OG_CARD_HEIGHT}" viewBox="0 0 ${OG_CARD_WIDTH} ${OG_CARD_HEIGHT}">
	<rect width="${OG_CARD_WIDTH}" height="${OG_CARD_HEIGHT}" fill="${BG}"/>
	${gridSvg()}
	${card.art?.svg ?? ''}
	${eyebrowSvg(card.eyebrow, width, measure)}
	${domainSvg()}
	${titleSvg(title, mark, top, measure)}
	${subtitle ? subtitleSvg(subtitle, top + title.height + BLOCK_GAP) : ''}
	${wordmarkSvg()}
	${ctaSvg(card.cta, card.ctaTone, measure)}
</svg>`;
}
