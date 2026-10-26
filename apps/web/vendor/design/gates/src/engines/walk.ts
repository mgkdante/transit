import { lstatSync, opendirSync, realpathSync, type Stats } from 'node:fs';
import * as nodePath from 'node:path';

// The package README records the exact consumer snapshots, counting rules, and
// reproduction command behind these fixed ceilings.
const MAX_DEPTH = 16;
const MAX_FILES = 4_096;
const MAX_ENTRIES = 8_192;
const MAX_AGGREGATE_BYTES = 32 * 1024 * 1024;

interface InternalWalkOptions {
	extensions: readonly string[];
	exclude?: (absPath: string) => boolean;
}

interface WalkState {
	entryCount: number;
	fileCount: number;
	aggregateBytes: number;
	rootCanonical: string;
	visitedDirectories: Set<string>;
	files: string[];
}

function sortedEntryNames(directory: string, state: WalkState): string[] {
	const handle = opendirSync(directory);
	const names: string[] = [];
	try {
		for (;;) {
			const entry = handle.readSync();
			if (entry === null) break;
			state.entryCount += 1;
			if (state.entryCount > MAX_ENTRIES) {
				throw new Error(
					`walk: entry count exceeds limit ${MAX_ENTRIES.toLocaleString('en-US')} at ${directory}`,
				);
			}
			names.push(entry.name);
		}
	} finally {
		handle.closeSync();
	}
	return names.sort();
}

export interface PathSemantics {
	readonly sep: string;
	isAbsolute(path: string): boolean;
	relative(from: string, to: string): string;
}

export function isPathWithin(
	root: string,
	candidate: string,
	paths: PathSemantics = nodePath,
): boolean {
	const fromRoot = paths.relative(root, candidate);
	return (
		fromRoot === '' ||
		(!fromRoot.startsWith(`..${paths.sep}`) && fromRoot !== '..' && !paths.isAbsolute(fromRoot))
	);
}

export function relativePathFromRoot(
	root: string,
	candidate: string,
	paths: PathSemantics = nodePath,
): string {
	if (!isPathWithin(root, candidate, paths)) {
		throw new Error(`walk: path is outside root: ${candidate}`);
	}
	return paths.relative(root, candidate).split(paths.sep).join('/');
}

function canonical(path: string): string {
	try {
		return realpathSync.native(path);
	} catch (cause) {
		throw new Error(`walk: could not resolve ${path}`, { cause });
	}
}

function refuseLink(path: string, stats: Stats): void {
	if (stats.isSymbolicLink()) throw new Error(`walk: refusing symbolic link ${path}`);
}

function assertStable(path: string, before: Stats): Stats {
	const after = lstatSync(path);
	refuseLink(path, after);
	if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode) {
		throw new Error(`walk: filesystem entry changed during traversal: ${path}`);
	}
	return after;
}

function visitDirectory(
	directory: string,
	canonicalDirectory: string,
	depth: number,
	options: InternalWalkOptions,
	state: WalkState,
): void {
	if (depth > MAX_DEPTH) {
		throw new Error(`walk: depth ${depth} exceeds limit ${MAX_DEPTH} at ${directory}`);
	}

	const before = lstatSync(directory);
	refuseLink(directory, before);
	if (!before.isDirectory()) throw new Error(`walk: expected a directory at ${directory}`);
	const currentCanonical = canonical(directory);
	if (nodePath.relative(currentCanonical, canonicalDirectory) !== '') {
		throw new Error(`walk: directory identity changed during traversal: ${directory}`);
	}
	assertStable(directory, before);

	for (const entry of sortedEntryNames(directory, state)) {
		const path = nodePath.join(directory, entry);
		const stats = lstatSync(path);
		refuseLink(path, stats);

		if (stats.isDirectory()) {
			const childCanonical = canonical(path);
			if (!isPathWithin(state.rootCanonical, childCanonical)) {
				throw new Error(`walk: canonical path escapes root: ${path}`);
			}
			assertStable(path, stats);
			if (state.visitedDirectories.has(childCanonical)) {
				throw new Error(`walk: directory cycle or alias detected at ${path}`);
			}
			state.visitedDirectories.add(childCanonical);
			visitDirectory(path, childCanonical, depth + 1, options, state);
			continue;
		}

		if (!stats.isFile()) throw new Error(`walk: refusing non-regular filesystem entry ${path}`);

		state.fileCount += 1;
		if (state.fileCount > MAX_FILES) {
			throw new Error(`walk: file count exceeds limit ${MAX_FILES.toLocaleString('en-US')} at ${path}`);
		}
		state.aggregateBytes += stats.size;
		if (state.aggregateBytes > MAX_AGGREGATE_BYTES) {
			throw new Error(`walk: aggregate bytes exceed limit 32 MiB at ${path}`);
		}

		const fileCanonical = canonical(path);
		if (!isPathWithin(state.rootCanonical, fileCanonical)) {
			throw new Error(`walk: canonical path escapes root: ${path}`);
		}
		assertStable(path, stats);
		if (
			options.extensions.some((extension) => path.endsWith(extension)) &&
			!(options.exclude?.(path) ?? false)
		) {
			state.files.push(path);
		}
	}
}

function collect(dir: string, options: InternalWalkOptions): string[] {
	const root = nodePath.resolve(dir);
	const rootStats = lstatSync(root);
	refuseLink(root, rootStats);
	if (!rootStats.isDirectory()) throw new Error(`walk: expected a directory at ${root}`);
	const rootCanonical = canonical(root);
	assertStable(root, rootStats);
	const state: WalkState = {
		entryCount: 0,
		fileCount: 0,
		aggregateBytes: 0,
		rootCanonical,
		visitedDirectories: new Set([rootCanonical]),
		files: [],
	};
	visitDirectory(root, rootCanonical, 0, options, state);
	return state.files.sort();
}

/** Collect files under `dir` whose path ends with one of `extensions`. */
export function walk(dir: string, extensions: readonly string[], out: string[] = []): string[] {
	out.push(...collect(dir, { extensions }));
	return out;
}

/**
 * Wider walk with an exclusion predicate — the transit brand-hex traversal
 * shape (all matching source minus tests minus an absolute-path allowlist).
 */
export function walkFiltered(
	dir: string,
	options: {
		extensions: readonly string[];
		exclude?: (absPath: string) => boolean;
	},
	out: string[] = [],
): string[] {
	out.push(...collect(dir, options));
	return out;
}
