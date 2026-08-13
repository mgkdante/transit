import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

function ruleBody(source: string, selector: string): string {
	const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
	const selectorStart = style.indexOf(selector);
	if (selectorStart < 0) throw new Error(`missing CSS selector: ${selector}`);
	const open = style.indexOf('{', selectorStart + selector.length);
	if (open < 0) throw new Error(`missing CSS body: ${selector}`);
	let depth = 1;
	for (let index = open + 1; index < style.length; index += 1) {
		if (style[index] === '{') depth += 1;
		if (style[index] === '}') depth -= 1;
		if (depth === 0) return style.slice(open + 1, index);
	}
	throw new Error(`unclosed CSS body: ${selector}`);
}

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

// The PROTECTED consolidation decision: absence copy lives in ONE vocabulary
// ($lib/site/absence), reached through a typed reason key. A module that grows its
// own noData / noDelay label has FORKED that vocabulary.
//
// This walk is deliberately wide. It used to read only `src/lib/features/**/*.copy.ts`,
// which left a fork three places to hide: outside src/lib/features entirely, inside a
// feature module not named *.copy.ts, and behind a QUOTED key ('noData':) in the very
// files it did read. It now walks every non-test .ts module under src.
// *.test.ts is excluded on purpose: a test may legitimately build a `{ noDelay }`
// options object to exercise the formatter contract (src/lib/site/delayPresentation.test.ts).
const copyModules = (): string[] =>
	filesUnder('src', '.ts').filter((path) => !path.endsWith('.test.ts'));

// Quote-tolerant: `noData:`, `'noData':` and `"noData":` are the same fork.
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

	it('keeps the two verified host chassis free of nowrap and clipping traps', () => {
		const table = read('src/lib/components/data/DataTable.svelte');
		const mapGrid = read('src/lib/features/map/detail/DetailAttributeGrid.svelte');
		const hoverOverlay = read('src/lib/features/map/MapOverlayChrome.svelte');
		const hover = read('src/lib/features/map/MapHoverPeek.svelte');
		const tableCells = ruleBody(table, '.data-table th,\n\t.data-table td');
		const mapValues = ruleBody(mapGrid, '.detail-attribute-grid :global(dd)');
		const hoverGrid = ruleBody(hover, 'dl');
		const hoverValues = ruleBody(hover, '\n\tdd');

		expect(table).toMatch(/\.data-table\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
		expect(table).toMatch(/\.data-table-cell-content\s*\{[^}]*min-width:\s*0;/s);
		expect(tableCells).not.toMatch(/white-space:\s*nowrap/);
		expect(mapGrid).toMatch(/grid-template-columns:\s*5\.75rem minmax\(0, 1fr\)/);
		expect(mapValues).toMatch(/min-width:\s*0/);
		expect(mapValues).not.toMatch(/(?:white-space:\s*nowrap|overflow:\s*hidden|text-overflow:)/);
		expect(hoverOverlay).toMatch(/<MapHoverPeek\s+peek=\{hoverPeek\}\s+\{locale\}/);
		expect(hoverGrid).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
		expect(hoverValues).toMatch(/min-width:\s*0/);
		expect(hoverValues).not.toMatch(/(?:white-space:\s*nowrap|overflow:\s*hidden|text-overflow:)/);
		// The hover peek is a floating card, NOT a table: its eight absences stay
		// inline chips. Pin the count AND the absence of any variant override, so a
		// chip -> row/block flip (or a dropped absence) cannot pass this suite.
		const hoverAbsences = hover.match(/<AbsentValue\b[^>]*>/g) ?? [];
		expect(hoverAbsences, 'MapHoverPeek absence chips').toHaveLength(8);
		expect(
			hoverAbsences.filter((tag) => /\bvariant\s*=/.test(tag)),
			'MapHoverPeek absences must stay the default inline chip',
		).toHaveLength(0);
		expect(hover).not.toMatch(
			/\.map-hover-peek\s+:global\(\[data-slot='absent-value'\][^{]*\{[^}]*border-radius:/s,
		);
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
