#!/usr/bin/env bun

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	acquireArchive,
	acquireRelease,
	acquireWorktree,
	type AcquiredSource,
} from './adopt/acquisition.js';
import {
	MANIFEST_SCHEMA,
	PACKAGE_NAMES,
	assertTag,
	parsePackages,
	type AdoptManifest,
	type PackageName,
} from './adopt/contract.js';
import {
	adoptFromSource,
	checkAdoption,
	type AdoptFromSourceOptions,
} from './adopt/payload.js';
import {
	ADOPT_EXIT,
	AdoptError,
	type AdoptResult,
	type AdoptRuntime,
} from './adopt/transaction.js';

export {
	MANIFEST_SCHEMA,
	PACKAGE_NAMES,
	treeHash,
	type AdoptManifest,
	type AdoptProvenance,
	type AdoptTrustRecord,
	type PackageName,
} from './adopt/contract.js';
export {
	ADOPT_EXIT,
	AdoptError,
	type AdoptCheckpoint,
	type AdoptExitCode,
	type AdoptResult,
	type AdoptRuntime,
	type AdoptTransactionPaths,
} from './adopt/transaction.js';
export { adoptFromSource, checkAdoption, type AdoptFromSourceOptions } from './adopt/payload.js';

export type ParsedArgs =
	| { mode: 'help' }
	| { mode: 'check'; dest: string }
	| {
			mode: 'adopt';
			tag: string;
			packages: PackageName[];
			dest: string;
			source?: string;
			archive?: string;
	  };

type AdoptArgs = Extract<ParsedArgs, { mode: 'adopt' }>;

export interface AdoptDependencies {
	acquire(options: AdoptArgs): Promise<AcquiredSource>;
}

const DEFAULT_DEPENDENCIES: AdoptDependencies = {
	async acquire(options) {
		return options.source
			? acquireWorktree(options.source, options.tag)
			: options.archive
				? acquireArchive(options.archive, options.tag)
				: acquireRelease(options.tag);
	},
};

export function parseArgs(argv: string[]): ParsedArgs {
	const values = new Map<string, string>();
	let check = false;
	let help = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg) throw new Error('empty argument');
		if (arg === '--check') {
			if (check) throw new Error('duplicate argument --check');
			check = true;
			continue;
		}
		if (arg === '--help' || arg === '-h') {
			help = true;
			continue;
		}
		if (!['--tag', '--packages', '--dest', '--source', '--archive'].includes(arg)) {
			throw new Error(`unknown argument "${arg}"`);
		}
		if (values.has(arg)) throw new Error(`duplicate argument ${arg}`);
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
		values.set(arg, value);
		index++;
	}

	if (help) return { mode: 'help' };
	const dest = values.get('--dest');
	if (check) {
		if (!dest) throw new Error('--check requires --dest');
		for (const incompatible of ['--tag', '--packages', '--source', '--archive']) {
			if (values.has(incompatible)) throw new Error(`--check cannot be combined with ${incompatible}`);
		}
		return { mode: 'check', dest };
	}

	const tag = values.get('--tag');
	const packageList = values.get('--packages');
	if (!tag || !packageList || !dest) {
		throw new Error('adoption requires --tag, --packages, and --dest');
	}
	assertTag(tag);
	const parsed: ParsedArgs = {
		mode: 'adopt',
		tag,
		packages: parsePackages(packageList),
		dest,
	};
	const source = values.get('--source');
	const archive = values.get('--archive');
	if (source && archive) throw new Error('--source and --archive are mutually exclusive');
	if (source) parsed.source = source;
	if (archive) parsed.archive = archive;
	return parsed;
}


export async function adopt(
	options: AdoptArgs,
	runtime: AdoptRuntime = {},
	dependencies: AdoptDependencies = DEFAULT_DEPENDENCIES,
): Promise<AdoptResult> {
	try {
		const dest = resolve(options.dest);
		const acquired = await dependencies.acquire(options);
		let primaryError: unknown;
		try {
			return adoptFromSource({
				source: acquired.source,
				dest,
				packages: options.packages,
				provenance: acquired.provenance,
				runtime,
			});
		} catch (error) {
			primaryError = error;
			throw error;
		} finally {
			try {
				acquired.cleanup();
			} catch (cleanupError) {
				if (primaryError instanceof AdoptError) {
					throw new AdoptError(primaryError.code, primaryError.message, {
						cause: new AggregateError(
							[primaryError, cleanupError],
							'acquired-source cleanup also failed',
						),
					});
				}
				if (primaryError !== undefined) {
					throw new AggregateError(
						[primaryError, cleanupError],
						'adoption and acquired-source cleanup failed',
					);
				}
				throw new AdoptError(
					ADOPT_EXIT.INTERNAL,
					'adoption completed but acquired-source cleanup failed',
					{ cause: cleanupError },
				);
			}
		}
	} catch (error) {
		if (error instanceof AdoptError) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		throw new AdoptError(
			ADOPT_EXIT.PRECONDITION,
			`adoption precondition failed: ${detail}`,
			{ cause: error },
		);
	}
}

function usage(): string {
	return [
		'Usage:',
		'  bun tools/adopt.ts --tag vX.Y.Z --packages tokens,motion,gates,seo-kit,ui --dest vendor/design',
		'  bun tools/adopt.ts --tag vX.Y.Z --packages tokens,motion,gates,seo-kit,ui --dest vendor/design --source ../yesid.dev-design',
		'  bun tools/adopt.ts --tag vX.Y.Z --packages tokens,motion,gates,seo-kit,ui --dest vendor/design --archive ./yesid.dev-design-vX.Y.Z.tar',
		'  bun tools/adopt.ts --check --dest vendor/design',
		'',
		'Default mode verifies and installs the immutable GitHub Release asset.',
	].join('\n');
}

export async function main(
	argv = process.argv.slice(2),
	runtime: AdoptRuntime = {},
	dependencies: AdoptDependencies = DEFAULT_DEPENDENCIES,
): Promise<number> {
	let args: ParsedArgs;
	try {
		args = parseArgs(argv);
	} catch (error) {
		console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
		console.error(usage());
		return ADOPT_EXIT.USAGE;
	}
	if (args.mode === 'help') {
		console.log(usage());
		return ADOPT_EXIT.OK;
	}
	if (args.mode === 'check') {
		try {
			const manifest = checkAdoption(args.dest);
			console.log(
				`✓ ${args.dest} matches ${manifest.provenance.tag.name} @ ${manifest.provenance.tag.peeledCommit.slice(0, 9)}`,
			);
			return ADOPT_EXIT.OK;
		} catch (error) {
			console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
			return ADOPT_EXIT.CHECK_FAILED;
		}
	}
	try {
		const result = await adopt(args, runtime, dependencies);
		const { manifest } = result;
		if (args.source || args.archive) {
			console.log(`i local ${args.source ? '--source' : '--archive'} development mode`);
		}
		console.log(
			`✓ adopted @yesid/{${manifest.packages.join(',')}} at ${manifest.provenance.tag.name} (${manifest.provenance.tag.peeledCommit.slice(0, 9)})`,
		);
		console.log(`  treeHash ${manifest.treeHash}`);
		if (result.outcome === 'noop') console.log('= unchanged');
		return ADOPT_EXIT.OK;
	} catch (error) {
		console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
		if (error instanceof AdoptError) return error.code;
		return ADOPT_EXIT.INTERNAL;
	}
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main().then((code) => (process.exitCode = code));
