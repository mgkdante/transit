import type { Token, TokenTree } from '../types.ts';
import { serializeCss } from '../serialize.ts';
import { isLeaf } from '../parse.ts';

const HEADER = `/* GENERATED FROM packages/tokens/tokens.json - DO NOT EDIT */
/* Run \`bun run tokens:build\` to regenerate. */`;

const COLOR_MAP = `/* Semantic color utilities (bg-primary, text-muted-foreground, ...) over the token variables. */
@theme inline {
	--color-background: var(--background);
	--color-foreground: var(--foreground);
	--color-card: var(--card);
	--color-card-foreground: var(--card-foreground);
	--color-popover: var(--popover);
	--color-popover-foreground: var(--popover-foreground);
	--color-primary: var(--primary);
	--color-primary-foreground: var(--primary-foreground);
	--color-accent: var(--accent);
	--color-accent-foreground: var(--accent-foreground);
	--color-secondary: var(--secondary);
	--color-secondary-foreground: var(--secondary-foreground);
	--color-muted: var(--muted);
	--color-muted-foreground: var(--muted-foreground);
	--color-border: var(--border);
	--color-ring: var(--ring);
	--color-input: var(--input);
	--color-destructive: var(--destructive);
	--color-destructive-foreground: var(--destructive-foreground);

	--color-sidebar: var(--background);
	--color-sidebar-foreground: var(--foreground);
	--color-sidebar-accent: var(--accent);
	--color-sidebar-accent-foreground: var(--accent-foreground);
	--color-sidebar-border: var(--border);
	--color-sidebar-ring: var(--ring);
	--color-sidebar-primary: var(--primary);
	--color-sidebar-primary-foreground: var(--primary-foreground);

	--color-terminal: var(--terminal);
	--color-manifesto: var(--manifesto);
	--color-accent-text: var(--accent-text);
	--color-border-subtle: var(--border-subtle);
	--color-border-strong: var(--border-strong);
	--color-success: var(--success);
	--color-primary-hover: var(--primary-hover);
	--color-accent-hover: var(--accent-hover);
	--color-signage-bg: var(--signage-bg);
	--color-signage-text: var(--signage-text);
}`;

function leaves(tree: TokenTree, group: string): [string, Token][] {
  const node = tree[group];
  if (node === undefined || isLeaf(node)) return [];
  return Object.entries(node).filter((entry): entry is [string, Token] => isLeaf(entry[1]));
}

/**
 * Tailwind v4 @theme namespace conventions:
 *   --font-*     → font-* utilities
 *   --text-*     → text-{name} utilities (font-size)
 *   --tracking-* → tracking-{name} utilities
 *   --radius-*   → rounded-* utilities
 *   --shadow-*   → shadow-* utilities
 *   --spacing-{name} → p-{name}, m-{name}, gap-{name}
 *   --width-{name}   → w-{name}, max-w-{name}
 *   --z-index-{name} → z-{name}
 * Sizes stay in plain @theme, not @theme inline: utilities then read var(--text-*), so
 * tokens.css (and its density modes) decide the value at runtime.
 */
function emitTokens(tree: TokenTree): string[] {
  return [
    ...leaves(tree, 'font').map(([k, v]) => `  --font-${k}: ${serializeCss(v)};`),
    ...leaves(tree, 'text').map(([k, v]) => `  --text-${k}: ${serializeCss(v)};`),
    ...leaves(tree, 'tracking').map(([k]) => `  --tracking-${k}: var(--tracking-${k});`),
    ...leaves(tree, 'radius').map(([k, v]) => `  --radius-${k}: ${serializeCss(v)};`),
    ...leaves(tree, 'shadow').map(([k]) => `  --shadow-${k}: var(--shadow-${k});`),
    ...leaves(tree, 'z').map(([k]) => `  --z-index-${k}: var(--z-${k});`),
    ...leaves(tree, 'container').map(([k]) => `  --width-${k}: var(--container-${k});`),
    ...leaves(tree, 'space').map(([k]) => `  --spacing-${k}: var(--space-${k});`),
  ];
}

/** The whole of @yesid/tokens/theme.css: the token theme plus the semantic color utilities. */
export function generateThemeCss(tree: TokenTree): string {
  return `${HEADER}

@theme {
${emitTokens(tree).join('\n')}
}

${COLOR_MAP}
`;
}
