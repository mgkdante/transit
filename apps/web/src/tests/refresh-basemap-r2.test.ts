import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), '../..', '.github/scripts/refresh-basemap-r2.mjs');
const STABLE_KEY = 'transit-snapshots/v1/stm/static/basemap/montreal.pmtiles';
const BACKUP_KEY = 'transit-snapshots/v1/stm/static/basemap/backups/test-before.pmtiles';
const temporaryDirectories: string[] = [];

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function makeFakeWrangler(root: string): Promise<string> {
	const executable = join(root, 'fake-wrangler.mjs');
	await writeFile(
		executable,
		`#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const operation = args[2];
const objectPath = args[3];
const fileFlag = args.find((value) => value.startsWith('--file='));
if (
  args[0] !== 'r2' ||
  args[1] !== 'object' ||
  !['get', 'put'].includes(operation) ||
  !fileFlag ||
  !args.includes('--remote') ||
  (operation === 'put' && !args.includes('--content-type=application/octet-stream'))
) {
  console.error('unexpected fake Wrangler arguments', JSON.stringify(args));
  process.exit(2);
}
const file = fileFlag.slice('--file='.length);
const object = join(process.env.FAKE_R2_ROOT, objectPath);
const statePath = join(
  process.env.FAKE_R2_ROOT,
  '.fake-wrangler-state',
  Buffer.from(operation + ':' + objectPath).toString('base64url'),
);
await mkdir(dirname(statePath), { recursive: true });
const count = Number(await readFile(statePath, 'utf8').catch(() => '0')) + 1;
await writeFile(statePath, String(count));
if (
  operation === 'put' &&
  process.env.FAKE_R2_FAIL_PUT_KEY === objectPath &&
  Number(process.env.FAKE_R2_FAIL_PUT_NUMBER) === count
) {
  console.error('forced fake Wrangler put failure');
  process.exit(23);
}
if (operation === 'get') {
  const corruptGetNumbers = (process.env.FAKE_R2_CORRUPT_GET_NUMBERS ?? process.env.FAKE_R2_CORRUPT_GET_NUMBER ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
  if (
    process.env.FAKE_R2_CORRUPT_GET_KEY === objectPath &&
    corruptGetNumbers.includes(count)
  ) {
    await writeFile(file, 'forced corrupt readback');
  } else {
    await copyFile(object, file);
  }
} else {
  await mkdir(dirname(object), { recursive: true });
  await copyFile(file, object);
  if (
    process.env.FAKE_R2_FAIL_PUT_AFTER_COPY_KEY === objectPath &&
    Number(process.env.FAKE_R2_FAIL_PUT_AFTER_COPY_NUMBER) === count
  ) {
    console.error('forced fake Wrangler failure after committed put');
    process.exit(24);
  }
}
`,
	);
	await chmod(executable, 0o755);
	return executable;
}

async function runHelper(
	root: string,
	wrangler: string,
	newFile: string,
	receipt: string,
	extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const child = spawn(
		process.execPath,
		[
			SCRIPT,
			'--bucket=transit-snapshots',
			'--key=v1/stm/static/basemap/montreal.pmtiles',
			'--backup-key=v1/stm/static/basemap/backups/test-before.pmtiles',
			`--new-file=${newFile}`,
			`--receipt=${receipt}`,
		],
		{
			env: { ...process.env, FAKE_R2_ROOT: root, WRANGLER_BIN: wrangler, ...extraEnv },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => (stdout += chunk));
	child.stderr.on('data', (chunk: string) => (stderr += chunk));
	const code = await new Promise<number | null>((resolveExit) => child.once('close', resolveExit));
	return { code, stdout, stderr };
}

async function makeFixture() {
	const root = await mkdtemp(join(tmpdir(), 'transit-r2-transaction-'));
	temporaryDirectories.push(root);
	const wrangler = await makeFakeWrangler(root);
	const stable = join(root, STABLE_KEY);
	const backup = join(root, BACKUP_KEY);
	const newFile = join(root, 'new.pmtiles');
	const receipt = join(root, 'receipt.json');
	const previousBytes = Buffer.from('previous immutable basemap');
	const newBytes = Buffer.from('new verified basemap');
	await mkdir(resolve(stable, '..'), { recursive: true });
	await writeFile(stable, previousBytes);
	await writeFile(newFile, newBytes);
	return {
		stable,
		backup,
		receipt,
		previousBytes,
		newBytes,
		run: (extraEnv: NodeJS.ProcessEnv = {}) =>
			runHelper(root, wrangler, newFile, receipt, extraEnv),
	};
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('basemap R2 replacement transaction', () => {
	it('backs up and verifies the previous object before replacing the stable key', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run();

		expect(result, result.stderr).toMatchObject({ code: 0 });
		expect(await readFile(fixture.stable)).toEqual(fixture.newBytes);
		expect(await readFile(fixture.backup)).toEqual(fixture.previousBytes);
		expect(JSON.parse(await readFile(fixture.receipt, 'utf8'))).toEqual({
			schema_version: 1,
			bucket: 'transit-snapshots',
			stable_key: 'v1/stm/static/basemap/montreal.pmtiles',
			backup_key: 'v1/stm/static/basemap/backups/test-before.pmtiles',
			before: {
				bytes: fixture.previousBytes.byteLength,
				sha256: sha256(fixture.previousBytes),
			},
			after: { bytes: fixture.newBytes.byteLength, sha256: sha256(fixture.newBytes) },
			rollback_performed: false,
		});
	});

	it('leaves the stable object untouched when backup verification fails', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run({
			FAKE_R2_CORRUPT_GET_KEY: BACKUP_KEY,
			FAKE_R2_CORRUPT_GET_NUMBER: '1',
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('backup readback mismatch');
		expect(await readFile(fixture.stable)).toEqual(fixture.previousBytes);
	});

	it('restores and verifies the previous object when stable verification fails', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run({
			FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
			FAKE_R2_CORRUPT_GET_NUMBER: '2',
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('stable readback mismatch');
		expect(result.stderr).toContain('previous object restored and verified');
		expect(await readFile(fixture.stable)).toEqual(fixture.previousBytes);
		expect(await readFile(fixture.backup)).toEqual(fixture.previousBytes);
	});

	it('restores after a stable put reports failure with an uncertain remote outcome', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run({
			FAKE_R2_FAIL_PUT_AFTER_COPY_KEY: STABLE_KEY,
			FAKE_R2_FAIL_PUT_AFTER_COPY_NUMBER: '1',
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('exited with code 24');
		expect(result.stderr).toContain('previous object restored and verified');
		expect(await readFile(fixture.stable)).toEqual(fixture.previousBytes);
	});

	it('reports both the primary failure and a failed restore', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run({
			FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
			FAKE_R2_CORRUPT_GET_NUMBER: '2',
			FAKE_R2_FAIL_PUT_KEY: STABLE_KEY,
			FAKE_R2_FAIL_PUT_NUMBER: '2',
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('stable readback mismatch');
		expect(result.stderr).toContain('RESTORE FAILED');
	});

	it('treats a mismatched restore readback as a restore failure', async () => {
		const fixture = await makeFixture();
		const result = await fixture.run({
			FAKE_R2_CORRUPT_GET_KEY: STABLE_KEY,
			FAKE_R2_CORRUPT_GET_NUMBERS: '2,3',
		});

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('stable readback mismatch');
		expect(result.stderr).toContain('RESTORE FAILED');
		expect(result.stderr).toContain('restored stable readback mismatch');
	});
});
