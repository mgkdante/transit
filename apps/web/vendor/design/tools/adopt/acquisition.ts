import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	REPOSITORY_ID,
	assertCommit,
	assertTag,
	type AdoptProvenance,
	type TagIdentity,
} from './contract.js';

export { REPOSITORY_ID } from './contract.js';

const REPOSITORY_SLUG = 'mgkdante/yesid.dev-design';
const REPOSITORY_NUMERIC_ID = 1_303_136_912;
const API_ROOT = 'https://api.github.com';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const RECEIPT_NAME = '.yesid-release.json';
const DEFAULT_RELEASE_TIMEOUT_MS = 60_000;

export interface AcquiredSource {
	source: string;
	provenance: AdoptProvenance;
	cleanup(): void;
}

export interface ReleaseAcquisitionOptions {
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
}

interface TarEntry {
	path: string;
	type: 'file' | 'directory';
	content: Buffer;
}

interface SourceReceipt {
	schema: 1;
	repository: typeof REPOSITORY_ID;
	tag: TagIdentity;
}

function runGit(source: string, args: string[]): string {
	const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
	if (result.status !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
		throw new Error(detail);
	}
	return result.stdout.trim();
}

function annotatedTagIdentity(source: string, tag: string): TagIdentity {
	assertTag(tag);
	let object: string;
	try {
		object = runGit(source, ['rev-parse', `refs/tags/${tag}^{tag}`]);
	} catch (error) {
		throw new Error(`worktree requires an annotated tag ${tag}`, { cause: error });
	}
	const peeledCommit = runGit(source, ['rev-parse', `refs/tags/${tag}^{commit}`]);
	assertCommit(object);
	assertCommit(peeledCommit);
	if (runGit(source, ['cat-file', '-t', object]) !== 'tag') {
		throw new Error(`worktree requires an annotated tag ${tag}`);
	}
	return { name: tag, object, peeledCommit };
}

export function acquireWorktree(sourceInput: string, tag: string): AcquiredSource {
	const source = resolve(sourceInput);
	if (!existsSync(source) || !statSync(source).isDirectory()) {
		throw new Error(`worktree source does not exist: ${source}`);
	}
	const identity = annotatedTagIdentity(source, tag);
	const head = runGit(source, ['rev-parse', 'HEAD']);
	assertCommit(head);
	if (head !== identity.peeledCommit) {
		throw new Error(`worktree HEAD ${head} does not match ${tag} at ${identity.peeledCommit}`);
	}
	if (runGit(source, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
		throw new Error(`local adoption requires a clean worktree at ${source}`);
	}
	const tree = runGit(source, ['rev-parse', `${identity.peeledCommit}^{tree}`]);
	assertCommit(tree);
	const rootName = `yesid.dev-design-${tag}`;
	const archived = spawnSync(
		'git',
		['archive', '--format=tar', `--prefix=${rootName}/`, tree],
		{
			cwd: source,
			maxBuffer: MAX_ARCHIVE_BYTES,
		},
	);
	if (archived.status !== 0 || !Buffer.isBuffer(archived.stdout)) {
		const detail = Buffer.isBuffer(archived.stderr)
			? archived.stderr.toString('utf8').trim()
			: `exit ${archived.status}`;
		throw new Error(`could not snapshot tagged worktree: ${detail}`);
	}
	return materializeEntries(
		parseTar(archived.stdout, tag),
		rootName,
		{ mode: 'worktree', tag: identity, asset: null },
	);
}

function isZeroBlock(block: Buffer): boolean {
	return block.every((byte) => byte === 0);
}

function decodeField(header: Buffer, start: number, length: number): string {
	const field = header.subarray(start, start + length);
	const end = field.indexOf(0);
	const bytes = end === -1 ? field : field.subarray(0, end);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`unsafe archive: invalid UTF-8 header`, { cause: error });
	}
}

function parseOctal(header: Buffer, start: number, length: number, label: string): number {
	const raw = header
		.subarray(start, start + length)
		.toString('ascii')
		.replace(/\0.*$/, '')
		.trim();
	if (!/^[0-7]+$/.test(raw)) throw new Error(`unsafe archive: invalid ${label}`);
	const value = Number.parseInt(raw, 8);
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`unsafe archive: invalid ${label}`);
	return value;
}

