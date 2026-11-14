import { test } from './layout-test';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { textDefects } from './layout-helpers';

// Only diagnosed defect families become expected failures. A new kind/owner still
// fails normally. Remove a rule when its owning product slice fixes the defect.
export function knownTextDefect(finding: Awaited<ReturnType<typeof textDefects>>[number]) {
	const { kind, selector, text } = finding;
	if (
		kind === 'broken-word' &&
		text === 'Positions' &&
		selector ===
			'#map-filter-controls-desktop > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(1) > span:nth-child(1)'
	)
		return 'LAYOUT-MOTION-LABEL: desktop Positions heading shrinks to a single-character column';
	if (
		[
			'Estimated positions are unavailable with reduced motion enabled.',
			'Les positions estimées sont indisponibles avec les animations réduites.',
		].includes(text) &&
		((kind === 'inaccessible-ellipsis' &&
			selector ===
				'#map-filter-controls-desktop > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div:nth-child(2) > span:nth-child(1)') ||
			(kind === 'clipped' &&
				selector ===
					'#main > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(1) > div:nth-child(5) > div:nth-child(1)'))
	)
		return 'LAYOUT-MOTION-HINT: reduced-motion explanation truncates in desktop map controls';
	if (
		kind === 'broken-word' &&
		text === 'SOURCE' &&
		selector ===
			'[data-slot="terminal-panel"] > div:nth-child(4) > div:nth-child(1) > span:nth-child(1)'
	)
		return 'LAYOUT-TERMINAL-SOURCE: network source label breaks inside a word on narrow screens';
	if (
		kind === 'inaccessible-ellipsis' &&
		selector.startsWith('[data-slot="terminal-panel"]') &&
		text === 'salle-de-contrôle'
	)
		return 'LAYOUT-TERMINAL: French control-room title truncates without an accessible full title';
	return null;
}
export async function expectLayout(page: Page, info: TestInfo, overlaps: string[]) {
	const defects = await textDefects(page);
	await info.attach('layout-findings', {
		body: JSON.stringify({ defects, overlaps }, null, 2),
		contentType: 'application/json',
	});
	const unknown = defects.filter((finding) => !knownTextDefect(finding));
	// Assert unknown issues before setting expected failure, so known debt cannot
	// absorb a regression elsewhere on the same page.
	expect(unknown, 'unclassified layout defects').toEqual([]);
	const reasons: string[] = [
		...new Set(
			defects
				.map(knownTextDefect)
				.filter((reason): reason is NonNullable<typeof reason> => reason !== null),
		),
	];
	expect(overlaps, 'chart axis labels overlap').toEqual([]);
	for (const description of reasons)
		info.annotations.push({ type: 'defect', description: description! });
	if (reasons.length) test.fail(true, reasons.join('; '));
	expect({ defects, overlaps }).toEqual({ defects: [], overlaps: [] });
}
