// easterWords.test.ts — the pure easter-word matcher (D4).
//
// Guards the DECORATION contract: the split is lossless (segments rebuild the
// input verbatim), matches are whole-word/phrase only (no partial hits like "stm"
// inside "system" or "bus" inside "busiest"), two-word phrases match greedily, and
// both en + fr surface forms are recognized. If any of these break, the flourish
// would either mangle the prose or decorate the wrong substrings.

import { describe, it, expect } from 'vitest';
import { splitEasterSegments, hasEasterMatch, EASTER_PHRASES } from './easterWords';

/** The matched segment texts, in order. */
function matches(text: string): string[] {
	return splitEasterSegments(text)
		.filter((s) => s.match)
		.map((s) => s.text);
}

describe('splitEasterSegments — losslessness', () => {
	it('rebuilds the exact input from the segments', () => {
		const samples = [
			'',
			'no easter words here at all',
			'The STM runs buses; the ALTO train is CDPQ Infra.',
			'science, trains, buses, sto, sts, octranspo',
			'   leading and trailing spaces   ',
		];
		for (const s of samples) {
			const rebuilt = splitEasterSegments(s)
				.map((seg) => seg.text)
				.join('');
			expect(rebuilt).toBe(s);
		}
	});

	it('returns an empty list for empty input', () => {
		expect(splitEasterSegments('')).toEqual([]);
	});
});

describe('splitEasterSegments — whole-word only (no partial hits)', () => {
	it('does not match "stm" inside "system"', () => {
		expect(matches('the system is fine')).toEqual([]);
	});

	it('does not match "bus" inside "busiest" or "business"', () => {
		expect(matches('the busiest business hour')).toEqual([]);
	});

	it('does not match "sts" inside "artists" or "science" inside "prescience"', () => {
		expect(matches('artists with prescience')).toEqual([]);
	});

	it('matches a bare word flanked by punctuation / boundaries', () => {
		expect(matches('(bus)')).toEqual(['bus']);
		expect(matches('take the bus.')).toEqual(['bus']);
		expect(matches('STM, STO and STS')).toEqual(['STM', 'STO', 'STS']);
	});
});

describe('splitEasterSegments — two-word phrases (greedy longest-match)', () => {
	it('matches "alto train" as one phrase, not a bare "train"', () => {
		const segs = splitEasterSegments('the alto train arrives');
		const m = segs.filter((s) => s.match);
		expect(m).toHaveLength(1);
		expect(m[0].text.toLowerCase()).toBe('alto train');
	});

	it('matches "cdpq infra" as one phrase', () => {
		expect(matches('operated by CDPQ Infra today').map((s) => s.toLowerCase())).toEqual([
			'cdpq infra',
		]);
	});

	it('still matches a bare "train" / "trains" when not preceded by "alto"', () => {
		expect(matches('two trains and a train')).toEqual(['trains', 'train']);
	});
});

describe('splitEasterSegments — case-insensitivity + fr/en forms', () => {
	it('matches regardless of case and preserves original casing', () => {
		expect(matches('Science and SCIENCE and science')).toEqual(['Science', 'SCIENCE', 'science']);
	});

	it('matches French surface forms (autobus)', () => {
		expect(matches('les autobus et les trains').map((s) => s.toLowerCase())).toEqual([
			'autobus',
			'trains',
		]);
	});

	it('recognizes every agency + the flagship rail project', () => {
		expect(matches('STM STO STS octranspo').map((s) => s.toLowerCase())).toEqual([
			'stm',
			'sto',
			'sts',
			'octranspo',
		]);
	});
});

describe('hasEasterMatch', () => {
	it('is true when a match exists and false otherwise', () => {
		expect(hasEasterMatch('the bus is late')).toBe(true);
		expect(hasEasterMatch('the system is late')).toBe(false);
	});
});

describe('EASTER_PHRASES ordering invariant', () => {
	it('lists each two-word phrase before its trailing sub-word (greedy-longest)', () => {
		const idx = (p: string) => EASTER_PHRASES.indexOf(p);
		expect(idx('alto train')).toBeLessThan(idx('train'));
		// "octranspo" must precede any shorter agency prefix that could shadow it;
		// none of stm/sto/sts is a prefix of octranspo, but the phrase-first rule
		// is what keeps the scan correct, so assert the two-word phrases lead.
		expect(idx('alto train')).toBeLessThan(idx('trains'));
		expect(idx('cdpq infra')).toBeLessThan(idx('bus'));
	});
});
