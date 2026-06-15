import type { TokenTree, Token } from '../types.ts';
import { serializeCss } from '../serialize.ts';
import { isLeaf } from '../parse.ts';

const HEADER = `/* GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT */
/* Run \`pnpm tokens:build\` to regenerate. */
`;

/**
 * Paired tokens: CSS architectural cross-references (not raw DTCG values).
 * These map shadcn-compatible aliases to primary semantic tokens via var().
 * A theme group may override any of these by declaring the same token name
 * explicitly (e.g. light accent-foreground #111111) — explicit wins, the
 * paired alias is skipped for that theme (GO-day W2 Track 2).
 */
const PAIRED_DEFS: ReadonlyArray<{ name: string; line: string }> = [
  { name: 'card-foreground', line: '--card-foreground: var(--foreground);' },
  { name: 'popover-foreground', line: '--popover-foreground: var(--foreground);' },
  { name: 'primary-foreground', line: '--primary-foreground: var(--background);' },
  { name: 'accent-foreground', line: '--accent-foreground: var(--background);' },
  { name: 'secondary', line: '--secondary: var(--popover);' },
  { name: 'ring', line: '--ring: var(--primary);' },
  { name: 'input', line: '--input: var(--border);' },
];

interface FlatToken {
  cssName: string;
  token: Token;
}

/** Walk a subtree and yield CSS-name → token pairs. Skips $-prefixed metadata. */
function flatten(tree: TokenTree, prefix = ''): FlatToken[] {
  const out: FlatToken[] = [];
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith('$')) continue;
    const name = prefix ? `${prefix}-${k}` : k;
    if (isLeaf(v)) {
      out.push({ cssName: name, token: v });
    } else {
      out.push(...flatten(v as TokenTree, name));
    }
  }
  return out;
}

/** Paired-alias emitter at a given indent; skips names the theme declares explicitly. */
function pairedBlock(items: FlatToken[], indent: string): string {
  const explicit = new Set(items.map((i) => i.cssName));
  const lines = PAIRED_DEFS.filter((p) => !explicit.has(p.name)).map(
    (p) => `${indent}${p.line}`,
  );
  return [`${indent}/* Paired tokens (shadcn-compatible) */`, ...lines].join('\n');
}

function emitBlock(selector: string, colorScheme: 'dark' | 'light' | null, items: FlatToken[], extra?: string): string {
  if (items.length === 0) return '';
  const lead = colorScheme ? [`  color-scheme: ${colorScheme};`] : [];
  const lines = items.map(({ cssName, token }) => `  --${cssName}: ${serializeCss(token)};`);
  const body = [...lead, ...lines].join('\n') + (extra ? `\n\n${extra}` : '');
  return `${selector} {\n${body}\n}\n`;
}

function emitMedia(scheme: 'dark' | 'light', guard: string, items: FlatToken[]): string {
  const lines = items.map(({ cssName, token }) => `    --${cssName}: ${serializeCss(token)};`);
  return (
    `@media (prefers-color-scheme: ${scheme}) {\n` +
    `  ${guard} {\n` +
    `    color-scheme: ${scheme};\n` +
    lines.join('\n') +
    `\n\n` +
    pairedBlock(items, '    ') +
    `\n  }\n}\n`
  );
}

export function generateTokensCss(tree: TokenTree): string {
  // :root holds brand + non-themed tokens (radius, duration, ease, z, opacity,
  // container, font, text, space, shadow, surface aliases, color.brand).
  const rootItems: FlatToken[] = [];
  const darkItems: FlatToken[] = [];
  const lightItems: FlatToken[] = [];

  for (const [topKey, topValue] of Object.entries(tree)) {
    if (topKey.startsWith('$')) continue;
    if (topKey === 'color') {
      for (const [subKey, subValue] of Object.entries(topValue as TokenTree)) {
        const flat = flatten(subValue as TokenTree, '');
        if (subKey === 'brand') rootItems.push(...flat);
        else if (subKey === 'dark') darkItems.push(...flat);
        else if (subKey === 'light') lightItems.push(...flat);
      }
    } else {
      const flat = flatten(topValue as TokenTree, topKey);
      rootItems.push(...flat);
    }
  }

  const rootExtra = '  /* shadcn alias — components reference --radius */\n  --radius: var(--radius-md);';

  const darkBlock = emitBlock('[data-theme="dark"], .theme-dark', 'dark', darkItems, pairedBlock(darkItems, '  '));
  const lightBlock = emitBlock('[data-theme="light"], .theme-light', 'light', lightItems, pairedBlock(lightItems, '  '));

  // prefers-color-scheme fallbacks mirror the attribute-selector theme blocks.
  // These fire only when no data-theme attribute exists (belt-and-braces; the
  // app.html inline script always sets one).
  const darkMedia = emitMedia('dark', ':root:not([data-theme="light"])', darkItems);
  const lightMedia = emitMedia('light', ':root:not([data-theme="dark"])', lightItems);

  return (
    HEADER + '\n' +
    emitBlock(':root', null, rootItems, rootExtra) + '\n' +
    darkBlock + '\n' +
    lightBlock + '\n' +
    darkMedia + '\n' +
    lightMedia
  );
}
