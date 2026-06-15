import type { Token, TokenTree, YesidClampToken, DtcgPrimitive } from './types.ts';

export function isPrimitive(node: unknown): node is DtcgPrimitive {
	return (
		typeof node === 'object' &&
		node !== null &&
		'$type' in node &&
		(node as Record<string, unknown>)['$type'] !== 'yesid.clamp' &&
		'$value' in node
	);
}

export function isClampToken(node: unknown): node is YesidClampToken {
	return (
		typeof node === 'object' &&
		node !== null &&
		'$type' in node &&
		(node as YesidClampToken).$type === 'yesid.clamp'
	);
}

function isLeaf(node: unknown): node is Token {
	return isPrimitive(node) || isClampToken(node);
}

function validate(node: unknown, path: string): void {
	if (typeof node !== 'object' || node === null) {
		throw new Error(`tokens.json: expected object at ${path}, got ${typeof node}`);
	}
	if ('$type' in node || '$value' in node) {
		// Looks like a leaf — validate it.
		if (!('$type' in node)) throw new Error(`tokens.json: missing $type at ${path}`);
		if (!('$value' in node)) throw new Error(`tokens.json: missing $value at ${path}`);
		if (isClampToken(node)) {
			const v = node.$value;
			if (
				typeof v !== 'object' ||
				v === null ||
				!('min' in v) ||
				!('preferred' in v) ||
				!('max' in v)
			) {
				throw new Error(`tokens.json: yesid.clamp value missing min/preferred/max at ${path}`);
			}
		}
		return;
	}
	// Branch — recurse.
	for (const [k, v] of Object.entries(node)) {
		if (k.startsWith('$')) continue; // metadata: $schema, $description
		validate(v, path ? `${path}.${k}` : k);
	}
}

export function parseTokens(input: unknown): TokenTree {
	validate(input, '');
	return input as TokenTree;
}

export { isLeaf };
