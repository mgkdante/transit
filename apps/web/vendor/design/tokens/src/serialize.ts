import type { Token } from './types.ts';
import { isClampToken } from './parse.ts';

/** Render a token's value as a CSS expression. */
export function serializeCss(token: Token): string {
  if (isClampToken(token)) {
    const { min, preferred, max } = token.$value;
    return `clamp(${min}, ${preferred}, ${max})`;
  }
  const v = token.$value;
  return typeof v === 'number' ? String(v) : v;
}

/** Render a token's value as a YAML scalar (DESIGN.md front matter). */
export function serializeYaml(token: Token): string {
  if (isClampToken(token)) {
    return `"${serializeCss(token)}"`;
  }
  const v = token.$value;
  if (typeof v === 'number') return String(v);
  return `"${v}"`;
}
