import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readSync,
	realpathSync,
	type Stats,
} from 'node:fs';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';

interface PathSnapshot {
	path: string;
	dev: number;
	ino: number;
	mode: number;
}

export class PathIdentityChangedError extends Error {
	constructor(
		message: string,
		readonly subject: 'source' | 'destination-parent' | 'destination',
		readonly cleanupSafe: boolean,
	) {
		super(message);
		this.name = 'PathIdentityChangedError';
	}
}

export interface StableExistingPath {
	readonly path: string;
	assertStable(): void;
}

export interface DestinationPathGuard {
	readonly path: string;
	readonly parent: string;
	prepareParent(): void;
	assertParentStable(): void;
	assertLeafStable(): void;
	refreshLeaf(): void;
	markLeafMissing(): void;
	markLeafCurrent(): void;
}

function components(path: string): string[] {
	const root = parse(path).root;
	const suffix = relative(root, path);
	if (suffix === '') return [root];
	const paths = [root];
	let current = root;
	for (const component of suffix.split(sep)) {
		current = join(current, component);
		paths.push(current);
	}
	return paths;
}

function maybeLstat(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function rejectLink(path: string, stats: Stats, label: string): void {
	if (stats.isSymbolicLink()) throw new Error(`${label}: refusing symbolic link component ${path}`);
}

function snapshot(path: string, stats: Stats): PathSnapshot {
	return { path, dev: stats.dev, ino: stats.ino, mode: stats.mode };
}

function sameIdentity(expected: PathSnapshot, actual: Stats): boolean {
	return expected.dev === actual.dev && expected.ino === actual.ino && expected.mode === actual.mode;
}

function assertSnapshots(
	snapshots: readonly PathSnapshot[],
	label: string,
	subject: PathIdentityChangedError['subject'],
	cleanupSafe: boolean,
): void {
	for (const expected of snapshots) {
		const actual = maybeLstat(expected.path);
		if (!actual || actual.isSymbolicLink() || !sameIdentity(expected, actual)) {
			throw new PathIdentityChangedError(
				`${label} path identity changed at ${expected.path}`,
				subject,
				cleanupSafe,
			);
		}
	}
}

function rejectLexicalLinks(path: string, label: string, requireComplete: boolean): string {
	let deepest = parse(path).root;
	for (const component of components(path)) {
		const stats = maybeLstat(component);
		if (!stats) {
			if (requireComplete) throw new Error(`${label} does not exist: ${path}`);
			break;
		}
		rejectLink(component, stats, label);
		if (!stats.isDirectory() && component !== path) {
			throw new Error(`${label} has a non-directory component at ${component}`);
		}
		deepest = component;
	}
	return deepest;
}

function snapshotsForExistingPath(path: string, label: string): PathSnapshot[] {
	return components(path).map((component) => {
		const stats = lstatSync(component);
		rejectLink(component, stats, label);
		return snapshot(component, stats);
	});
}

function guardExisting(
	input: string,
	label: string,
	kind: 'directory' | 'file',
): StableExistingPath {
	const absolute = resolve(input);
	rejectLexicalLinks(absolute, label, true);
	const canonical = realpathSync.native(absolute);
	const stats = lstatSync(canonical);
	rejectLink(canonical, stats, label);
	if ((kind === 'directory' && !stats.isDirectory()) || (kind === 'file' && !stats.isFile())) {
		throw new Error(`${label} must be an existing ${kind}: ${canonical}`);
	}
	const snapshots = snapshotsForExistingPath(canonical, label);
	return {
		path: canonical,
		assertStable() {
			assertSnapshots(snapshots, label, 'source', true);
			const current = realpathSync.native(canonical);
			if (current !== canonical) {
				throw new PathIdentityChangedError(
					`${label} path identity changed at ${canonical}`,
					'source',
					true,
				);
			}
		},
	};
}

export function guardExistingDirectory(input: string, label: string): StableExistingPath {
	return guardExisting(input, label, 'directory');
}

export function guardExistingFile(input: string, label: string): StableExistingPath {
	return guardExisting(input, label, 'file');
}

export function readStableFile(
	guard: StableExistingPath,
	maxBytes: number,
	limitMessage: string,
): Buffer {
	guard.assertStable();
	const before = lstatSync(guard.path);
	if (!before.isFile() || before.size <= 0 || before.size > maxBytes) {
		throw new Error(limitMessage);
	}
	const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
	const descriptor = openSync(guard.path, constants.O_RDONLY | noFollow);
	try {
		const opened = fstatSync(descriptor);
		if (
			!opened.isFile() ||
			opened.dev !== before.dev ||
			opened.ino !== before.ino ||
			opened.size !== before.size
		) {
			throw new Error(`${limitMessage}; file identity changed before reading`);
		}
		const bytes = Buffer.allocUnsafe(opened.size);
		let offset = 0;
		while (offset < bytes.length) {
			const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
			if (count === 0) throw new Error(`${limitMessage}; file changed while reading`);
			offset += count;
		}
		if (readSync(descriptor, Buffer.alloc(1), 0, 1, null) !== 0) {
			throw new Error(`${limitMessage}; file grew while reading`);
		}
		const after = fstatSync(descriptor);
		if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
			throw new Error(`${limitMessage}; file identity changed while reading`);
		}
		guard.assertStable();
		return bytes;
	} finally {
		closeSync(descriptor);
	}
}

