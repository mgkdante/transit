import { randomUUID } from 'node:crypto';
import {
	closeSync,
	existsSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fullTreeHash, type AdoptManifest } from './contract.js';

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
	| 'rollback.started';

export interface AdoptTransactionPaths {
	dest: string;
	lock: string;
	reclaim: string;
	backup: string;
	tombstone: string;
	stage: string;
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
	reclaimedTokens: string[];
}

interface InstallOptions {
	dest: string;
	build(stage: string): AdoptManifest;
	inspect(path: string): AdoptManifest;
	recognize(path: string): boolean;
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
	const descriptor = openSync(path, 'r');
	try {
		fsyncSync(descriptor);
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
	};
}

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function parseLock(path: string): LockOwner {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `malformed adoption lock at ${path}`, {
			cause: error,
		});
	}
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

function acquireReclaimGuard(
	paths: AdoptTransactionPaths,
	owner: LockOwner,
	candidate: string,
): void {
	for (;;) {
		try {
			linkSync(candidate, paths.reclaim);
			syncDirectory(dirname(paths.reclaim));
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}

		const current = parseReclaimGuard(paths.reclaim);
		assertLockDestination(current, paths, paths.reclaim);
		if (lockIsActive(current)) {
			throw new AdoptError(
				ADOPT_EXIT.LOCKED,
				`adoption lock reclamation is already running for ${paths.dest}`,
			);
		}

		const stale = `${paths.reclaim}.stale-${current.token}`;
		if (existsSync(stale)) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`stale reclaim guard requires manual recovery at ${stale}`,
			);
		}
		try {
			renameSync(paths.reclaim, stale);
			syncDirectory(dirname(paths.reclaim));
		} catch (moveError) {
			if (!existsSync(paths.reclaim)) continue;
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

function releaseReclaimGuard(paths: AdoptTransactionPaths, token: string): void {
	if (!existsSync(paths.reclaim)) return;
	const owner = parseReclaimGuard(paths.reclaim);
	if (owner.token !== token) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`reclaim guard ownership changed at ${paths.reclaim}`,
		);
	}
	unlinkSync(paths.reclaim);
	syncDirectory(dirname(paths.reclaim));
}

function acquireLock(
	paths: AdoptTransactionPaths,
	token: string,
	runtime: AdoptRuntime,
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
	createLockCandidate(candidate, owner);
	let guardAcquired = false;
	let lockAcquired = false;
	try {
		acquireReclaimGuard(paths, owner, candidate);
		guardAcquired = true;
		runtime.checkpoint?.('lock.reclaim.guard.acquired', paths);
		const reclaimedTokens: string[] = [];
		if (existsSync(paths.lock)) {
			const current = parseLock(paths.lock);
			assertLockDestination(current, paths, paths.lock);
			if (lockIsActive(current)) {
				throw new AdoptError(
					ADOPT_EXIT.LOCKED,
					`adoption is already running for ${paths.dest} (pid ${current.pid} on ${current.hostname})`,
				);
			}
			unlinkSync(paths.lock);
			syncDirectory(dirname(paths.lock));
			reclaimedTokens.push(current.token);
		}
		linkSync(candidate, paths.lock);
		lockAcquired = true;
		unlinkSync(candidate);
		syncDirectory(dirname(paths.lock));
		return { reclaimedTokens };
	} finally {
		if (existsSync(candidate)) rmSync(candidate, { force: true });
		if (guardAcquired) {
			try {
				releaseReclaimGuard(paths, token);
			} catch (error) {
				if (lockAcquired) releaseLock(paths.lock, token);
				throw error;
			}
		}
	}
}

function releaseLock(path: string, token: string): void {
	if (!existsSync(path)) return;
	const owner = parseLock(path);
	if (owner.token !== token) {
		throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `adoption lock ownership changed at ${path}`);
	}
	unlinkSync(path);
	syncDirectory(dirname(path));
}

function isEmptyDirectory(path: string): boolean {
	return statSync(path).isDirectory() && readdirSync(path).length === 0;
}

function isRecognized(path: string, recognize: (path: string) => boolean): boolean {
	return isEmptyDirectory(path) || recognize(path);
}

