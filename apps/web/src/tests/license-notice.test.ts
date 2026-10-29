import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

describe('third-party license notice', () => {
	it('binds the GSAP notice to the resolved lockfile version', () => {
		const lockfile = readFileSync(resolve(REPO_ROOT, 'bun.lock'), 'utf8');
		const notice = readFileSync(resolve(REPO_ROOT, 'NOTICE'), 'utf8');
		const version = /"gsap": \["gsap@([^"\]]+)"/u.exec(lockfile)?.[1];

		expect(version).toBeDefined();
		expect(notice).toContain(`GSAP \`${version}\``);
	});
});