function validateArchivePath(
	pathInput: string,
	root: string,
	type: TarEntry['type'],
): string {
	const hasTrailingSlash = pathInput.endsWith('/');
	if (hasTrailingSlash && (type !== 'directory' || pathInput.endsWith('//'))) {
		throw new Error(`unsafe archive path ${JSON.stringify(pathInput)}`);
	}
	const path = hasTrailingSlash ? pathInput.slice(0, -1) : pathInput;
	if (
		path.length === 0 ||
		path !== path.normalize('NFC') ||
		path.startsWith('/') ||
		path.startsWith('\\\\') ||
		/^[A-Za-z]:/.test(path) ||
		path.includes('\\') ||
		/[\0-\x1f\x7f]/.test(path)
	) {
		throw new Error(`unsafe archive path ${JSON.stringify(path)}`);
	}
	const parts = path.split('/');
	if (
		parts.some((part) => {
			const deviceStem = (part.split('.')[0] ?? '').replace(/[ .]+$/u, '');
			return (
				part === '' ||
				part === '.' ||
				part === '..' ||
				/[<>:"|?*]/u.test(part) ||
				/[. ]$/u.test(part) ||
				/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/iu.test(deviceStem)
			);
		})
	) {
		throw new Error(`unsafe archive path ${JSON.stringify(path)}`);
	}
	if (parts[0] !== root || (parts.length < 2 && type !== 'directory')) {
		throw new Error(`unsafe archive: expected one ${root} root`);
	}
	return path;
}

function parseTar(archive: Buffer, tag: string): TarEntry[] {
	if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES || archive.length % 512 !== 0) {
		throw new Error(`unsafe archive: invalid archive size`);
	}
	const root = `yesid.dev-design-${tag}`;
	const entries: TarEntry[] = [];
	const names = new Set<string>();
	let offset = 0;
	let ended = false;
	let totalBytes = 0;
	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512);
		if (isZeroBlock(header)) {
			const second = archive.subarray(offset + 512, offset + 1024);
			if (second.length !== 512 || !isZeroBlock(second)) {
				throw new Error(`unsafe archive: incomplete terminator`);
			}
			if (!archive.subarray(offset + 1024).every((byte) => byte === 0)) {
				throw new Error(`unsafe archive: trailing data`);
			}
			ended = true;
			break;
		}
		if (header.subarray(257, 263).toString('binary') !== 'ustar\0') {
			throw new Error(`unsafe archive: only POSIX ustar is accepted`);
		}
		if (header.subarray(263, 265).toString('ascii') !== '00') {
			throw new Error(`unsafe archive: invalid POSIX ustar version`);
		}
		const storedChecksum = parseOctal(header, 148, 8, 'checksum');
		const checksumHeader = Buffer.from(header);
		checksumHeader.fill(0x20, 148, 156);
		const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
		if (storedChecksum !== actualChecksum) throw new Error(`unsafe archive: checksum mismatch`);
		const name = decodeField(header, 0, 100);
		const prefix = decodeField(header, 345, 155);
		const rawPath = prefix ? `${prefix}/${name}` : name;
		const typeFlag = String.fromCharCode(header[156] ?? 0);
		if (!['\0', '0', '5'].includes(typeFlag)) {
			throw new Error(`unsafe archive: links and special entries are forbidden`);
		}
		const type = typeFlag === '5' ? 'directory' : 'file';
		const path = validateArchivePath(rawPath, root, type);
		const folded = path.toLowerCase();
		if (names.has(folded)) throw new Error(`unsafe archive: duplicate path ${path}`);
		names.add(folded);
		const size = parseOctal(header, 124, 12, 'file size');
		if (size > MAX_FILE_BYTES) throw new Error(`unsafe archive: file exceeds size limit`);
		if (typeFlag === '5' && size !== 0) throw new Error(`unsafe archive: directory has data`);
		const contentStart = offset + 512;
		const contentEnd = contentStart + size;
		if (contentEnd > archive.length) throw new Error(`unsafe archive: truncated file`);
		const paddedEnd = contentStart + Math.ceil(size / 512) * 512;
		if (
			paddedEnd > archive.length ||
			!archive.subarray(contentEnd, paddedEnd).every((byte) => byte === 0)
		) {
			throw new Error(`unsafe archive: nonzero file padding`);
		}
		totalBytes += size;
		if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error(`unsafe archive: expanded size limit`);
		entries.push({
			path,
			type,
			content: Buffer.from(archive.subarray(contentStart, contentEnd)),
		});
		if (entries.length > MAX_ENTRIES) throw new Error(`unsafe archive: entry limit exceeded`);
		offset = paddedEnd;
	}
	if (!ended) throw new Error(`unsafe archive: missing terminator`);
	return entries;
}

