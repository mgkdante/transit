import { createHash, randomUUID } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_URL =
	'https://github.com/mgkdante/yesid.dev-design/releases/download/v0.28.0/yesid-config-0.28.0.tgz';
const CONFIG_LOCK_INTEGRITY = 'TO_FILL';
const CONFIG_DIGEST = '588a4acf72f44593561112fc945d410548b56cf556bbbc9bc745c1f7b218424f';
const CONFIG_PACKAGE = { name: '@yesid/config', version: '0.28.0' };
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DESTINATION = 'node_modules/.yesid-shared-tooling/turbo/base.json';

function fail(message) {
	throw new Error(`materialize-shared-config: ${message}`);
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function json(path, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		fail(`${label} must be readable JSON`);
	}
}

function ensureRegularDirectory(root, path) {
	const candidate = resolve(path);
	const traversal = relative(root, candidate);
	if (traversal === '' || traversal.startsWith(`..${sep}`) || traversal === '..') {
		fail('destination directory must stay below the repository root');
	}
	let cursor = root;
	for (const segment of traversal.split(sep)) {
		cursor = join(cursor, segment);
		if (!existsSync(cursor)) mkdirSync(cursor);
		const status = lstatSync(cursor);
		if (status.isSymbolicLink() || !status.isDirectory()) {
			fail(`destination directory must not traverse a symbolic link: ${traversal}`);
		}
	}
}

export function materializeSharedConfig(repositoryRoot = REPOSITORY_ROOT) {
	const root = resolve(repositoryRoot);
	const rootManifest = json(join(root, 'package.json'), 'workspace package.json');
	if (rootManifest.devDependencies?.['@yesid/config'] !== CONFIG_URL) {
		fail('workspace must pin the immutable v0.28.0 Release asset');
	}
	const lockfile = readFileSync(join(root, 'bun.lock'), 'utf8');
	if (!lockfile.includes(CONFIG_URL) || !lockfile.includes(CONFIG_LOCK_INTEGRITY)) {
		fail('bun.lock must resolve the immutable v0.28.0 Release asset');
	}

	const require = createRequire(join(root, 'package.json'));
	let packageManifestPath;
	try {
		packageManifestPath = require.resolve('@yesid/config/package.json');
	} catch {
		fail('@yesid/config is not installed');
	}
	const configRoot = dirname(packageManifestPath);
	const packageManifest = json(packageManifestPath, '@yesid/config package.json');
	if (
		packageManifest.name !== CONFIG_PACKAGE.name ||
		packageManifest.version !== CONFIG_PACKAGE.version
	) {
		fail('installed package identity does not match @yesid/config@0.28.0');
	}

	const source = join(configRoot, 'turbo/base.json');
	if (!lstatSync(source).isFile()) fail('shared Turbo base must be a regular file');
	const sourceBytes = readFileSync(source);
	if (sha256(sourceBytes) !== CONFIG_DIGEST) fail('shared Turbo base digest does not match');

	const destination = join(root, DESTINATION);
	ensureRegularDirectory(root, dirname(destination));
	if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
		fail('materialized Turbo base must not be a symbolic link');
	}
	const temporary = join(dirname(destination), `.base-${process.pid}-${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, sourceBytes, { flag: 'wx', mode: 0o644 });
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
	if (lstatSync(destination).isSymbolicLink() || !lstatSync(destination).isFile()) {
		fail('materialized Turbo base must be a regular file');
	}
	if (sha256(readFileSync(destination)) !== CONFIG_DIGEST) {
		fail('materialized Turbo base digest does not match');
	}

	return {
		schema: 1,
		package: CONFIG_PACKAGE,
		destination: DESTINATION,
		digest: `sha256:${CONFIG_DIGEST}`,
	};
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
	try {
		process.stdout.write(`${JSON.stringify(materializeSharedConfig())}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