function removeStaleStages(paths: AdoptTransactionPaths, reclaimedTokens: readonly string[]): void {
	let changed = false;
	for (const token of new Set(reclaimedTokens)) {
		const path = transactionPaths(paths.dest, token).stage;
		if (!existsSync(path)) continue;
		if (!lstatSync(path).isDirectory()) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`stale transaction stage is not a directory at ${path}`,
			);
		}
		rmSync(path, { recursive: true });
		changed = true;
	}
	if (changed) syncDirectory(dirname(paths.dest));
}

function tombstones(paths: AdoptTransactionPaths): string[] {
	const parent = dirname(paths.dest);
	const prefix = `.${basename(paths.dest)}.yesid-adopt.tombstone-`;
	return readdirSync(parent)
		.filter((entry) => entry.startsWith(prefix) && TOKEN.test(entry.slice(prefix.length)))
		.map((entry) => join(parent, entry));
}

function cleanupTombstone(
	paths: AdoptTransactionPaths,
	tombstone: string,
	runtime: AdoptRuntime,
): void {
	try {
		runtime.checkpoint?.('tombstone.cleanup', { ...paths, tombstone });
		rmSync(tombstone, { recursive: true, force: true });
		syncDirectory(dirname(paths.dest));
	} catch {
		// A committed destination does not depend on retired backup cleanup.
	}
}

function removeCommittedTombstones(
	paths: AdoptTransactionPaths,
	inspect: (path: string) => AdoptManifest,
	runtime: AdoptRuntime,
): void {
	const found = tombstones(paths);
	if (found.length === 0) return;
	try {
		inspect(paths.dest);
	} catch (error) {
		throw new AdoptError(
			ADOPT_EXIT.RECOVERY_REQUIRED,
			`cannot clean committed tombstones while destination is invalid at ${paths.dest}`,
			{ cause: error },
		);
	}
	for (const tombstone of found) cleanupTombstone(paths, tombstone, runtime);
}

