// sql-highlight.test.ts — the dependency-free SQL tokenizer.
//
// The load-bearing invariant: highlighting is presentational, so concatenating
// every token's value must reproduce the input byte-for-byte. Plus a few
// classification spot-checks (keywords, strings, comments, numbers, functions).

import { describe, it, expect } from 'vitest';
import { tokenizeSql, type CodeTokenType } from './sql-highlight';

function typesOf(src: string, value: string): CodeTokenType[] {
	return tokenizeSql(src)
		.filter((t) => t.value === value)
		.map((t) => t.type);
}

describe('tokenizeSql — verbatim reproduction', () => {
	it('concatenating tokens reproduces the input exactly', () => {
		const samples = [
			'SELECT COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)\n  FROM gold.route_delay_hourly AS rd -- a comment\nWHERE rd.provider_id = :provider_id',
			"-- on-time band\ndate_trunc('week', x)::date\n/* block\n   comment */\nround(100.0 * a / b)",
			'def _otp_pct(on_time, known):\n    if on_time is None or not known: return None\n    return round(100.0 * float(on_time) / known_obs)',
			"WHERE name = 'O''Brien' AND tag = \"__unrouted__\"",
		];
		for (const s of samples) {
			const joined = tokenizeSql(s)
				.map((t) => t.value)
				.join('');
			expect(joined).toBe(s);
		}
	});

	it('produces no empty tokens', () => {
		for (const t of tokenizeSql("SELECT a FROM t WHERE b = 'x' -- c")) {
			expect(t.value.length).toBeGreaterThan(0);
		}
	});
});

describe('tokenizeSql — classification', () => {
	it('tags SQL keywords (case-insensitive)', () => {
		expect(typesOf('select 1', 'select')).toContain('keyword');
		expect(typesOf('SELECT 1', 'SELECT')).toContain('keyword');
		expect(typesOf('a FROM b', 'FROM')).toContain('keyword');
	});

	it('tags single-quoted strings (with doubled-quote escape)', () => {
		expect(typesOf("x = 'week'", "'week'")).toEqual(['string']);
		expect(typesOf("'O''Brien'", "'O''Brien'")).toEqual(['string']);
	});

	it('tags line and block comments', () => {
		expect(typesOf('-- hi', '-- hi')).toEqual(['comment']);
		expect(typesOf('a # py comment', '# py comment')).toEqual(['comment']);
		expect(typesOf('/* b */', '/* b */')).toEqual(['comment']);
	});

	it('tags numbers and function calls', () => {
		expect(typesOf('round(100.0)', '100.0')).toEqual(['number']);
		expect(typesOf('round(x)', 'round')).toEqual(['function']);
		// an identifier NOT followed by ( stays plain (use a comma so adjacent
		// plain/whitespace tokens don't merge into one span before filtering)
		expect(typesOf('a,bar,b', 'bar')).toEqual(['plain']);
	});
});
