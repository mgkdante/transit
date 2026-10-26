import { randomUUID } from 'node:crypto';
import {
	closeSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
	type BigIntStats,
	type Stats,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fullTreeHash, type AdoptManifest } from './contract.js';
import {
	PathIdentityChangedError,
	guardDestinationPath,
	type DestinationPathGuard,
} from './path-safety.js';

export const ADOPT_EXIT = {
	OK: 0,
	INTERNAL: 1,
	USAGE: 2,
	PRECONDITION: 3,
	LOCKED: 4,
	CHECK_FAILED: 5,
	TRANSACTION_FAILED: 6,
	RECOVERY_REQUIRED: 7,
} as const;

export type AdoptExitCode = (typeof ADOPT_EXIT)[keyof typeof ADOPT_EXIT];

export class AdoptError extends Error {
	constructor(
		readonly code: AdoptExitCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = 'AdoptError';
	}
}

class CleanupPendingError extends AdoptError {
	constructor(message: string, options?: ErrorOptions) {
		super(ADOPT_EXIT.RECOVERY_REQUIRED, message, options);
		this.name = 'CleanupPendingError';
	}
}

export type AdoptCheckpoint =
	| 'lock.reclaim.guard.acquired'
	| 'lock.acquired'
	| 'recovery.checked'
	| 'stage.durable'
	| 'stage.ready'
	| 'noop'
	| 'backup.durable'
	| 'destination.installed'
	| 'postverify.passed'
	| 'commit.durable'
	| 'tombstone.cleanup'
	| 'tombstone.removed'
	| 'recovery.finalize'
	| 'rollback.started';

export interface AdoptTransactionPaths {
	dest: string;
	lock: string;
	reclaim: string;
	backup: string;
	tombstone: string;
	stage: string;
	recovery: string;
	cleanup: string;
}

export interface AdoptRuntime {
	checkpoint?(point: AdoptCheckpoint, paths: Readonly<AdoptTransactionPaths>): void;
}

export interface AdoptResult {
	outcome: 'installed' | 'noop';
	manifest: AdoptManifest;
}

interface LockOwner {
	schema: 1;
	token: string;
	pid: number;
	hostname: string;
	dest: string;
	startedAt: string;
}

interface LockAcquisition {
	reclaimedOwners: LockOwner[];
	lockIdentity: EntryIdentity;
}

interface InstallOptions {
	dest: string;
	build(stage: string): AdoptManifest;
	inspect(path: string): AdoptManifest;
	recognize(path: string): boolean;
	destinationGuard?: DestinationPathGuard;
	assertSourceStable?(): void;
}

function entryStats(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function pathExists(path: string): boolean {
	return entryStats(path) !== null;
}

function assertArtifactNotLink(path: string, label: string): Stats | null {
	const stats = entryStats(path);
	if (stats?.isSymbolicLink()) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`${label}: refusing symbolic link at ${path}`,
		);
	}
	return stats;
}

interface EntryIdentity {
	dev: string;
	ino: string;
	mode: string;
	kind: 'file' | 'directory';
}

interface RecoveryEvidence {
	schema: 1;
	token: string;
	dest: string;
	previous: null | { identity: EntryIdentity; treeHash: string };
	staged: { identity: EntryIdentity };
}

function entryKind(stats: Stats | BigIntStats): EntryIdentity['kind'] | null {
	if (stats.isFile()) return 'file';
	if (stats.isDirectory()) return 'directory';
	return null;
}

function identityFromStats(stats: BigIntStats, kind: EntryIdentity['kind']): EntryIdentity {
	return {
		dev: stats.dev.toString(),
		ino: stats.ino.toString(),
		mode: stats.mode.toString(),
		kind,
	};
}

function entryIdentity(
	path: string,
	label: string,
	expectedKind?: EntryIdentity['kind'],
): EntryIdentity {
	let stats: BigIntStats;
	try {
		stats = lstatSync(path, { bigint: true });
	} catch (error) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `${label} is missing at ${path}`, {
			cause: error,
		});
	}
	if (stats.isSymbolicLink()) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `${label}: refusing symbolic link at ${path}`);
	}
	const kind = entryKind(stats);
	if (!kind || (expectedKind && kind !== expectedKind)) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`${label} is not an owned ${expectedKind ?? 'regular entry'} at ${path}`,
		);
	}
	return identityFromStats(stats, kind);
}

function sameEntryIdentity(left: EntryIdentity, right: EntryIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
		left.kind === right.kind;
}

function assertEntryIdentity(
	path: string,
	label: string,
	expected: EntryIdentity,
): void {
	const actual = entryIdentity(path, label, expected.kind);
	if (!sameEntryIdentity(actual, expected)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `${label} identity changed at ${path}`);
	}
}

function syncDirectory(path: string): void {
	if (process.platform === 'win32') return;
	const descriptor = openSync(path, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function syncFile(path: string): void {
	const descriptor = openSync(path, process.platform === 'win32' ? 'r+' : 'r');
	try {
		try {
			fsyncSync(descriptor);
		} catch (error) {
			if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') {
				throw error;
			}
		}
	} finally {
		closeSync(descriptor);
	}
}

function syncTree(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) throw new Error(`refusing to sync symbolic link ${path}`);
	if (stat.isFile()) {
		syncFile(path);
		return;
	}
	if (!stat.isDirectory()) throw new Error(`refusing to sync non-regular entry ${path}`);
	for (const entry of readdirSync(path)) syncTree(join(path, entry));
	syncDirectory(path);
}

