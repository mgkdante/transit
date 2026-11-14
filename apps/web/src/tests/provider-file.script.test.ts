import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

test('provider file script suite', () => {
	try {
		execFileSync('bun', ['test', 'scripts/provider-file.test.ts'], {
			cwd: fileURLToPath(new URL('../../', import.meta.url)),
			stdio: 'pipe',
		});
	} catch (error) {
		const output = error as { stdout?: Buffer; stderr?: Buffer };
		throw new Error([output.stdout, output.stderr].join('\n'), { cause: error });
	}
});
