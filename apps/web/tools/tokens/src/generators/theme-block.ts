import type { TokenTree } from '../types.ts';
import { serializeCss } from '../serialize.ts';
import { isLeaf } from '../parse.ts';

const START = '/* ===== TOKENS:START ===== */';
const END = '/* ===== TOKENS:END ===== */';

const HEADER = `${START}
/* GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT */
/* Hand-edits to this region will be overwritten on the next build. */
/* Run \`bun run tokens:build\` to regenerate. */`;

const FOOTER = END;

/**
 * Tailwind v4 @theme namespace conventions:
 *   --color-*   → bg-* / text-* / border-* utilities
 *   --font-*    → font-* utilities
 *   --text-*    → text-{name} utilities (font-size)
 *   --radius-*  → rounded-* utilities
 *   --shadow-*  → shadow-* utilities
 *   --spacing-{name} → p-{name}, m-{name}, gap-{name}
 *   --width-{name}   → w-{name}, max-w-{name}
 *   --z-index-{name} → z-{name}
 */
function emitTokens(tree: TokenTree): string[] {
	const out: string[] = [];

	// Static brand fonts + type scale + radius + spacing aliases + container widths + shadows.
	if (tree.font) {
		for (const [k, v] of Object.entries(tree.font as TokenTree)) {
			if (isLeaf(v)) out.push(`  --font-${k}: ${serializeCss(v)};`);
		}
	}
	if (tree.text) {
		for (const [k, v] of Object.entries(tree.text as TokenTree)) {
			if (isLeaf(v)) out.push(`  --text-${k}: ${serializeCss(v)};`);
		}
	}
	if (tree.radius) {
		for (const [k, v] of Object.entries(tree.radius as TokenTree)) {
			if (isLeaf(v)) out.push(`  --radius-${k}: ${serializeCss(v)};`);
		}
	}
	if (tree.shadow) {
		for (const [k, v] of Object.entries(tree.shadow as TokenTree)) {
			if (isLeaf(v)) out.push(`  --shadow-${k}: var(--shadow-${k});`); // alias to tokens.css var
		}
	}
	if (tree.z) {
		for (const [k, v] of Object.entries(tree.z as TokenTree)) {
			if (isLeaf(v)) out.push(`  --z-index-${k}: var(--z-${k});`);
		}
	}
	if (tree.container) {
		for (const [k, v] of Object.entries(tree.container as TokenTree)) {
			if (isLeaf(v)) out.push(`  --width-${k}: var(--container-${k});`);
		}
	}
	if (tree.space) {
		for (const [k, v] of Object.entries(tree.space as TokenTree)) {
			if (isLeaf(v)) out.push(`  --spacing-${k}: var(--space-${k});`);
		}
	}

	return out;
}

export function generateThemeBlock(tree: TokenTree): string {
	const lines = emitTokens(tree);
	return `${HEADER}
@theme {
${lines.join('\n')}
}
${FOOTER}`;
}

export function replaceThemeRegion(fileContent: string, freshRegion: string): string {
	const startIdx = fileContent.indexOf(START);
	const endIdx = fileContent.indexOf(END);
	if (startIdx === -1 || endIdx === -1) {
		throw new Error(
			`replaceThemeRegion: sentinel markers not found. Add ${START} and ${END} to the file before regenerating.`,
		);
	}
	const before = fileContent.slice(0, startIdx);
	const after = fileContent.slice(endIdx + END.length);
	return `${before}${freshRegion}${after}`;
}