function writeDurably(path: string, content: string): void {
	const descriptor = openSync(path, 'wx', 0o600);
	try {
		writeFileSync(descriptor, content, 'utf8');
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function transactionPaths(destInput: string, token: string): AdoptTransactionPaths {
	const dest = resolve(destInput);
	const parent = dirname(dest);
	const prefix = `.${basename(dest)}.yesid-adopt`;
	return {
		dest,
		lock: join(parent, `${prefix}.lock`),
		reclaim: join(parent, `${prefix}.lock.reclaim`),
		backup: join(parent, `${prefix}.backup`),
		tombstone: join(parent, `${prefix}.tombstone-${token}`),
		stage: join(parent, `${prefix}.stage-${token}`),
		recovery: join(parent, `${prefix}.recovery-${token}.json`),
		cleanup: join(parent, `${prefix}.cleanup-${token}.json`),
	};
}

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parseLock(path: string): LockOwner {
	const identity = entryIdentity(path, 'adoption lock', 'file');
	const stats = lstatSync(path);
	if (stats.size <= 0 || stats.size > 4096) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption lock at ${path}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption lock at ${path}`, {
			cause: error,
		});
	}
	assertEntryIdentity(path, 'adoption lock', identity);
	if (!value || typeof value !== 'object') {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption lock at ${path}`);
	}
	const owner = value as Partial<LockOwner>;
	if (
		owner.schema !== 1 ||
		typeof owner.token !== 'string' ||
		!TOKEN.test(owner.token) ||
		!Number.isSafeInteger(owner.pid) ||
		(owner.pid ?? 0) <= 0 ||
		typeof owner.hostname !== 'string' ||
		typeof owner.dest !== 'string' ||
		typeof owner.startedAt !== 'string'
	) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption lock at ${path}`);
	}
	return owner as LockOwner;
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ESRCH') return false;
		if (code === 'EPERM') return true;
		throw error;
	}
}

function createLockCandidate(path: string, owner: LockOwner): void {
	writeDurably(path, `${JSON.stringify(owner)}\n`);
}

function assertLockDestination(owner: LockOwner, paths: AdoptTransactionPaths, path: string): void {
	if (owner.dest !== paths.dest) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`adoption lock destination mismatch at ${path}`,
		);
	}
}

function lockIsActive(owner: LockOwner): boolean {
	return owner.hostname !== hostname() || processIsAlive(owner.pid);
}

function parseReclaimGuard(path: string): LockOwner {
	if (!lstatSync(path).isFile()) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed reclaim guard at ${path}`);
	}
	return parseLock(path);
}

function staleReclaimArtifacts(paths: AdoptTransactionPaths): string[] {
	const prefix = `${basename(paths.reclaim)}.stale-`;
	return readdirSync(dirname(paths.reclaim))
		.filter((entry) => entry.startsWith(prefix) && TOKEN.test(entry.slice(prefix.length)))
		.map((entry) => {
			const path = join(dirname(paths.reclaim), entry);
			entryIdentity(path, 'stale adoption reclaim guard', 'file');
			return path;
		});
}

function acquireReclaimGuard(
	paths: AdoptTransactionPaths,
	owner: LockOwner,
	candidate: string,
): EntryIdentity {
	const preexistingStale = staleReclaimArtifacts(paths);
	if (preexistingStale.length > 0) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`stale reclaim guard requires manual recovery at ${preexistingStale[0]}`,
		);
	}
	const retired: Array<{ path: string; identity: EntryIdentity }> = [];
	for (;;) {
		try {
			linkSync(candidate, paths.reclaim);
			syncDirectory(dirname(paths.reclaim));
			const acquired = entryIdentity(paths.reclaim, 'adoption reclaim guard', 'file');
			try {
				for (const stale of retired) {
					removeOwnedEntry(stale.path, 'retired reclaim guard', stale.identity, false);
				}
				if (retired.length > 0) syncDirectory(dirname(paths.reclaim));
			} catch (error) {
				assertEntryIdentity(paths.reclaim, 'adoption reclaim guard', acquired);
				unlinkSync(paths.reclaim);
				syncDirectory(dirname(paths.reclaim));
				throw error;
			}
			return acquired;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}

		const currentIdentity = entryIdentity(paths.reclaim, 'adoption reclaim guard', 'file');
		const current = parseReclaimGuard(paths.reclaim);
		assertEntryIdentity(paths.reclaim, 'adoption reclaim guard', currentIdentity);
		assertLockDestination(current, paths, paths.reclaim);
		if (lockIsActive(current)) {
			throw new AdoptError(
				ADOPT_EXIT.LOCKED,
				`adoption lock reclamation is already running for ${paths.dest}`,
			);
		}

		const stale = `${paths.reclaim}.stale-${current.token}`;
		if (pathExists(stale)) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`stale reclaim guard requires manual recovery at ${stale}`,
			);
		}
		try {
			renameOwnedEntry(paths.reclaim, stale, 'adoption reclaim guard', currentIdentity);
			retired.push({ path: stale, identity: currentIdentity });
			syncDirectory(dirname(paths.reclaim));
		} catch (moveError) {
			if (!pathExists(paths.reclaim)) continue;
			const latest = parseReclaimGuard(paths.reclaim);
			assertLockDestination(latest, paths, paths.reclaim);
			if (lockIsActive(latest)) {
				throw new AdoptError(
					ADOPT_EXIT.LOCKED,
					`adoption lock reclamation is already running for ${paths.dest}`,
				);
			}
			throw moveError;
		}
	}
}

