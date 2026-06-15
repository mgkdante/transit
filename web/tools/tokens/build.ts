// Token build — ported from yesid.dev packages/tokens/build.ts off bun → tsx/node.
// Run: `pnpm tokens:build` (script = `tsx tools/tokens/build.ts`).
// Source of truth: tools/tokens/tokens.json (DTCG). Emits 3 checked-in artifacts;
// a CI `tokens:build && git diff --exit-code` gate keeps them in sync (slice-9.2 P0.9).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokens } from './src/parse.ts';
import { generateTokensCss } from './src/generators/tokens-css.ts';
import { generateThemeBlock, replaceThemeRegion } from './src/generators/theme-block.ts';
import { generateMotionTs } from './src/generators/motion-ts.ts';

const here = dirname(fileURLToPath(import.meta.url)); // web/tools/tokens
const webRoot = resolve(here, '../..'); // web/

const TOKENS_JSON = resolve(here, 'tokens.json');
const TOKENS_CSS = resolve(webRoot, 'src/lib/styles/tokens.css');
const APP_CSS = resolve(webRoot, 'src/app.css');
const MOTION_TS = resolve(webRoot, 'src/lib/motion/tokens.ts');

interface BuildTarget {
	path: string;
	content: string;
}

function buildAll(): BuildTarget[] {
	const tree = parseTokens(JSON.parse(readFileSync(TOKENS_JSON, 'utf-8')));

	const tokensCss = generateTokensCss(tree);
	const themeBlock = generateThemeBlock(tree);
	const motionTs = generateMotionTs(tree);

	// app.css: only the sentinel region (TOKENS:START..TOKENS:END) is generated;
	// everything else is hand-maintained. The file must pre-exist with sentinels.
	if (!existsSync(APP_CSS)) {
		throw new Error(`app.css not found at ${APP_CSS} — author it with the TOKENS:START/END sentinels first.`);
	}
	const appCssContent = replaceThemeRegion(readFileSync(APP_CSS, 'utf-8'), themeBlock);

	return [
		{ path: TOKENS_CSS, content: tokensCss },
		{ path: APP_CSS, content: appCssContent },
		{ path: MOTION_TS, content: motionTs },
	];
}

function writeIfChanged(target: BuildTarget): boolean {
	const current = existsSync(target.path) ? readFileSync(target.path, 'utf-8') : null;
	if (current === target.content) return false;
	mkdirSync(dirname(target.path), { recursive: true });
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
console.log(changed === 0 ? '✓ tokens build idempotent (no changes)' : `✓ tokens build wrote ${changed} file(s)`);
