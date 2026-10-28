import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

function filesUnder(path: string, extension: string): string[] {
	const root = resolve(process.cwd(), path);
	const out: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) walk(absolute);
			else if (extname(entry.name) === extension) out.push(absolute);
		}
	};
	walk(root);
	return out;
}

const copyModules = (): string[] =>
	filesUnder('src', '.ts').filter((path) => !path.endsWith('.test.ts'));

const FORKED_KEY = /^[ \t]*(['"`]?)(?:noData|noDelay)\1\s*:/m;
const FORKED_GENERIC_LABEL =
	/^[ \t]*(['"`]?)(?:noData|noDelay)\1\s*:\s*(['"])(?:No data|no data|Aucune donnée|aucune donnée|Sans données|sans données)[^'"\n]*\2,?\s*$/m;

describe('absence containment contract', () => {
	it('uses the row variant at every current table-cell absence site', () => {
		const expected = new Map([
			['src/lib/components/schedule/ScheduleTable.svelte', 5],
			['src/lib/features/repeat-offenders/sections/RepeatOffenderEvidenceTable.svelte', 3],
			['src/lib/features/hotspots/sections/HotspotSection.svelte', 1],
			['src/lib/features/lines/reliability/sections/Section2TheWait.svelte', 2],
			['src/lib/features/health/sections/SectionHistoryCoverage.svelte', 7],
		]);

		for (const [path, count] of expected) {
			const matches = read(path).match(/<(?:AbsentValue|MaybeValue)\b[^>]*\bvariant="row"/g) ?? [];
			expect(matches, path).toHaveLength(count);
		}

		const status = read('src/lib/features/health/sections/SectionHistoryCoverage.svelte');
		expect(status.match(/<StateNotice\b[^>]*\bpresentation="row"/g) ?? []).toHaveLength(1);
	});

	it('keeps generic no-data labels out of every copy module, quoted key or not', () => {
		const scanned = copyModules();
		expect(scanned.length).toBeGreaterThan(200);
		for (const file of scanned) {
			expect(readFileSync(file, 'utf8'), file).not.toMatch(FORKED_GENERIC_LABEL);
		}
	});

	it('removes noData and noDelay keys app-wide after consumers move to typed reasons', () => {
		const scanned = copyModules();
		expect(scanned.length).toBeGreaterThan(200);
		for (const file of scanned) {
			expect(readFileSync(file, 'utf8'), file).not.toMatch(FORKED_KEY);
		}
	});

	it('removes dead domain-named absence fields after their consumers move to the primitive', () => {
		expect(read('src/lib/features/search/search.copy.ts')).not.toMatch(/^\s*noCrowding\s*:/m);
		expect(read('src/lib/features/stops/reliability/stops-reliability.copy.ts')).not.toMatch(
			/^\s*noTelemetry\s*:/m,
		);
		expect(read('src/lib/features/lines/reliability/reliability.copy.ts')).not.toMatch(
			/^\s*empty:\s*['"](?:No delay-by-crowding data yet|Aucune donnée de retard par occupation)['"]/m,
		);
	});

	it('uses the centralized chart label instead of an English SeverityBar fallback', () => {
		expect(read('src/lib/components/dataviz/SeverityBar.svelte')).not.toMatch(/\?\s*'no data'/);
		expect(read('src/lib/components/dataviz/chart/marks/HeatmapMark.svelte')).not.toMatch(
			/\?\?\s*'no data'/,
		);
	});
});