function releaseReclaimGuard(
	paths: AdoptTransactionPaths,
	token: string,
	expected: EntryIdentity,
): void {
	if (!pathExists(paths.reclaim)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption reclaim guard is missing`);
	}
	assertEntryIdentity(paths.reclaim, 'adoption reclaim guard', expected);
	const owner = parseReclaimGuard(paths.reclaim);
	if (owner.token !== token) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`reclaim guard ownership changed at ${paths.reclaim}`,
		);
	}
	assertEntryIdentity(paths.reclaim, 'adoption reclaim guard', expected);
	unlinkSync(paths.reclaim);
	syncDirectory(dirname(paths.reclaim));
}

function acquireLock(
	paths: AdoptTransactionPaths,
	token: string,
	runtime: AdoptRuntime,
	assertParentStable: () => void,
): LockAcquisition {
	const candidate = `${paths.lock}.candidate-${token}`;
	const owner: LockOwner = {
		schema: 1,
		token,
		pid: process.pid,
		hostname: hostname(),
		dest: paths.dest,
		startedAt: new Date().toISOString(),
	};
	assertParentStable();
	createLockCandidate(candidate, owner);
	const candidateIdentity = entryIdentity(candidate, 'adoption lock candidate', 'file');
	assertParentStable();
	let guardAcquired = false;
	let reclaimIdentity: EntryIdentity | null = null;
	let lockAcquired = false;
	let createdLockIdentity: EntryIdentity | null = null;
	let parentUnsafe = false;
	try {
		reclaimIdentity = acquireReclaimGuard(paths, owner, candidate);
		guardAcquired = true;
		runtime.checkpoint?.('lock.reclaim.guard.acquired', paths);
		assertParentStable();
		assertEntryIdentity(paths.reclaim, 'adoption reclaim guard', reclaimIdentity);
		assertEntryIdentity(candidate, 'adoption lock candidate', candidateIdentity);
		const reclaimedOwners: LockOwner[] = [];
		if (pathExists(paths.lock)) {
			const currentIdentity = entryIdentity(paths.lock, 'adoption lock', 'file');
			const current = parseLock(paths.lock);
			assertEntryIdentity(paths.lock, 'adoption lock', currentIdentity);
			assertLockDestination(current, paths, paths.lock);
			const active = lockIsActive(current);
			assertEntryIdentity(paths.lock, 'adoption lock', currentIdentity);
			if (active) {
				throw new AdoptError(
					ADOPT_EXIT.LOCKED,
					`adoption is already running for ${paths.dest} (pid ${current.pid} on ${current.hostname})`,
				);
			}
			assertEntryIdentity(paths.lock, 'adoption lock', currentIdentity);
			unlinkSync(paths.lock);
			syncDirectory(dirname(paths.lock));
			reclaimedOwners.push(current);
		}
		assertEntryIdentity(candidate, 'adoption lock candidate', candidateIdentity);
		linkSync(candidate, paths.lock);
		lockAcquired = true;
		const lockIdentity = entryIdentity(paths.lock, 'adoption lock', 'file');
		createdLockIdentity = lockIdentity;
		if (!sameEntryIdentity(lockIdentity, candidateIdentity)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption lock identity changed`);
		}
		unlinkSync(candidate);
		syncDirectory(dirname(paths.lock));
		return { reclaimedOwners, lockIdentity };
	} catch (error) {
		if (error instanceof PathIdentityChangedError && !error.cleanupSafe) parentUnsafe = true;
		throw error;
	} finally {
		if (!parentUnsafe && pathExists(candidate)) {
			assertEntryIdentity(candidate, 'adoption lock candidate', candidateIdentity);
			unlinkSync(candidate);
		}
		if (!parentUnsafe && guardAcquired) {
			try {
				if (!reclaimIdentity) {
					throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `reclaim guard identity is unavailable`);
				}
				releaseReclaimGuard(paths, token, reclaimIdentity);
			} catch (error) {
				if (lockAcquired && createdLockIdentity) {
					releaseLock(paths.lock, token, createdLockIdentity);
				}
				throw error;
			}
		}
	}
}

function releaseLock(path: string, token: string, expected?: EntryIdentity): void {
	if (!pathExists(path)) {
		if (expected) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption lock is missing at ${path}`);
		}
		return;
	}
	if (expected) assertEntryIdentity(path, 'adoption lock', expected);
	const owner = parseLock(path);
	if (owner.token !== token) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption lock ownership changed at ${path}`);
	}
	if (expected) assertEntryIdentity(path, 'adoption lock', expected);
	unlinkSync(path);
	syncDirectory(dirname(path));
}

function parseEntryIdentity(value: unknown, label: string): EntryIdentity {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed ${label}`);
	}
	const candidate = value as Partial<EntryIdentity>;
	if (
		!/^\d+$/u.test(candidate.dev ?? '') ||
		!/^\d+$/u.test(candidate.ino ?? '') ||
		!/^\d+$/u.test(candidate.mode ?? '') ||
		(candidate.kind !== 'file' && candidate.kind !== 'directory')
	) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed ${label}`);
	}
	return candidate as EntryIdentity;
}

