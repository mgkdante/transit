export const EASTER_PHRASES: readonly string[] = [
	'alto train',
	'cdpq infra',
	'octranspo',
	'stm',
	'sto',
	'sts',
	'science',
	'trains',
	'train',
	'buses',
	'autobus',
	'bus',
];

export interface EasterSegment {
	readonly text: string;
	readonly match: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
	return ch != null && WORD_CHAR.test(ch);
}

export function splitEasterSegments(
	text: string,
	phrases: readonly string[] = EASTER_PHRASES,
): EasterSegment[] {
	if (!text) return [];
	const lower = text.toLowerCase();
	const segments: EasterSegment[] = [];
	let runStart = 0;
	let i = 0;

	const flushRun = (end: number): void => {
		if (end > runStart) segments.push({ text: text.slice(runStart, end), match: false });
	};

	while (i < lower.length) {
		let matched = false;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (!lower.startsWith(phrase, i)) continue;
			const before = i > 0 ? lower[i - 1] : undefined;
			const after = i + phrase.length < lower.length ? lower[i + phrase.length] : undefined;
			if (isWordChar(before) || isWordChar(after)) continue;
			flushRun(i);
			segments.push({ text: text.slice(i, i + phrase.length), match: true });
			i += phrase.length;
			runStart = i;
			matched = true;
			break;
		}
		if (!matched) i += 1;
	}
	flushRun(lower.length);
	return segments;
}

export function hasEasterMatch(text: string, phrases: readonly string[] = EASTER_PHRASES): boolean {
	return splitEasterSegments(text, phrases).some((s) => s.match);
}
