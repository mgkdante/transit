#!/usr/bin/env bun
// Ported from yesid.dev @ 2bdb611d91749dc437c07586cb82129eabe9dfec — only the
// four OUTPUT PATHS are retargeted to this repo's consumers (apps/gallery +
// packages/motion + repo-root DESIGN.md). Generator logic is byte-faithful.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokens } from './src/parse.ts';
import { generateTokensCss } from './src/generators/tokens-css.ts';
import { generateThemeBlock, replaceThemeRegion } from './src/generators/theme-block.ts';
import { generateMotionTs } from './src/generators/motion-ts.ts';
import { generateDesignMd } from './src/generators/design-md.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const TOKENS_JSON = resolve(here, 'tokens.json');
const TOKENS_CSS = resolve(repoRoot, 'apps/gallery/src/lib/styles/tokens.css');
const APP_CSS = resolve(repoRoot, 'apps/gallery/src/app.css');
const MOTION_TS = resolve(repoRoot, 'packages/motion/src/tokens.ts');
const DESIGN_MD = resolve(repoRoot, 'DESIGN.md');

interface BuildTarget {
  path: string;
  content: string;
}

function buildAll(): BuildTarget[] {
  const tree = parseTokens(JSON.parse(readFileSync(TOKENS_JSON, 'utf-8')));

  const tokensCss = generateTokensCss(tree);
  const themeBlock = generateThemeBlock(tree);
  const motionTs = generateMotionTs(tree);
  const designMd = generateDesignMd(tree);

  // For app.css we replace only the sentinel region. If the file doesn't exist or
  // lacks sentinels, we error loudly — this is intentional; the consuming app
  // authors the sentinels once.
  //
  // Ownership boundary (inherited from yesid.dev slice-28.3): ONLY the sentinel
  // region (`GENERATED FROM packages/tokens/tokens.json` … `TOKENS:END`) is
  // generated. Everything else in app.css — utilities, keyframes, the
  // hand-maintained `@theme inline` color map — is owned by the consuming app.
  // The pre-commit generated-files guard is deliberately coarse (it flags ANY
  // app.css edit), so hand-region commits must pair with a tokens source change
  // like this file; see .githooks/pre-commit.
  let appCssContent: string;
  if (existsSync(APP_CSS)) {
    appCssContent = replaceThemeRegion(readFileSync(APP_CSS, 'utf-8'), themeBlock);
  } else {
    throw new Error(`app.css not found at ${APP_CSS}`);
  }

  return [
    { path: TOKENS_CSS, content: tokensCss },
    { path: APP_CSS, content: appCssContent },
    { path: MOTION_TS, content: motionTs },
    { path: DESIGN_MD, content: designMd },
  ];
}

function writeIfChanged(target: BuildTarget): boolean {
  const current = existsSync(target.path) ? readFileSync(target.path, 'utf-8') : null;
  if (current === target.content) return false;
  writeFileSync(target.path, target.content, 'utf-8');
  return true;
}

const targets = buildAll();
let changed = 0;
for (const t of targets) {
  if (writeIfChanged(t)) {
    console.log(`  wrote ${t.path}`);
    changed++;
  }
}
console.log(changed === 0 ? '✓ build idempotent (no changes)' : `✓ build wrote ${changed} file(s)`);