function parseRecoveryEvidence(path: string, token: string, dest: string): {
	evidence: RecoveryEvidence;
	identity: EntryIdentity;
} {
	const identity = entryIdentity(path, 'adoption recovery evidence', 'file');
	const stats = lstatSync(path);
	if (stats.size <= 0 || stats.size > 4096) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
	}
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`malformed adoption recovery evidence at ${path}`,
			{ cause: error },
		);
	}
	assertEntryIdentity(path, 'adoption recovery evidence', identity);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
	}
	const candidate = value as {
		schema?: unknown;
		token?: unknown;
		dest?: unknown;
		previous?: unknown;
		staged?: unknown;
	};
	if (
		candidate.schema !== 1 ||
		candidate.token !== token ||
		candidate.dest !== dest
	) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
	}
	let previous: RecoveryEvidence['previous'] = null;
	if (candidate.previous !== null) {
		if (!candidate.previous || typeof candidate.previous !== 'object' || Array.isArray(candidate.previous)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
		}
		const record = candidate.previous as { identity?: unknown; treeHash?: unknown };
		if (typeof record.treeHash !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.treeHash)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
		}
		previous = {
			identity: parseEntryIdentity(record.identity, 'adoption recovery previous identity'),
			treeHash: record.treeHash,
		};
	}
	if (!candidate.staged || typeof candidate.staged !== 'object' || Array.isArray(candidate.staged)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption recovery evidence at ${path}`);
	}
	const stagedRecord = candidate.staged as { identity?: unknown };
	const evidence: RecoveryEvidence = {
		schema: 1,
		token,
		dest,
		previous,
		staged: { identity: parseEntryIdentity(stagedRecord.identity, 'adoption recovery stage identity') },
	};
	return { evidence, identity };
}

function writeRecoveryEvidence(path: string, evidence: RecoveryEvidence): EntryIdentity {
	writeDurably(path, `${JSON.stringify(evidence)}\n`);
	syncDirectory(dirname(path));
	return entryIdentity(path, 'adoption recovery evidence', 'file');
}

function authorizeRecoveryCleanup(
	paths: AdoptTransactionPaths,
	expected: EntryIdentity,
): EntryIdentity {
	renameOwnedEntry(
		paths.recovery,
		paths.cleanup,
		'adoption recovery evidence',
		expected,
	);
	syncDirectory(dirname(paths.dest));
	return expected;
}

function removeOwnedEntry(
	path: string,
	label: string,
	expected: EntryIdentity,
	recursive: boolean,
): void {
	assertEntryIdentity(path, label, expected);
	if (recursive) rmSync(path, { recursive: true });
	else unlinkSync(path);
}

function renameOwnedEntry(
	from: string,
	to: string,
	label: string,
	expected: EntryIdentity,
): void {
	assertEntryIdentity(from, label, expected);
	if (pathExists(to)) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `${label} destination already exists at ${to}`);
	}
	renameSync(from, to);
	assertEntryIdentity(to, label, expected);
}

function guardedCall<T>(assertStable: () => void, operation: () => T): T {
	assertStable();
	try {
		return operation();
	} finally {
		assertStable();
	}
}

function isEmptyDirectory(path: string): boolean {
	const stats = assertArtifactNotLink(path, 'adoption path');
	return stats?.isDirectory() === true && readdirSync(path).length === 0;
}

function isRecognized(path: string, recognize: (path: string) => boolean): boolean {
	return isEmptyDirectory(path) || recognize(path);
}

function removeStaleStages(
	paths: AdoptTransactionPaths,
	reclaimedTokens: readonly string[],
	assertStable: () => void,
): void {
	for (const token of new Set(reclaimedTokens)) {
		const path = transactionPaths(paths.dest, token).stage;
		if (!pathExists(path)) continue;
		assertStable();
		entryIdentity(path, 'stale transaction stage', 'directory');
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`evidence-less stale transaction stage requires manual recovery at ${path}`,
		);
	}
}

function tombstones(paths: AdoptTransactionPaths): string[] {
	const parent = dirname(paths.dest);
	const prefix = `.${basename(paths.dest)}.yesid-adopt.tombstone-`;
	return readdirSync(parent)
		.filter((entry) => entry.startsWith(prefix) && TOKEN.test(entry.slice(prefix.length)))
		.map((entry) => {
			const path = join(parent, entry);
			assertArtifactNotLink(path, 'adoption tombstone');
			return path;
		});
}

function recoveryEvidenceFiles(paths: AdoptTransactionPaths): string[] {
	const parent = dirname(paths.dest);
	const prefix = `.${basename(paths.dest)}.yesid-adopt.recovery-`;
	return readdirSync(parent)
		.filter(
			(entry) =>
				entry.startsWith(prefix) &&
				entry.endsWith('.json') &&
				TOKEN.test(entry.slice(prefix.length, -'.json'.length)),
		)
		.map((entry) => {
			const path = join(parent, entry);
			entryIdentity(path, 'adoption recovery evidence', 'file');
			return path;
		});
}

function cleanupEvidenceFiles(paths: AdoptTransactionPaths): string[] {
	const parent = dirname(paths.dest);
	const prefix = `.${basename(paths.dest)}.yesid-adopt.cleanup-`;
	return readdirSync(parent)
		.filter(
			(entry) =>
				entry.startsWith(prefix) &&
				entry.endsWith('.json') &&
				TOKEN.test(entry.slice(prefix.length, -'.json'.length)),
		)
		.map((entry) => {
			const path = join(parent, entry);
			entryIdentity(path, 'adoption cleanup evidence', 'file');
			return path;
		});
}

function tokenFromEvidencePath(path: string): string {
	const match = basename(path).match(/\.(?:recovery|cleanup)-([0-9a-f-]{36})\.json$/u);
	if (!match?.[1] || !TOKEN.test(match[1])) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `invalid adoption evidence path ${path}`);
	}
	return match[1];
}

function cleanupTombstone(
	paths: AdoptTransactionPaths,
	tombstone: string,
	expected: EntryIdentity,
	runtime: AdoptRuntime,
	assertStable: () => void,
	markRemoved?: () => void,
): boolean {
	try {
		guardedCall(
			() => {
				assertStable();
				assertEntryIdentity(tombstone, 'adoption tombstone', expected);
			},
			() => runtime.checkpoint?.('tombstone.cleanup', { ...paths, tombstone }),
		);
		assertStable();
		removeOwnedEntry(tombstone, 'adoption tombstone', expected, true);
		markRemoved?.();
		syncDirectory(dirname(paths.dest));
		guardedCall(assertStable, () =>
			runtime.checkpoint?.('tombstone.removed', { ...paths, tombstone }),
		);
		return true;
	} catch (error) {
		if (
			error instanceof PathIdentityChangedError ||
			(error instanceof AdoptError && error.code === ADOPT_EXIT.RECOVERY_REQUIRED)
		) {
			throw error;
		}
		// A committed destination does not depend on retired backup cleanup.
		return false;
	}
}

function assertNoUnpairedTombstones(paths: AdoptTransactionPaths): void {
	const found = tombstones(paths);
	if (found.length === 0) return;
	throw new AdoptError(
		ADOPT_EXIT.RECOVERY_REQUIRED,
		`unpaired adoption tombstone requires manual recovery at ${found[0]}`,
	);
}

function recoverLegacy(
	paths: AdoptTransactionPaths,
	destinationGuard: DestinationPathGuard,
	inspect: (path: string) => AdoptManifest,
	recognize: (path: string) => boolean,
	reclaimedTokens: readonly string[],
	runtime: AdoptRuntime,
): void {
	const assertDestinationStable = (): void => {
		destinationGuard.assertParentStable();
		destinationGuard.assertLeafStable();
	};
	assertDestinationStable();
	const backup = assertArtifactNotLink(paths.backup, 'adoption backup');
	if (backup) {
		if (reclaimedTokens.length === 0) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`durable backup has no matching reclaimed lock at ${paths.backup}`,
			);
		}
		const backupIdentity = entryIdentity(paths.backup, 'adoption backup', 'directory');
		const assertStable = (): void => {
			assertDestinationStable();
			assertEntryIdentity(paths.backup, 'adoption backup', backupIdentity);
		};
		if (!guardedCall(assertStable, () => isRecognized(paths.backup, recognize))) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`unrecognized durable backup at ${paths.backup}`,
			);
		}
		const backupFingerprint = guardedCall(assertStable, () => fullTreeHash(paths.backup));
		if (!pathExists(paths.dest)) {
			assertStable();
			renameOwnedEntry(paths.backup, paths.dest, 'adoption backup', backupIdentity);
			destinationGuard.markLeafCurrent();
			syncDirectory(dirname(paths.dest));
			if (fullTreeHash(paths.dest) !== backupFingerprint) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `restored backup verification failed`);
			}
		} else {
			let currentIsValid = false;
			try {
				guardedCall(assertDestinationStable, () => inspect(paths.dest));
				currentIsValid = true;
			} catch {
				currentIsValid = false;
			}
			if (currentIsValid) {
				if (pathExists(paths.tombstone)) {
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`recovery tombstone collision at ${paths.tombstone}`,
					);
				}
				try {
					assertStable();
					renameOwnedEntry(
						paths.backup,
						paths.tombstone,
						'adoption backup',
						backupIdentity,
					);
					syncDirectory(dirname(paths.dest));
				} catch (error) {
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`could not durably retire recovered backup at ${paths.backup}`,
						{ cause: error },
					);
				}
				if (
					!cleanupTombstone(
						paths,
						paths.tombstone,
						backupIdentity,
						runtime,
						assertDestinationStable,
					)
				) {
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`legacy adoption tombstone cleanup requires retry at ${paths.tombstone}`,
					);
				}
			} else if (guardedCall(assertStable, () => isRecognized(paths.dest, recognize))) {
				assertStable();
				const destinationIdentity = entryIdentity(paths.dest, 'adoption destination', 'directory');
				removeOwnedEntry(paths.dest, 'adoption destination', destinationIdentity, true);
				destinationGuard.markLeafMissing();
				renameOwnedEntry(paths.backup, paths.dest, 'adoption backup', backupIdentity);
				destinationGuard.markLeafCurrent();
				syncDirectory(dirname(paths.dest));
				if (fullTreeHash(paths.dest) !== backupFingerprint) {
					throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `restored backup verification failed`);
				}
			} else {
				throw new AdoptError(
					ADOPT_EXIT.RECOVERY_REQUIRED,
					`destination and durable backup require manual recovery`,
				);
			}
		}
	}
	assertNoUnpairedTombstones(paths);
	removeStaleStages(paths, reclaimedTokens, assertDestinationStable);
	const evidence = recoveryEvidenceFiles(paths);
	if (evidence.length > 0) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`unpaired adoption recovery evidence requires manual recovery at ${evidence[0]}`,
		);
	}
}

interface RecoveryOutcome {
	pendingToken?: string;
}

function identityMatchesAt(path: string, expected: EntryIdentity): boolean {
	if (!pathExists(path)) return false;
	return sameEntryIdentity(entryIdentity(path, 'adoption recovery artifact'), expected);
}

function recoverFromEvidence(
	paths: AdoptTransactionPaths,
	token: string,
	cleanupAuthorized: boolean,
	destinationGuard: DestinationPathGuard,
	inspect: (path: string) => AdoptManifest,
	runtime: AdoptRuntime,
): RecoveryOutcome {
	let evidencePath = cleanupAuthorized ? paths.cleanup : paths.recovery;
	const parsed = parseRecoveryEvidence(evidencePath, token, paths.dest);
	const { evidence } = parsed;
	let evidenceIdentity = parsed.identity;
	const previous = evidence.previous;
	const stagedIdentity = evidence.staged.identity;
	const destinationHasPrevious = previous
		? identityMatchesAt(paths.dest, previous.identity)
		: false;
	const destinationHasStaged = identityMatchesAt(paths.dest, stagedIdentity);
	const backupHasPrevious = previous
		? identityMatchesAt(paths.backup, previous.identity)
		: false;
	const tombstoneHasPrevious = previous
		? identityMatchesAt(paths.tombstone, previous.identity)
		: false;
	const stageHasStaged = identityMatchesAt(paths.stage, stagedIdentity);

	const assertEvidence = (): void => {
		destinationGuard.assertParentStable();
		destinationGuard.assertLeafStable();
		assertEntryIdentity(evidencePath, 'adoption recovery evidence', evidenceIdentity);
	};
	const assertPreviousHash = (path: string): void => {
		if (!previous) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption recovery has no previous tree`);
		}
		assertEntryIdentity(path, 'adoption recovery previous tree', previous.identity);
		const actual = fullTreeHash(path);
		assertEntryIdentity(path, 'adoption recovery previous tree', previous.identity);
		if (actual !== previous.treeHash) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`adoption recovery previous tree identity changed at ${path}`,
			);
		}
	};
	const removeEvidence = (): void => {
		assertEvidence();
		removeOwnedEntry(evidencePath, 'adoption recovery evidence', evidenceIdentity, false);
		syncDirectory(dirname(paths.dest));
	};
	const removeStage = (): void => {
		assertEvidence();
		removeOwnedEntry(paths.stage, 'adoption stage', stagedIdentity, true);
		syncDirectory(dirname(paths.dest));
	};

	if (
		!cleanupAuthorized &&
		previous &&
		destinationHasPrevious &&
		!destinationHasStaged &&
		!pathExists(paths.backup) &&
		!pathExists(paths.tombstone)
	) {
		assertPreviousHash(paths.dest);
		if (stageHasStaged) removeStage();
		else if (pathExists(paths.stage)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption stage identity changed`);
		}
		removeEvidence();
		return {};
	}

	if (
		!cleanupAuthorized &&
		previous &&
		backupHasPrevious &&
		stageHasStaged &&
		!pathExists(paths.dest) &&
		!pathExists(paths.tombstone)
	) {
		assertEvidence();
		assertPreviousHash(paths.backup);
		renameOwnedEntry(paths.backup, paths.dest, 'adoption backup', previous.identity);
		destinationGuard.markLeafCurrent();
		syncDirectory(dirname(paths.dest));
		assertPreviousHash(paths.dest);
		removeStage();
		removeEvidence();
		return {};
	}

	if (
		!cleanupAuthorized &&
		!previous &&
		!pathExists(paths.dest) &&
		stageHasStaged &&
		!pathExists(paths.backup) &&
		!pathExists(paths.tombstone)
	) {
		removeStage();
		removeEvidence();
		return {};
	}

	if (destinationHasStaged && !pathExists(paths.stage)) {
		const assertInstalled = (): void => {
			assertEvidence();
			assertEntryIdentity(paths.dest, 'adoption destination', stagedIdentity);
		};
		guardedCall(assertInstalled, () => inspect(paths.dest));
		let cleanupPath: string | null = null;
		if (
			!previous &&
			(cleanupAuthorized || pathExists(paths.backup) || pathExists(paths.tombstone))
		) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption recovery topology is ambiguous`);
		}
		if (previous && backupHasPrevious && !pathExists(paths.tombstone)) {
			if (cleanupAuthorized) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption recovery phase is ambiguous`);
			}
			assertPreviousHash(paths.backup);
			assertInstalled();
			renameOwnedEntry(paths.backup, paths.tombstone, 'adoption backup', previous.identity);
			syncDirectory(dirname(paths.dest));
			cleanupPath = paths.tombstone;
		} else if (previous && tombstoneHasPrevious && !pathExists(paths.backup)) {
			if (!cleanupAuthorized) assertPreviousHash(paths.tombstone);
			else assertEntryIdentity(paths.tombstone, 'adoption tombstone', previous.identity);
			cleanupPath = paths.tombstone;
		} else if (previous) {
			if (
				!cleanupAuthorized ||
				pathExists(paths.backup) ||
				pathExists(paths.tombstone)
			) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption recovery topology is ambiguous`);
			}
		}
		if (cleanupPath && previous) {
			if (!cleanupAuthorized) {
				evidenceIdentity = authorizeRecoveryCleanup(paths, evidenceIdentity);
				evidencePath = paths.cleanup;
				cleanupAuthorized = true;
			}
			const removed = cleanupTombstone(
				paths,
				cleanupPath,
				previous.identity,
				runtime,
				assertInstalled,
			);
			if (!removed) {
				return { pendingToken: evidence.token };
			}
		}
		removeEvidence();
		return {};
	}

	throw new AdoptError(
		ADOPT_EXIT.RECOVERY_REQUIRED,
		`adoption recovery evidence does not match filesystem state at ${evidencePath}`,
	);
}