function assertCanonicalKeys(value: object, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
		throw new Error(`unsafe archive: noncanonical ${label}`);
	}
}

function parseReceipt(content: Buffer, expectedTag: string): SourceReceipt {
	let value: unknown;
	try {
		value = JSON.parse(content.toString('utf8'));
	} catch (error) {
		throw new Error(`unsafe archive: invalid release receipt`, { cause: error });
	}
	if (!value || typeof value !== 'object') throw new Error(`unsafe archive: invalid release receipt`);
	assertCanonicalKeys(value, ['schema', 'repository', 'tag'], 'release receipt');
	const receipt = value as Partial<SourceReceipt>;
	if (receipt.schema !== 1 || receipt.repository !== REPOSITORY_ID || !receipt.tag) {
		throw new Error(`unsafe archive: invalid release receipt`);
	}
	assertCanonicalKeys(receipt.tag, ['name', 'object', 'peeledCommit'], 'release tag receipt');
	assertTag(receipt.tag.name);
	assertCommit(receipt.tag.object);
	assertCommit(receipt.tag.peeledCommit);
	if (receipt.tag.name !== expectedTag) throw new Error(`unsafe archive: tag receipt mismatch`);
	return receipt as SourceReceipt;
}

function materializeEntries(
	entries: readonly TarEntry[],
	rootName: string,
	provenance: AdoptProvenance,
): AcquiredSource {
	const tempRoot = mkdtempSync(join(tmpdir(), 'yesid-adopt-archive-'));
	const source = join(tempRoot, rootName);
	try {
		for (const entry of entries) {
			const relative =
				entry.path === rootName ? '' : entry.path.slice(rootName.length + 1);
			const destination = join(source, ...relative.split('/'));
			if (entry.type === 'directory') mkdirSync(destination, { recursive: true });
			else {
				mkdirSync(dirname(destination), { recursive: true });
				writeFileSync(destination, entry.content, { flag: 'wx', mode: 0o644 });
			}
		}
		for (const required of [
			'LICENSE',
			'tools/adopt.ts',
			'tools/adopt',
			'packages',
		]) {
			if (!existsSync(join(source, required))) {
				throw new Error(`unsafe archive: missing required path ${required}`);
			}
		}
		return {
			source,
			provenance,
			cleanup() {
				rmSync(tempRoot, { recursive: true, force: true });
			},
		};
	} catch (error) {
		rmSync(tempRoot, { recursive: true, force: true });
		throw error;
	}
}

function materializeArchive(
	archive: Buffer,
	tag: string,
	mode: 'archive' | 'release',
	expectedIdentity?: TagIdentity,
): AcquiredSource {
	const entries = parseTar(archive, tag);
	const rootName = `yesid.dev-design-${tag}`;
	const receiptPath = `${rootName}/${RECEIPT_NAME}`;
	const receiptEntry = entries.find((entry) => entry.path === receiptPath && entry.type === 'file');
	if (!receiptEntry) throw new Error(`unsafe archive: missing ${RECEIPT_NAME}`);
	const receipt = parseReceipt(receiptEntry.content, tag);
	if (
		expectedIdentity &&
		(receipt.tag.object !== expectedIdentity.object ||
			receipt.tag.peeledCommit !== expectedIdentity.peeledCommit)
	) {
		throw new Error(`release provenance does not match embedded receipt`);
	}
	return materializeEntries(entries, rootName, { mode, tag: receipt.tag, asset: null });
}