function recover(
	paths: AdoptTransactionPaths,
	inspect: (path: string) => AdoptManifest,
	recognize: (path: string) => boolean,
	reclaimedTokens: readonly string[],
	runtime: AdoptRuntime,
): void {
	if (existsSync(paths.backup)) {
		if (!isRecognized(paths.backup, recognize)) {
			throw new AdoptError(
				ADOPT_EXIT.RECOVERY_REQUIRED,
				`unrecognized durable backup at ${paths.backup}`,
			);
		}
		const backupFingerprint = fullTreeHash(paths.backup);
		if (!existsSync(paths.dest)) {
			renameSync(paths.backup, paths.dest);
			syncDirectory(dirname(paths.dest));
			if (fullTreeHash(paths.dest) !== backupFingerprint) {
				throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `restored backup verification failed`);
			}
		} else {
			let currentIsValid = false;
			try {
				inspect(paths.dest);
				currentIsValid = true;
			} catch {
				currentIsValid = false;
			}
			if (currentIsValid) {
				if (existsSync(paths.tombstone)) {
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`recovery tombstone collision at ${paths.tombstone}`,
					);
				}
				try {
					renameSync(paths.backup, paths.tombstone);
					syncDirectory(dirname(paths.dest));
				} catch (error) {
					throw new AdoptError(
						ADOPT_EXIT.RECOVERY_REQUIRED,
						`could not durably retire recovered backup at ${paths.backup}`,
						{ cause: error },
					);
				}
			} else if (isRecognized(paths.dest, recognize)) {
				rmSync(paths.dest, { recursive: true });
				renameSync(paths.backup, paths.dest);
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
	removeCommittedTombstones(paths, inspect, runtime);
	removeStaleStages(paths, reclaimedTokens);
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

function rollback(
	paths: AdoptTransactionPaths,
	oldExists: boolean,
	oldFingerprint: string | null,
	installed: boolean,
	runtime: AdoptRuntime,
): void {
	runtime.checkpoint?.('rollback.started', paths);
	if (installed && existsSync(paths.dest)) rmSync(paths.dest, { recursive: true });
	if (existsSync(paths.backup) && existsSync(paths.tombstone)) {
		throw new Error(`rollback found both a backup and tombstone`);
	}
	const restore = existsSync(paths.backup)
		? paths.backup
		: existsSync(paths.tombstone)
			? paths.tombstone
			: null;
	if (restore) {
		if (existsSync(paths.dest)) rmSync(paths.dest, { recursive: true });
		renameSync(restore, paths.dest);
	}
	if (existsSync(paths.stage)) rmSync(paths.stage, { recursive: true, force: true });
	syncDirectory(dirname(paths.dest));
	if (oldExists) {
		if (!existsSync(paths.dest) || fullTreeHash(paths.dest) !== oldFingerprint) {
			throw new Error(`rollback did not restore the previous destination`);
		}
	} else if (existsSync(paths.dest)) {
		throw new Error(`rollback did not restore the missing destination`);
	}
}

export function installAdoption(
	options: InstallOptions,
	runtime: AdoptRuntime = {},
): AdoptResult {
	const token = randomUUID();
	const paths = transactionPaths(options.dest, token);
	mkdirSync(dirname(paths.dest), { recursive: true });
	const acquisition = acquireLock(paths, token, runtime);
	let oldExists = false;
	let oldFingerprint: string | null = null;
	let installed = false;
	let manifest: AdoptManifest | undefined;
	try {
		runtime.checkpoint?.('lock.acquired', paths);
		recover(
			paths,
			options.inspect,
			options.recognize,
			acquisition.reclaimedTokens,
			runtime,
		);
		runtime.checkpoint?.('recovery.checked', paths);
		if (existsSync(paths.dest) && !isRecognized(paths.dest, options.recognize)) {
			throw new AdoptError(
				ADOPT_EXIT.PRECONDITION,
				`refusing to replace a non-adoption destination at ${paths.dest}`,
			);
		}
		oldExists = existsSync(paths.dest);
		oldFingerprint = oldExists ? fullTreeHash(paths.dest) : null;
		mkdirSync(paths.stage);
		manifest = options.build(paths.stage);
		verifiedManifest(paths.stage, manifest, options.inspect);
		syncTree(paths.stage);
		runtime.checkpoint?.('stage.durable', paths);
		runtime.checkpoint?.('stage.ready', paths);
		if (existsSync(paths.dest)) {
			try {
				const current = options.inspect(paths.dest);
				if (isDeepStrictEqual(current, manifest)) {
					rmSync(paths.stage, { recursive: true });
					runtime.checkpoint?.('noop', paths);
					return { outcome: 'noop', manifest: current };
				}
			} catch {
				// A recognized but corrupted adoption is repairable by replacement.
			}
		}
		if (existsSync(paths.backup)) {
			throw new AdoptError(ADOPT_EXIT.RECOVERY_REQUIRED, `durable backup was not recovered`);
		}
		if (oldExists) {
			renameSync(paths.dest, paths.backup);
			syncDirectory(dirname(paths.dest));
			runtime.checkpoint?.('backup.durable', paths);
		}
		renameSync(paths.stage, paths.dest);
		installed = true;
		syncDirectory(dirname(paths.dest));
		runtime.checkpoint?.('destination.installed', paths);
		const accepted = verifiedManifest(paths.dest, manifest, options.inspect);
		runtime.checkpoint?.('postverify.passed', paths);
		if (existsSync(paths.backup)) {
			renameSync(paths.backup, paths.tombstone);
			syncDirectory(dirname(paths.dest));
		}
		try {
			runtime.checkpoint?.('commit.durable', paths);
		} catch {
			// Commit is already durable; a checkpoint failure cannot roll it back.
		}
		if (existsSync(paths.tombstone)) cleanupTombstone(paths, paths.tombstone, runtime);
		return { outcome: 'installed', manifest: accepted };
	} catch (error) {
		if (error instanceof AdoptError) throw error;
		try {
			rollback(paths, oldExists, oldFingerprint, installed, runtime);
		} catch (rollbackError) {
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
		if (existsSync(paths.stage)) rmSync(paths.stage, { recursive: true, force: true });
		releaseLock(paths.lock, token);
	}
}