function recover(
	paths: AdoptTransactionPaths,
	destinationGuard: DestinationPathGuard,
	inspect: (path: string) => AdoptManifest,
	recognize: (path: string) => boolean,
	acquisition: LockAcquisition,
	runtime: AdoptRuntime,
): RecoveryOutcome {
	const owners = new Map(acquisition.reclaimedOwners.map((owner) => [owner.token, owner]));
	const evidence = new Map<string, boolean>();
	for (const path of recoveryEvidenceFiles(paths)) evidence.set(tokenFromEvidencePath(path), false);
	for (const path of cleanupEvidenceFiles(paths)) {
		const token = tokenFromEvidencePath(path);
		if (evidence.has(token)) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`adoption has both recovery and cleanup evidence for token ${token}`,
			);
		}
		evidence.set(token, true);
	}
	if (evidence.size === 1) {
		for (const token of owners.keys()) {
			if (evidence.has(token)) continue;
			const attempted = transactionPaths(paths.dest, token);
			if (
				!pathExists(attempted.stage) &&
				!pathExists(attempted.tombstone) &&
				!pathExists(attempted.recovery) &&
				!pathExists(attempted.cleanup)
			) {
				owners.delete(token);
			}
		}
	}
	const tokens = new Set([...owners.keys(), ...evidence.keys()]);
	if (tokens.size > 1) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`multiple adoption recovery tokens require manual recovery for ${paths.dest}`,
		);
	}
	for (const token of tokens) {
		const recoveredPaths = transactionPaths(paths.dest, token);
		const cleanupAuthorized = evidence.get(token);
		if (cleanupAuthorized !== undefined) {
			const outcome = recoverFromEvidence(
				recoveredPaths,
				token,
				cleanupAuthorized,
				destinationGuard,
				inspect,
				runtime,
			);
			if (outcome.pendingToken) return outcome;
		} else if (owners.has(token)) {
			recoverLegacy(
				recoveredPaths,
				destinationGuard,
				inspect,
				recognize,
				[token],
				runtime,
			);
		}
	}
	recoverLegacy(paths, destinationGuard, inspect, recognize, [], runtime);
	const unmatchedEvidence = recoveryEvidenceFiles(paths);
	if (unmatchedEvidence.length > 0) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`unpaired adoption recovery evidence requires manual recovery at ${unmatchedEvidence[0]}`,
		);
	}
	const unmatchedCleanup = cleanupEvidenceFiles(paths);
	if (unmatchedCleanup.length > 0) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`unpaired adoption cleanup evidence requires manual recovery at ${unmatchedCleanup[0]}`,
		);
	}
	const unmatchedTombstones = tombstones(paths);
	if (unmatchedTombstones.length > 0) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`unpaired adoption tombstone requires manual recovery at ${unmatchedTombstones[0]}`,
		);
	}
	return {};
}

