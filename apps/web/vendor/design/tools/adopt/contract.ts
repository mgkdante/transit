import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export const REPOSITORY_ID = 'github.com/mgkdante/yesid.dev-design' as const;
export const MANIFEST_SCHEMA = 2 as const;
export const PACKAGE_NAMES = ['tokens', 'motion', 'gates', 'seo-kit', 'ui', 'analytics'] as const;
export type PackageName = (typeof PACKAGE_NAMES)[number];

export const PACKAGE_EXCLUDE =
	/(^|\/)(__tests__\/|test-fixtures\/|scripts\/|research\/|vitest\.(?:config|setup)\.ts$|vitest\.d\.ts$|\.gitignore$)|\.test\.ts$/;
export const WORKTREE_EXCLUDE = /(^|\/)(node_modules|\.turbo)(\/|$)/;

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export interface TagIdentity {
	name: string;
	object: string;
	peeledCommit: string;
}

export interface ReleaseAssetIdentity {
	name: string;
	size: number;
	digest: string;
}

export interface AdoptProvenance {
	mode: 'release' | 'archive' | 'worktree';
	tag: TagIdentity;
	asset: ReleaseAssetIdentity | null;
}

export interface AdoptManifest {
	schema: typeof MANIFEST_SCHEMA;
	repository: typeof REPOSITORY_ID;
	provenance: AdoptProvenance;
	packages: PackageName[];
	exclusionPolicyDigest: string;
	toolDigest: string;
	treeHash: string;
}

export type AdoptTrustRecord = Omit<AdoptManifest, 'treeHash'>;

function normalizedRelative(root: string, path: string): string {
	return relative(root, path).split(sep).join('/');
}

export function walkFiles(root: string, out: string[] = []): string[] {
	for (const entry of readdirSync(root).sort()) {
		const path = join(root, entry);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`refusing symbolic link ${path}`);
		if (stat.isDirectory()) walkFiles(path, out);
		else if (stat.isFile()) out.push(path);
		else throw new Error(`refusing non-regular filesystem entry ${path}`);
	}
	return out;
}

interface DigestRecord {
	path: Buffer;
	content: Buffer;
}

function digestRecords(records: readonly DigestRecord[]): string {
	const hash = createHash('sha256');
	const ordered = [...records].sort((a, b) => Buffer.compare(a.path, b.path));
	const length = (size: number): Buffer => {
		const buffer = Buffer.allocUnsafe(8);
		buffer.writeBigUInt64BE(BigInt(size));
		return buffer;
	};
	for (const record of ordered) {
		hash.update(length(record.path.byteLength));
		hash.update(record.path);
		hash.update(length(record.content.byteLength));
		hash.update(record.content);
	}
	return `sha256:${hash.digest('hex')}`;
}

function fileRecords(root: string, files: readonly string[]): DigestRecord[] {
	return files.map((path) => ({
		path: Buffer.from(normalizedRelative(root, path)),
		content: readFileSync(path),
	}));
}

function digestFiles(root: string, files: readonly string[]): string {
	return digestRecords(fileRecords(root, files));
}

function canonicalTrustRecord(trust: AdoptTrustRecord): Buffer {
	return Buffer.from(
		JSON.stringify({
			schema: trust.schema,
			repository: trust.repository,
			provenance: {
				mode: trust.provenance.mode,
				tag: {
					name: trust.provenance.tag.name,
					object: trust.provenance.tag.object,
					peeledCommit: trust.provenance.tag.peeledCommit,
				},
				asset: trust.provenance.asset
					? {
							name: trust.provenance.asset.name,
							size: trust.provenance.asset.size,
							digest: trust.provenance.asset.digest,
						}
					: null,
			},
			packages: trust.packages,
			exclusionPolicyDigest: trust.exclusionPolicyDigest,
			toolDigest: trust.toolDigest,
		}),
	);
}

export function treeHash(root: string, trust: AdoptTrustRecord): string {
	const files = walkFiles(root).filter(
		(path) => normalizedRelative(root, path) !== 'manifest.json',
	);
	return digestRecords([
		...fileRecords(root, files),
		{
			// NUL cannot occur in a filesystem path, so this record cannot collide with payload bytes.
			path: Buffer.from('\0yesid-adopt/trust-v2'),
			content: canonicalTrustRecord(trust),
		},
	]);
}

export function fullTreeHash(root: string): string {
	return digestFiles(root, walkFiles(root));
}

export function toolDigest(root: string): string {
	const files = walkFiles(join(root, 'tools')).filter((path) => {
		const rel = normalizedRelative(root, path);
		return rel === 'tools/adopt.ts' || rel.startsWith('tools/adopt/');
	});
	if (files.length === 0) throw new Error(`adopt tool bundle not found under ${root}`);
	return digestFiles(root, files);
}

