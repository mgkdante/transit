import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brandHexViolations } from '@yesid/gates';
import { afterEach, describe, expect, it } from 'vitest';
import { TRANSIT_BRAND_HEXES } from '../../tools/design-gates';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));

function scan(files: Record<string, string>): string[] {
	root = mkdtempSync(join(tmpdir(), 'brand-hex-'));
	for (const [name, source] of Object.entries(files)) writeFileSync(join(root, name), source);
	return brandHexViolations({ root, hexes: TRANSIT_BRAND_HEXES }).violations;
}

describe('brand hex policy', () => {
	it('rejects both brand hexes in any source file, with no allowlisted file', () => {
		const violations = scan({
			'orange.css': ':root { --a: #E07800; }',
			'amber.css': ':root { --a: #FFB627; }',
		});

		expect(violations).toHaveLength(2);
	});

	it('accepts tokens and other colors', () => {
		expect(scan({ 'ok.css': ':root { --a: var(--accent); --b: #E8540E; }' })).toEqual([]);
	});
});
