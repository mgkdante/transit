import { test } from './layout-test';
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { textDefects } from './layout-helpers';

// Only diagnosed defect families become expected failures. A new kind/owner still
// fails normally. Remove a rule when its owning product slice fixes the defect.
export function knownTextDefect(finding: Awaited<ReturnType<typeof textDefects>>[number]) {
	const { kind, selector, text } = finding;
	if (
		kind === 'clipped' &&
		selector.startsWith('[data-slot="article-header"]') &&
		/^(Network|Hotspots|Alerts|Status|Receipt|Repeat|Réseau|Points chauds|Alertes|Avis|15 juin 2026|État|Reçu|Récidivistes|Récidive|Fixture stop|24|Sherbrooke|Line|Stop)/i.test(
			text,
		)
	)
		return 'LAYOUT-HEADER: detail headline exceeds its clipped header stage';
	if (kind === 'inaccessible-ellipsis' && selector.startsWith('[data-slot="entity-row"]'))
		return 'LAYOUT-LINES: route names truncate without an accessible full name';
	if (kind === 'broken-word' && selector.includes('detail') && /achalandage/i.test(text))
		return 'LAYOUT-OCCUPANCY: French vehicle occupancy label breaks inside a word';
	if (kind === 'broken-word' && finding.owner === 'absent-value')
		return 'LAYOUT-ABSENCE: missing-value notice breaks inside a word';
	if (
		kind === 'clipped' &&
		/^#c\d+-content > div:nth-child\(1\)$/.test(selector) &&
		/^(\d|Slowest|10 %|Daily|Jour|Recent|Récent)/.test(text)
	)
		return 'LAYOUT-CHART: network chart axis exceeds its clipped container';
	if (
		kind === 'clipped' &&
		selector === '[data-slot="blueprint-listing-header"]' &&
		/^(\d+\.\d m|PLAN DE VOIE|ÉCH\.|DWG |CATÉNAIRE)/.test(text)
	)
		return 'LAYOUT-BLUEPRINT: decorative drawing labels clip without an explicit allowance';
	if (
		kind === 'inaccessible-ellipsis' &&
		selector.startsWith('[data-slot="terminal-panel"]') &&
		text === 'salle-de-contrôle'
	)
		return 'LAYOUT-TERMINAL: French control-room title truncates without an accessible full title';
	if (
		(kind === 'broken-word' &&
			selector.startsWith('[data-slot="freshness-stamp"]') &&
			text === 'obsolète') ||
		(kind === 'clipped' && selector.startsWith('#main >') && text === '· obsolète')
	)
		return 'LAYOUT-STALE: French stale stamp breaks or clips in narrow live surfaces';
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
	if (overlaps.length) reasons.push('LAYOUT-AXES: network chart axis labels overlap');
	for (const description of reasons)
		info.annotations.push({ type: 'defect', description: description! });
	if (reasons.length) test.fail(true, reasons.join('; '));
	expect({ defects, overlaps }).toEqual({ defects: [], overlaps: [] });
}
