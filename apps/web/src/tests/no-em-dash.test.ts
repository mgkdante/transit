import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const EM_DASH = '—';
const rel = (p: string) => p.replace(resolve(process.cwd()) + '/', '');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts)$/.test(p) && !/\.(test|spec)\.ts$/.test(p)) out.push(p);
	}
	return out;
}

function blankComments(src: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return src
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])(\/\/.*)$/gm, (_full, pre: string, comment: string) => pre + blank(comment));
}

describe('brand voice — no em dash in any rendered string', () => {
	const files = walk(SRC);

	it('scans a non-empty source tree (guards against a wrong path)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no string literal anywhere in src contains an em dash (copy → comma/period; no-data glyph → "·")', () => {
		const violations: string[] = [];
		for (const file of files) {
			blankComments(readFileSync(file, 'utf-8'))
				.split('\n')
				.forEach((line, i) => {
					if (line.includes(EM_DASH)) violations.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
				});
		}
		expect(
			violations,
			`Em dash (U+2014) in a shipped string. The brand voice never uses it — replace prose with ` +
				`a comma (continuation) or a period (independent clause), and a no-data placeholder with ` +
				`the middle dot "·":\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
