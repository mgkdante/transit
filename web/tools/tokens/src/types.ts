// DTCG-aligned token types for @yesid/tokens.
// W3C draft: https://design-tokens.github.io/community-group/format/

/** A primitive DTCG token (color, dimension, fontFamily, etc.). */
export interface DtcgPrimitive {
	$type:
		| 'color'
		| 'dimension'
		| 'fontFamily'
		| 'fontWeight'
		| 'duration'
		| 'cubicBezier'
		| 'number'
		| 'string';
	$value: string | number;
	$description?: string;
}

/** yesid.dev extension for clamp() values. See research/clamp-spike.md. */
export interface YesidClampToken {
	$type: 'yesid.clamp';
	$value: {
		min: string;
		preferred: string;
		max: string;
	};
	$description?: string;
}

/** A token reference: "{path.to.token}" — resolved at build time. */
export type TokenReference = `{${string}}`;

/** Any leaf token. */
export type Token = DtcgPrimitive | YesidClampToken;

/** Recursive token tree. */
export interface TokenTree {
	[key: string]: Token | TokenTree;
}

/** Top-level shape of tokens.json. */
// Intersection rather than interface extension: optional string props would conflict
// with the index signature `[key: string]: Token | TokenTree` if typed as `string | undefined`.
export type TokensFile = TokenTree & {
	$schema?: string;
	$description?: string;
};
