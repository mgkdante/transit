import type { TokenTree } from '../types.ts';
import { isPrimitive } from '../parse.ts';

const HEADER = `// GENERATED FROM packages/tokens/tokens.json — DO NOT EDIT
// Mirror of motion tokens for JS consumers (GSAP, Svelte actions) that need
// these values at compute time without paying for getComputedStyle().
// Repository artifact tests keep this in sync with the package-owned CSS.
// Run \`bun run tokens:build\` to regenerate.

`;

function camel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function parseMs(value: string): number {
  const m = value.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!m || !m[1] || !m[2]) throw new Error(`generateMotionTs: cannot parse duration "${value}"`);
  const n = parseFloat(m[1]);
  return m[2] === 's' ? n * 1000 : n;
}

export function generateMotionTs(tree: TokenTree): string {
  const durations = tree.duration as TokenTree | undefined;
  const eases = tree.ease as TokenTree | undefined;
  if (!durations || !eases) {
    throw new Error('generateMotionTs: tokens.json must define duration and ease branches');
  }

  const durLines: string[] = [];
  for (const [k, v] of Object.entries(durations)) {
    if (!isPrimitive(v)) continue;
    durLines.push(`\t${camel(k)}: ${parseMs(String(v.$value))},`);
  }

  const easeLines: string[] = [];
  for (const [k, v] of Object.entries(eases)) {
    if (!isPrimitive(v)) continue;
    easeLines.push(`\t${camel(k)}: '${v.$value}',`);
  }

  return `${HEADER}export const duration = {
${durLines.join('\n')}
} as const;

export const ease = {
${easeLines.join('\n')}
} as const;

export type DurationKey = keyof typeof duration;
export type EaseKey = keyof typeof ease;

// Convenience: duration in seconds (GSAP uses seconds, not ms).
export function durationSec(key: DurationKey): number {
\treturn duration[key] / 1000;
}
`;
}
