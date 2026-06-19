// sql-highlight.ts — a tiny, dependency-free SQL tokenizer for CodeBlock.
//
// No syntax-highlighter dependency exists in the tree, and the prompt forbids
// adding a heavy one. This is a single-pass tokenizer: an ordered list of regex
// matchers run from the current offset; the first that matches at the offset
// wins and advances. Anything unmatched is emitted as a one-char "plain" token.
//
// It is SQL-aware (the Defining SQL blocks are the consumers), with a few Python
// keywords folded in because some blocks end with the publisher's reduction
// helper. Comments cover both `--` (SQL) and `#` (Python) line comments plus
// `/* ... */` block comments. Strings are single- or double-quoted with doubled-
// quote escapes. Identifiers immediately followed by `(` are tagged as functions.
//
// Highlighting is presentational only; the verbatim text is never altered (the
// concatenation of every token's `value` equals the input exactly).

export type CodeTokenType =
	| 'keyword'
	| 'string'
	| 'number'
	| 'function'
	| 'comment'
	| 'punctuation'
	| 'plain';

export interface CodeToken {
	readonly type: CodeTokenType;
	readonly value: string;
}

// SQL (+ a few Python) keywords. Matched case-insensitively against whole words.
const KEYWORDS = new Set<string>([
	// SQL DML / clauses
	'select',
	'from',
	'where',
	'group',
	'order',
	'by',
	'having',
	'limit',
	'offset',
	'insert',
	'into',
	'values',
	'update',
	'set',
	'delete',
	'with',
	'as',
	'on',
	'using',
	'join',
	'inner',
	'left',
	'right',
	'full',
	'outer',
	'cross',
	'union',
	'all',
	'distinct',
	'and',
	'or',
	'not',
	'in',
	'is',
	'null',
	'like',
	'ilike',
	'between',
	'exists',
	'case',
	'when',
	'then',
	'else',
	'end',
	'filter',
	'over',
	'partition',
	'asc',
	'desc',
	'create',
	'table',
	'view',
	'index',
	'conflict',
	'do',
	'nothing',
	'returning',
	'cast',
	'interval',
	'true',
	'false',
	'default',
	'primary',
	'key',
	'foreign',
	'references',
	'constraint',
	'unique',
	'check',
	'integer',
	'numeric',
	'text',
	'date',
	'timestamp',
	'boolean',
	'within',
	'array',
	// Python reduction-helper keywords (publisher snippets). `round`/`float` are
	// deliberately NOT here — they are function calls and get the function tag.
	'def',
	'return',
	'if',
	'none',
]);

// Ordered matchers. Order matters: comments and strings before identifiers and
// punctuation so `--`, `/* */`, and quotes are not split into punctuation.
interface Matcher {
	readonly type: CodeTokenType;
	readonly re: RegExp;
}

// NOTE: each regex uses the sticky `y` flag (anchors the match at `lastIndex`).
// Do NOT also add a `^` anchor — with `y`, `^` additionally demands start-of-
// input, so it would only ever match at offset 0.
const MATCHERS: readonly Matcher[] = [
	// Line comments: SQL `-- ...` and Python `# ...` to end of line.
	{ type: 'comment', re: /(?:--|#)[^\n]*/y },
	// Block comments: /* ... */ (non-greedy, multiline).
	{ type: 'comment', re: /\/\*[\s\S]*?\*\//y },
	// Single-quoted strings with doubled-quote escape.
	{ type: 'string', re: /'(?:[^']|'')*'/y },
	// Double-quoted identifiers/strings with doubled-quote escape.
	{ type: 'string', re: /"(?:[^"]|"")*"/y },
	// Numbers: integers, decimals, optional sign handled as punctuation/plain.
	{ type: 'number', re: /\d+(?:\.\d+)?/y },
	// Whitespace stays plain (keeps formatting verbatim).
	{ type: 'plain', re: /\s+/y },
	// Identifiers (word-ish, allows the project's :params and __sentinels__).
	{ type: 'plain', re: /[A-Za-z_:][A-Za-z0-9_]*/y },
	// Punctuation / operators (any run of symbol chars, one at a time is fine).
	{ type: 'punctuation', re: /[(){}[\],.;:*/%+\-=<>!|&@]/y },
];

/**
 * Tokenize a SQL (or SQL+Python) source string into highlightable spans.
 * Concatenating every returned `value` reproduces the input byte-for-byte.
 */
export function tokenizeSql(source: string): CodeToken[] {
	const tokens: CodeToken[] = [];
	let i = 0;
	const n = source.length;

	while (i < n) {
		let matched = false;

		for (const m of MATCHERS) {
			m.re.lastIndex = i;
			const hit = m.re.exec(source);
			if (hit && hit.index === i && hit[0].length > 0) {
				const value = hit[0];
				let type = m.type;

				// Promote a plain identifier to keyword (whole-word, case-insensitive)
				// or to function (when the very next non-space char is an opening paren).
				if (type === 'plain' && /^[A-Za-z_]/.test(value)) {
					if (KEYWORDS.has(value.toLowerCase())) {
						type = 'keyword';
					} else {
						let j = i + value.length;
						while (j < n && (source[j] === ' ' || source[j] === '\t')) j++;
						if (source[j] === '(') type = 'function';
					}
				}

				tokens.push({ type, value });
				i += value.length;
				matched = true;
				break;
			}
		}

		// Fallback: emit a single plain char so the scanner always advances.
		if (!matched) {
			tokens.push({ type: 'plain', value: source[i] });
			i += 1;
		}
	}

	return mergeAdjacentPlain(tokens);
}

// Collapse runs of same-typed plain/punctuation neighbors to keep the DOM lean
// (whitespace + adjacent plain identifiers do not need separate spans). Keyword,
// string, number, function, and comment tokens are always preserved as-is.
function mergeAdjacentPlain(tokens: CodeToken[]): CodeToken[] {
	const out: CodeToken[] = [];
	for (const t of tokens) {
		const last = out[out.length - 1];
		if (last && last.type === t.type && (t.type === 'plain' || t.type === 'punctuation')) {
			out[out.length - 1] = { type: t.type, value: last.value + t.value };
		} else {
			out.push(t);
		}
	}
	return out;
}