function verifiedManifest(
	path: string,
	expected: AdoptManifest,
	inspect: (path: string) => AdoptManifest,
): AdoptManifest {
	const actual = inspect(path);
	if (!isDeepStrictEqual(actual, expected)) {
		throw new Error(`installed manifest differs from staged manifest`);
	}
	return actual;
}

interface TransactionIdentities {
	lock?: EntryIdentity;
	stage?: EntryIdentity;
	backup?: EntryIdentity;
	tombstone?: EntryIdentity;
	recovery?: EntryIdentity;
	cleanup?: EntryIdentity;
}

function assertTransactionArtifacts(
	paths: AdoptTransactionPaths,
	identities: TransactionIdentities = {},
	requireMissing = false,
): void {
	for (const [key, path, label] of [
		['lock', paths.lock, 'adoption lock'],
		['reclaim', paths.reclaim, 'adoption reclaim guard'],
		['backup', paths.backup, 'adoption backup'],
		['tombstone', paths.tombstone, 'adoption tombstone'],
		['stage', paths.stage, 'adoption stage'],
		['recovery', paths.recovery, 'adoption recovery evidence'],
		['cleanup', paths.cleanup, 'adoption cleanup evidence'],
	] as const) {
		const expected = identities[key as keyof TransactionIdentities];
		if (expected) assertEntryIdentity(path, label, expected);
		else if (requireMissing && pathExists(path)) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`${label} unexpectedly exists at ${path}`,
			);
		} else assertArtifactNotLink(path, label);
	}
}