class DestinationGuard implements DestinationPathGuard {
	readonly path: string;
	readonly parent: string;
	readonly #label: string;
	readonly #missingParentParts: string[];
	readonly #parentSnapshots: PathSnapshot[];
	#leaf: PathSnapshot | null = null;
	#prepared = false;

	constructor(input: string, label: string) {
		this.#label = label;
		const absolute = resolve(input);
		const lexicalParent = dirname(absolute);
		const deepest = rejectLexicalLinks(lexicalParent, label, false);
		const canonicalDeepest = realpathSync.native(deepest);
		const unresolved = relative(deepest, lexicalParent);
		this.#missingParentParts = unresolved === '' ? [] : unresolved.split(sep);
		this.parent = join(canonicalDeepest, ...this.#missingParentParts);
		this.path = join(this.parent, basename(absolute));
		this.#parentSnapshots = snapshotsForExistingPath(canonicalDeepest, label);
		const lexicalLeaf = maybeLstat(absolute);
		if (lexicalLeaf) rejectLink(absolute, lexicalLeaf, label);
	}

	prepareParent(): void {
		if (this.#prepared) return;
		let current = this.#parentSnapshots.at(-1)?.path ?? parse(this.parent).root;
		for (const component of this.#missingParentParts) {
			this.assertParentStable();
			current = join(current, component);
			let stats = maybeLstat(current);
			if (!stats) {
				mkdirSync(current);
				stats = lstatSync(current);
			}
			rejectLink(current, stats, this.#label);
			if (!stats.isDirectory()) {
				throw new Error(`${this.#label} has a non-directory component at ${current}`);
			}
			this.#parentSnapshots.push(snapshot(current, stats));
		}
		this.#prepared = true;
		this.#leaf = this.#readLeaf();
	}

	assertParentStable(): void {
		assertSnapshots(
			this.#parentSnapshots,
			`${this.#label} parent`,
			'destination-parent',
			false,
		);
	}

	assertLeafStable(): void {
		this.#requirePrepared();
		this.assertParentStable();
		const actual = maybeLstat(this.path);
		if (actual?.isSymbolicLink()) {
			throw new PathIdentityChangedError(
				`${this.#label}: refusing symbolic link at ${this.path}`,
				'destination',
				true,
			);
		}
		if (
			(this.#leaf === null && actual !== null) ||
			(this.#leaf !== null && (actual === null || !sameIdentity(this.#leaf, actual)))
		) {
			throw new PathIdentityChangedError(
				`${this.#label} path identity changed at ${this.path}`,
				'destination',
				true,
			);
		}
	}

	refreshLeaf(): void {
		this.#requirePrepared();
		this.assertParentStable();
		this.#leaf = this.#readLeaf();
	}

	markLeafMissing(): void {
		this.#requirePrepared();
		this.assertParentStable();
		if (maybeLstat(this.path) !== null) {
			throw new PathIdentityChangedError(
				`${this.#label} path identity changed at ${this.path}`,
				'destination',
				true,
			);
		}
		this.#leaf = null;
	}

	markLeafCurrent(): void {
		this.#requirePrepared();
		this.assertParentStable();
		this.#leaf = this.#readLeaf();
		if (!this.#leaf) {
			throw new PathIdentityChangedError(
				`${this.#label} path identity changed at ${this.path}`,
				'destination',
				true,
			);
		}
	}

	#readLeaf(): PathSnapshot | null {
		const stats = maybeLstat(this.path);
		if (!stats) return null;
		rejectLink(this.path, stats, this.#label);
		return snapshot(this.path, stats);
	}

	#requirePrepared(): void {
		if (!this.#prepared) throw new Error(`${this.#label} parent is not prepared`);
	}
}

export function guardDestinationPath(input: string, label = 'destination'): DestinationPathGuard {
	return new DestinationGuard(input, label);
}