export function acquireArchive(archiveInput: string, tag: string): AcquiredSource {
	assertTag(tag);
	const archivePath = resolve(archiveInput);
	if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
		throw new Error(`archive does not exist: ${archivePath}`);
	}
	const size = statSync(archivePath).size;
	if (size <= 0 || size > MAX_ARCHIVE_BYTES) throw new Error(`unsafe archive: invalid archive size`);
	return materializeArchive(readFileSync(archivePath), tag, 'archive');
}

function timeoutError(): Error {
	return new Error(`release acquisition timed out`);
}

async function beforeDeadline<T>(
	operation: Promise<T>,
	deadline: number,
	controller: AbortController,
): Promise<T> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) {
		controller.abort(timeoutError());
		throw timeoutError();
	}
	return new Promise<T>((resolveValue, rejectValue) => {
		const timer = setTimeout(() => {
			const error = timeoutError();
			rejectValue(error);
			controller.abort(error);
		}, remaining);
		operation.then(
			(value) => {
				clearTimeout(timer);
				resolveValue(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				rejectValue(error);
			},
		);
	});
}

async function fetchResponse(
	fetcher: typeof globalThis.fetch,
	url: string,
	headers: Record<string, string>,
	deadline: number,
	controller: AbortController,
): Promise<Response> {
	return beforeDeadline(
		fetcher(url, { headers, signal: controller.signal }),
		deadline,
		controller,
	);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	try {
		void reader.cancel().catch(() => undefined);
	} catch {
		// Cancellation is best-effort after the bounded operation has already failed.
	}
}

async function readBoundedBody(
	response: Response,
	capacity: number,
	deadline: number,
	controller: AbortController,
	limitMessage: string,
): Promise<Buffer> {
	const declaredLength = response.headers.get('content-length');
	if (declaredLength !== null) {
		if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > capacity) {
			throw new Error(limitMessage);
		}
	}
	if (!response.body) return Buffer.alloc(0);
	const destination = Buffer.allocUnsafe(capacity);
	const reader = response.body.getReader();
	let offset = 0;
	try {
		for (;;) {
			const { done, value } = await beforeDeadline(reader.read(), deadline, controller);
			if (done) break;
			if (!value) continue;
			if (value.byteLength > capacity - offset) {
				cancelReader(reader);
				throw new Error(limitMessage);
			}
			destination.set(value, offset);
			offset += value.byteLength;
		}
	} catch (error) {
		cancelReader(reader);
		throw error;
	}
	return destination.subarray(0, offset);
}

