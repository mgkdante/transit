import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Section0Verdict card interaction boundary', () => {
	it('protects the pinned distribution readout from whole-card toggling', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/lines/reliability/sections/Section0Verdict.svelte'),
			'utf-8',
		);

		expect(source).toMatch(/<span\s+data-slot="delay-dist-readout"\s+data-card-interactive\s*>/);
	});
});
