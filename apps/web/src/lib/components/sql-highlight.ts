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

const KEYWORDS = new Set<string>([
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
	'def',
	'return',
	'if',
	'none',
]);

interface Matcher {
	readonly type: CodeTokenType;
	readonly re: RegExp;
}

const MATCHERS: readonly Matcher[] = [
	{ type: 'comment', re: /(?:--|#)[^\n]*/y },
	{ type: 'comment', re: /\/\*[\s\S]*?\*\//y },
	{ type: 'string', re: /'(?:[^']|'')*'/y },
	{ type: 'string', re: /"(?:[^"]|"")*"/y },
	{ type: 'number', re: /\d+(?:\.\d+)?/y },
	{ type: 'plain', re: /\s+/y },
	{ type: 'plain', re: /[A-Za-z_:][A-Za-z0-9_]*/y },
	{ type: 'punctuation', re: /[(){}[\],.;:*/%+\-=<>!|&@]/y },
];

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

		if (!matched) {
			tokens.push({ type: 'plain', value: source[i] });
			i += 1;
		}
	}

	return mergeAdjacentPlain(tokens);
}

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