function rollback(
	paths: AdoptTransactionPaths,
	oldExists: boolean,
	oldFingerprint: string | null,
	installed: boolean,
	runtime: AdoptRuntime,
	destinationGuard: DestinationPathGuard,
	identities: Required<Pick<TransactionIdentities, 'lock'>> & TransactionIdentities,
	installedIdentity: EntryIdentity | null,
): void {
	guardedCall(
		() => {
			destinationGuard.assertParentStable();
			assertTransactionArtifacts(paths, identities, true);
		},
		() => runtime.checkpoint?.('rollback.started', paths),
	);
	destinationGuard.assertParentStable();
	destinationGuard.assertLeafStable();
	if (installed && pathExists(paths.dest)) {
		if (!installedIdentity) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `installed adoption identity is unavailable`);
		}
		removeOwnedEntry(paths.dest, 'installed adoption destination', installedIdentity, true);
		destinationGuard.markLeafMissing();
	}
	if (pathExists(paths.backup) && pathExists(paths.tombstone)) {
		throw new Error(`rollback found both a backup and tombstone`);
	}
	const restore = pathExists(paths.backup)
		? { path: paths.backup, identity: identities.backup }
		: pathExists(paths.tombstone)
			? { path: paths.tombstone, identity: identities.tombstone }
			: null;
	if (restore) {
		if (!restore.identity) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption backup identity is unavailable`);
		}
		if (pathExists(paths.dest)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `rollback destination unexpectedly exists`);
		}
		renameOwnedEntry(restore.path, paths.dest, 'adoption backup', restore.identity);
		destinationGuard.markLeafCurrent();
	}
	if (pathExists(paths.stage)) {
		if (!identities.stage) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption stage identity is unavailable`);
		}
		removeOwnedEntry(paths.stage, 'adoption stage', identities.stage, true);
	}
	if (pathExists(paths.recovery)) {
		if (!identities.recovery) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `recovery evidence identity is unavailable`);
		}
		removeOwnedEntry(paths.recovery, 'adoption recovery evidence', identities.recovery, false);
	}
	syncDirectory(dirname(paths.dest));
	if (oldExists) {
		if (!pathExists(paths.dest) || fullTreeHash(paths.dest) !== oldFingerprint) {
			throw new Error(`rollback did not restore the previous destination`);
		}
	} else if (pathExists(paths.dest)) {
		throw new Error(`rollback did not restore the missing destination`);
	}
}