async function fetchJson(
	fetcher: typeof globalThis.fetch,
	path: string,
	deadline: number,
	controller: AbortController,
): Promise<unknown> {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	const response = await fetchResponse(
		fetcher,
		`${API_ROOT}${path}`,
		headers,
		deadline,
		controller,
	);
	if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}`);
	const content = await readBoundedBody(
		response,
		MAX_JSON_BYTES,
		deadline,
		controller,
		`GitHub API response exceeds size limit`,
	);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
	} catch (error) {
		throw new Error(`GitHub API ${path} returned invalid JSON`, { cause: error });
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`release provenance has invalid ${label}`);
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new Error(`release provenance has invalid ${label}`);
	return value;
}

async function downloadAsset(
	fetcher: typeof globalThis.fetch,
	assetId: number,
	expectedSize: number,
	deadline: number,
	controller: AbortController,
): Promise<Buffer> {
	const headers: Record<string, string> = {
		Accept: 'application/octet-stream',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	const response = await fetchResponse(
		fetcher,
		`${API_ROOT}/repos/${REPOSITORY_SLUG}/releases/assets/${assetId}`,
		headers,
		deadline,
		controller,
	);
	if (!response.ok || !response.body) throw new Error(`release asset download failed`);
	const archive = await readBoundedBody(
		response,
		expectedSize,
		deadline,
		controller,
		`release asset size mismatch`,
	);
	if (archive.byteLength !== expectedSize) throw new Error(`release asset size mismatch`);
	return archive;
}

export async function acquireRelease(
	tag: string,
	options: ReleaseAcquisitionOptions = {},
): Promise<AcquiredSource> {
	assertTag(tag);
	const fetcher = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`release acquisition timeout must be a positive integer`);
	}
	const deadline = Date.now() + timeoutMs;
	if (!Number.isSafeInteger(deadline)) {
		throw new Error(`release acquisition timeout is too large`);
	}
	const controller = new AbortController();
	const repository = record(
		await fetchJson(fetcher, `/repos/${REPOSITORY_SLUG}`, deadline, controller),
		'repository',
	);
	if (
		repository.id !== REPOSITORY_NUMERIC_ID ||
		repository.full_name !== REPOSITORY_SLUG ||
		repository.private !== false
	) {
		throw new Error(`release provenance repository identity mismatch`);
	}
	const release = record(
		await fetchJson(
			fetcher,
			`/repos/${REPOSITORY_SLUG}/releases/tags/${encodeURIComponent(tag)}`,
			deadline,
			controller,
		),
		'release',
	);
	if (release.tag_name !== tag || release.draft !== false || release.immutable !== true) {
		throw new Error(`release provenance requires an exact published immutable release`);
	}
	if (!Array.isArray(release.assets)) throw new Error(`release provenance has no assets`);
	const assetName = `yesid.dev-design-${tag}.tar`;
	const matchingAssets = release.assets
		.map((value) => record(value, 'asset'))
		.filter((asset) => asset.name === assetName);
	if (matchingAssets.length !== 1) {
		throw new Error(`release provenance requires exactly one ${assetName} asset`);
	}
	const asset = matchingAssets[0] as Record<string, unknown>;
	const assetId = asset.id;
	const assetSize = asset.size;
	const assetDigest = asset.digest;
	if (
		!Number.isSafeInteger(assetId) ||
		(assetId as number) <= 0 ||
		asset.state !== 'uploaded' ||
		!Number.isSafeInteger(assetSize) ||
		(assetSize as number) <= 0 ||
		(assetSize as number) > MAX_ARCHIVE_BYTES ||
		typeof assetDigest !== 'string' ||
		!/^sha256:[0-9a-f]{64}$/.test(assetDigest)
	) {
		throw new Error(`release provenance has invalid asset metadata`);
	}
	const ref = record(
		await fetchJson(
			fetcher,
			`/repos/${REPOSITORY_SLUG}/git/ref/tags/${encodeURIComponent(tag)}`,
			deadline,
			controller,
		),
		'tag ref',
	);
	const refObject = record(ref.object, 'tag ref object');
	if (ref.ref !== `refs/tags/${tag}` || refObject.type !== 'tag') {
		throw new Error(`release provenance requires an annotated tag`);
	}
	const tagObject = string(refObject.sha, 'tag object');
	assertCommit(tagObject);
	const annotatedTag = record(
		await fetchJson(
			fetcher,
			`/repos/${REPOSITORY_SLUG}/git/tags/${tagObject}`,
			deadline,
			controller,
		),
		'annotated tag',
	);
	const peeledObject = record(annotatedTag.object, 'peeled tag object');
	if (annotatedTag.tag !== tag || peeledObject.type !== 'commit') {
		throw new Error(`release provenance annotated tag mismatch`);
	}
	const peeledCommit = string(peeledObject.sha, 'peeled commit');
	assertCommit(peeledCommit);
	const identity: TagIdentity = { name: tag, object: tagObject, peeledCommit };
	const archive = await downloadAsset(
		fetcher,
		assetId as number,
		assetSize as number,
		deadline,
		controller,
	);
	const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
	if (digest !== assetDigest) throw new Error(`release asset digest mismatch`);
	const acquired = materializeArchive(archive, tag, 'release', identity);
	acquired.provenance.asset = {
		name: assetName,
		size: assetSize as number,
		digest,
	};
	return acquired;
}
