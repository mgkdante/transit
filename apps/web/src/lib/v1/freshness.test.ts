import { describe, expect, it } from 'vitest';
import { freshnessAgeSeconds, freshnessRelative } from './freshness';
import type { TimeLang } from '$lib/utils/time';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _FreshnessAgeSignature = Expect<
	Equal<
		typeof freshnessAgeSeconds,
		(generatedUtc: string | null | undefined, nowMs: number) => number | null
	>
>;
type _FreshnessRelativeSignature = Expect<
	Equal<
		typeof freshnessRelative,
		(generatedUtc: string | null | undefined, lang: TimeLang, nowMs: number) => string | null
	>
>;

const NOW = new Date('2026-06-15T12:00:00Z');

describe('shared freshness derivation', () => {
	it('uses the caller-supplied server clock for age and relative text', () => {
		const generatedUtc = '2026-06-15T11:59:50Z';

		expect(freshnessAgeSeconds(generatedUtc, NOW.getTime())).toBe(10);
		expect(freshnessRelative(generatedUtc, 'en', NOW.getTime())).toBe('10 seconds ago');
	});
});