export function installAdoption(
	options: InstallOptions,
	runtime: AdoptRuntime = {},
): AdoptResult {
	const destinationGuard = options.destinationGuard ?? guardDestinationPath(options.dest);
	destinationGuard.prepareParent();
	const token = randomUUID();
	const paths = transactionPaths(destinationGuard.path, token);
	destinationGuard.assertParentStable();
	options.assertSourceStable?.();
	assertTransactionArtifacts(paths);
	let acquisition: LockAcquisition;
	try {
		acquisition = acquireLock(paths, token, runtime, () => destinationGuard.assertParentStable());
	} catch (error) {
		if (error instanceof PathIdentityChangedError) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, error.message, { cause: error });
		}
		throw error;
	}
	let oldExists = false;
	let oldFingerprint: string | null = null;
	let previousIdentity: EntryIdentity | null = null;
	let destinationStateCaptured = false;
	let installed = false;
	let stagedIdentity: EntryIdentity | null = null;
	let installedIdentity: EntryIdentity | null = null;
	let parentUnsafe = false;
	let retainLock = false;
	let rollbackAllowed = true;
	let recoveryComplete = false;
	let lockIdentity = acquisition.lockIdentity;
	const identities: TransactionIdentities = { lock: lockIdentity };
	let manifest: AdoptManifest | undefined;
	const assertStable = (): void => {
		options.assertSourceStable?.();
		assertDestinationStable();
	};
	const assertDestinationStable = (): void => {
		destinationGuard.assertParentStable();
		destinationGuard.assertLeafStable();
		if (installedIdentity) {
			assertEntryIdentity(paths.dest, 'installed adoption destination', installedIdentity);
		}
		identities.lock = lockIdentity;
		assertTransactionArtifacts(paths, identities, recoveryComplete);
	};
	const checkpoint = (point: AdoptCheckpoint): void => {
		guardedCall(assertStable, () => runtime.checkpoint?.(point, paths));
	};
	try {
		checkpoint('lock.acquired');
		const recovery = recover(
			paths,
			destinationGuard,
			options.inspect,
			options.recognize,
			acquisition,
			runtime,
		);
		if (recovery.pendingToken) {
			retainLock = false;
			throw new CleanupPendingError(
				`committed adoption cleanup is still pending for ${paths.dest}`,
			);
		}
		recoveryComplete = true;
		checkpoint('recovery.checked');
		if (
			pathExists(paths.dest) &&
			!guardedCall(assertStable, () => isRecognized(paths.dest, options.recognize))
		) {
			throw new AdoptError(
				ADOPT_EXIT.PRECONDITION,
				`refusing to replace a non-adoption destination at ${paths.dest}`,
			);
		}
		oldExists = pathExists(paths.dest);
		oldFingerprint = oldExists ? fullTreeHash(paths.dest) : null;
		previousIdentity = oldExists
			? entryIdentity(paths.dest, 'adoption destination', 'directory')
			: null;
		destinationStateCaptured = true;
		assertStable();
		if (pathExists(paths.stage)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption stage already exists`);
		}
		if (pathExists(paths.recovery)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption recovery evidence already exists`);
		}
		mkdirSync(paths.stage);
		stagedIdentity = entryIdentity(paths.stage, 'adoption stage', 'directory');
		identities.stage = stagedIdentity;
		const evidence: RecoveryEvidence = {
			schema: 1,
			token,
			dest: paths.dest,
			previous:
				previousIdentity && oldFingerprint
					? { identity: previousIdentity, treeHash: oldFingerprint }
					: null,
			staged: { identity: stagedIdentity },
		};
		identities.recovery = writeRecoveryEvidence(paths.recovery, evidence);
		manifest = guardedCall(assertStable, () => options.build(paths.stage));
		options.assertSourceStable?.();
		guardedCall(assertStable, () => verifiedManifest(paths.stage, manifest!, options.inspect));
		syncTree(paths.stage);
		checkpoint('stage.durable');
		checkpoint('stage.ready');
		if (pathExists(paths.dest)) {
			try {
				const current = guardedCall(assertStable, () => options.inspect(paths.dest));
				if (isDeepStrictEqual(current, manifest)) {
					removeOwnedEntry(paths.stage, 'adoption stage', stagedIdentity!, true);
					delete identities.stage;
					if (!identities.recovery) {
						throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `recovery evidence identity is unavailable`);
					}
					removeOwnedEntry(
						paths.recovery,
						'adoption recovery evidence',
						identities.recovery,
						false,
					);
					delete identities.recovery;
					checkpoint('noop');
					return { outcome: 'noop', manifest: current };
				}
			} catch {
				// A recognized but corrupted adoption is repairable by replacement.
			}
		}
		if (assertArtifactNotLink(paths.backup, 'adoption backup')) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `durable backup was not recovered`);
		}
		if (oldExists) {
			assertStable();
			if (!previousIdentity) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `previous destination identity is unavailable`);
			}
			renameOwnedEntry(paths.dest, paths.backup, 'adoption backup', previousIdentity);
			identities.backup = previousIdentity;
			destinationGuard.markLeafMissing();
			syncDirectory(dirname(paths.dest));
			checkpoint('backup.durable');
		}
		assertStable();
		if (!stagedIdentity) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption stage identity is unavailable`);
		}
		renameOwnedEntry(paths.stage, paths.dest, 'adoption stage', stagedIdentity);
		delete identities.stage;
		installed = true;
		installedIdentity = stagedIdentity;
		destinationGuard.markLeafCurrent();
		syncDirectory(dirname(paths.dest));
		checkpoint('destination.installed');
		const accepted = guardedCall(assertStable, () =>
			verifiedManifest(paths.dest, manifest!, options.inspect),
		);
		checkpoint('postverify.passed');
		rollbackAllowed = false;
		if (pathExists(paths.backup)) {
			if (!identities.backup) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption backup identity is unavailable`);
			}
			if (pathExists(paths.tombstone)) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption tombstone already exists`);
			}
			renameOwnedEntry(
				paths.backup,
				paths.tombstone,
				'adoption backup',
				identities.backup,
			);
			identities.tombstone = identities.backup;
			delete identities.backup;
			syncDirectory(dirname(paths.dest));
			retainLock = true;
			rollbackAllowed = false;
		}
		try {
			runtime.checkpoint?.('commit.durable', paths);
		} catch {
			// Commit is already durable; a checkpoint failure cannot roll it back.
		}
		assertDestinationStable();
		if (pathExists(paths.tombstone)) {
			if (!identities.tombstone) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption tombstone identity is unavailable`);
			}
			if (!identities.recovery) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `recovery evidence identity is unavailable`);
			}
			identities.cleanup = authorizeRecoveryCleanup(paths, identities.recovery);
			delete identities.recovery;
			const tombstoneIdentity = identities.tombstone;
			const removed = cleanupTombstone(
				paths,
				paths.tombstone,
				tombstoneIdentity,
				runtime,
				assertDestinationStable,
				() => delete identities.tombstone,
			);
			if (!removed) {
				retainLock = false;
				return { outcome: 'installed', manifest: accepted };
			}
			delete identities.tombstone;
			assertDestinationStable();
		}
		const finalEvidence = identities.cleanup
			? { path: paths.cleanup, identity: identities.cleanup }
			: identities.recovery
				? { path: paths.recovery, identity: identities.recovery }
				: null;
		if (finalEvidence) {
			checkpoint('recovery.finalize');
			removeOwnedEntry(
				finalEvidence.path,
				'adoption recovery evidence',
				finalEvidence.identity,
				false,
			);
			delete identities.recovery;
			delete identities.cleanup;
		}
		retainLock = false;
		return { outcome: 'installed', manifest: accepted };
	} catch (error) {
		if (error instanceof PathIdentityChangedError) {
			parentUnsafe = !error.cleanupSafe;
			if (!rollbackAllowed) {
				retainLock = parentUnsafe;
				throw new CleanupPendingError(
					`committed adoption requires cleanup recovery for ${paths.dest}`,
					{ cause: error },
				);
			}
			if (error.subject === 'source' && destinationStateCaptured) {
				try {
					rollback(
						paths,
						oldExists,
						oldFingerprint,
						installed,
						runtime,
						destinationGuard,
						{ ...identities, lock: lockIdentity },
						installedIdentity,
						);
					} catch (rollbackError) {
						retainLock = true;
						if (rollbackError instanceof PathIdentityChangedError && !rollbackError.cleanupSafe) {
						parentUnsafe = true;
					}
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`adoption recovery requires manual intervention for ${paths.dest}`,
						{ cause: rollbackError },
					);
				}
			}
			const code =
				error.subject === 'source' ? ADOPT_EXIT.PRECONDITION : ADOPT_EXIT.RECOVERY_REQUIRED;
			if (code === ADOPT_EXIT.RECOVERY_REQUIRED) retainLock = true;
			throw new AdoptError(code, error.message, { cause: error });
		}
		if (error instanceof AdoptError) {
			if (error instanceof CleanupPendingError) {
				retainLock = false;
				throw error;
			}
			if (error.code === ADOPT_EXIT.RECOVERY_REQUIRED) retainLock = true;
			throw error;
		}
		if (!rollbackAllowed) {
			retainLock = false;
			throw new CleanupPendingError(
				`committed adoption requires cleanup recovery for ${paths.dest}`,
				{ cause: error },
			);
		}
		try {
			rollback(
				paths,
				oldExists,
				oldFingerprint,
				installed,
				runtime,
				destinationGuard,
				{ ...identities, lock: lockIdentity },
				installedIdentity,
			);
		} catch (rollbackError) {
			retainLock = true;
			if (rollbackError instanceof PathIdentityChangedError && !rollbackError.cleanupSafe) {
				parentUnsafe = true;
			}
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`adoption recovery requires manual intervention for ${paths.dest}`,
				{ cause: rollbackError },
			);
		}
		throw new AdoptError(
			ADOPT_EXIT.TRANSACTION_FAILED,
			`adoption transaction failed; previous destination was restored`,
			{ cause: error },
		);
	} finally {
		if (!parentUnsafe) {
			destinationGuard.assertParentStable();
			if (!retainLock && identities.stage && pathExists(paths.stage)) {
				removeOwnedEntry(paths.stage, 'adoption stage', identities.stage, true);
			}
			if (!retainLock) releaseLock(paths.lock, token, lockIdentity);
		}
	}
}