export function exclusionPolicyDigest(): string {
	const canonical = JSON.stringify({
		package: { source: PACKAGE_EXCLUDE.source, flags: PACKAGE_EXCLUDE.flags },
		worktree: { source: WORKTREE_EXCLUDE.source, flags: WORKTREE_EXCLUDE.flags },
	});
	return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export function assertTag(tag: string): void {
	if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
		throw new Error(`invalid tag "${tag}"; expected vX.Y.Z`);
	}
}

export function assertCommit(commit: string): void {
	if (!SHA1.test(commit)) {
		throw new Error(`invalid commit "${commit}"; expected a 40-character Git commit`);
	}
}

export function parsePackages(raw: string): PackageName[] {
	const requested = raw.split(',').map((name) => name.trim());
	if (requested.length === 0 || requested.some((name) => name.length === 0)) {
		throw new Error('--packages must contain at least one package');
	}
	if (new Set(requested).size !== requested.length) {
		throw new Error('--packages contains a duplicate package');
	}
	for (const name of requested) {
		if (!PACKAGE_NAMES.includes(name as PackageName)) {
			throw new Error(`unknown package "${name}"; choose from ${PACKAGE_NAMES.join(',')}`);
		}
	}
	return PACKAGE_NAMES.filter((name) => requested.includes(name));
}

function assertDigest(value: unknown, field: string): asserts value is string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`invalid ${field}`);
}

function assertCanonicalKeys(
	value: object,
	expected: readonly string[],
	label: string,
	path: string,
): void {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
		throw new Error(`manifest ${label} keys are not canonical at ${path}`);
	}
}

export function parseManifest(value: unknown, path: string): AdoptManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid manifest at ${path}`);
	}
	const manifest = value as Partial<AdoptManifest>;
	const expectedKeys = [
		'schema',
		'repository',
		'provenance',
		'packages',
		'exclusionPolicyDigest',
		'toolDigest',
		'treeHash',
	];
	assertCanonicalKeys(manifest, expectedKeys, 'top-level', path);
	if (manifest.schema !== MANIFEST_SCHEMA || manifest.repository !== REPOSITORY_ID) {
		throw new Error(`invalid manifest identity at ${path}`);
	}
	const provenance = parseProvenance(manifest.provenance, path);
	if (!Array.isArray(manifest.packages)) throw new Error(`invalid package closure at ${path}`);
	const packages = parsePackages(manifest.packages.join(','));
	if (packages.join(',') !== manifest.packages.join(',')) {
		throw new Error(`manifest packages are not in canonical order at ${path}`);
	}
	assertDigest(manifest.exclusionPolicyDigest, `exclusionPolicyDigest in ${path}`);
	assertDigest(manifest.toolDigest, `toolDigest in ${path}`);
	assertDigest(manifest.treeHash, `treeHash in ${path}`);
	return { ...manifest, provenance } as AdoptManifest;
}

export function parseProvenance(value: unknown, path: string): AdoptProvenance {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid provenance at ${path}`);
	}
	const provenance = value as Partial<AdoptProvenance>;
	if (!['release', 'archive', 'worktree'].includes(provenance.mode ?? '')) {
		throw new Error(`invalid provenance at ${path}`);
	}
	assertCanonicalKeys(provenance, ['mode', 'tag', 'asset'], 'provenance', path);
	if (!provenance.tag || typeof provenance.tag !== 'object') {
		throw new Error(`invalid tag provenance at ${path}`);
	}
	assertCanonicalKeys(provenance.tag, ['name', 'object', 'peeledCommit'], 'tag', path);
	assertTag(provenance.tag?.name ?? '');
	assertCommit(provenance.tag?.object ?? '');
	assertCommit(provenance.tag?.peeledCommit ?? '');
	if (provenance.mode === 'release') {
		if (!provenance.asset || typeof provenance.asset.name !== 'string') {
			throw new Error(`release manifest has no asset at ${path}`);
		}
		assertCanonicalKeys(provenance.asset, ['name', 'size', 'digest'], 'asset', path);
		if (
			provenance.asset.name.length === 0 ||
			provenance.asset.name === '.' ||
			provenance.asset.name === '..' ||
			/[\\/\0]/.test(provenance.asset.name)
		) {
			throw new Error(`unsafe release asset name at ${path}`);
		}
		if (!Number.isSafeInteger(provenance.asset.size) || provenance.asset.size <= 0) {
			throw new Error(`invalid release asset size at ${path}`);
		}
		assertDigest(provenance.asset.digest, `release asset digest in ${path}`);
	} else if (provenance.asset !== null) {
		throw new Error(`development provenance must not claim a Release asset at ${path}`);
	}
	return provenance as AdoptProvenance;
}

export function pathInside(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
