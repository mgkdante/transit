import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import type { Manifest, NetworkFile } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import HomeHero from './HomeHero.svelte';
import { homeCopy } from './home.copy';

const { state } = vi.hoisted(() => ({
	state: {
		network: null as NetworkFile | null,
	},
}));

vi.mock('$lib/v1/live/store.svelte', async () => {
	const { emptyLiveIndex } =
		await vi.importActual<typeof import('$lib/v1/live/index')>('$lib/v1/live/index');
	return {
		createLiveStore: () => ({
			vehicles: null,
			trips: null,
			departures: null,
			alerts: null,
			network: state.network,
			index: emptyLiveIndex(),
			generatedUtc: state.network?.generated_utc ?? null,
			ageSeconds: 12,
			isStale: false,
			loading: false,
			error: null,
			start: vi.fn(),
			stop: vi.fn(),
			refresh: vi.fn(),
		}),
	};
});

const manifest = {
	provider: 'demo',
	display_name: 'Demo Transit',
	short_name: 'Demo',
	city: 'Testville',
	bbox: [],
	attribution: 'Demo data',
	dataset_version: 'v-test',
	labels: {},
	files: {
		live: { generated_utc: '2026-06-20T12:00:00Z' as IsoUtc, ttl_s: 30 },
		static: { generated_utc: '2026-06-20T06:00:00Z' as IsoUtc },
	},
	surfaces: [],
} satisfies Manifest;

const liveNetwork = {
	generated_utc: '2026-06-20T12:00:00Z' as IsoUtc,
	vehicles_in_service: 412,
	on_time_pct: 83,
	status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
	delay_p50_min: 1,
	delay_p90_min: 6,
	non_responding: 7,
	feed_freshness_s: 20,
	coverage_pct: 94,
	occupancy_mix: { empty: 0.1, many_seats: 0.65, few_seats: 0.17, standing: 0.08, full: 0 },
} satisfies NetworkFile;

const componentSource = readFileSync(resolve(import.meta.dirname, 'HomeHero.svelte'), 'utf8');
const dataTableSource = readFileSync(
	resolve(import.meta.dirname, '../../components/data/DataTable.svelte'),
	'utf8',
);

function normalizedText(element: Element | null): string | null {
	return element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
}

interface SourceRule {
	readonly selector: string;
	readonly declarations: ReadonlyMap<string, string>;
}

function sourceRules(source: string): readonly SourceRule[] {
	const css = parse(source, { modern: true }).css;
	if (css == null) return [];
	const rules: SourceRule[] = [];

	function visit(nodes: readonly (AST.CSS.Atrule | AST.CSS.Rule | AST.CSS.Declaration)[]): void {
		for (const node of nodes) {
			if (node.type === 'Atrule') {
				visit(node.block?.children ?? []);
				continue;
			}
			if (node.type !== 'Rule') continue;
			const declarations = new Map(
				node.block.children
					.filter((child): child is AST.CSS.Declaration => child.type === 'Declaration')
					.map((child) => [child.property, child.value]),
			);
			for (const selector of node.prelude.children) {
				rules.push({
					selector: source.slice(selector.start, selector.end).replace(/\s+/g, ' ').trim(),
					declarations,
				});
			}
		}
	}

	visit(css.children);
	return rules;
}

const componentRules = sourceRules(componentSource);
const dataTableRules = sourceRules(dataTableSource);
const HEADER_TYPOGRAPHY_PROPERTIES = new Set([
	'color',
	'font',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'letter-spacing',
	'line-height',
	'text-align',
	'text-transform',
	'white-space',
	'word-spacing',
]);

type Specificity = readonly [ids: number, classLikes: number, elements: number];

function normalizedSelector(selector: string): string {
	return selector.replace(/:global\(([^()]*)\)/g, '$1');
}

function specificity(selector: string): Specificity {
	const normalized = normalizedSelector(selector);
	const ids = normalized.match(/#[\w-]+/g)?.length ?? 0;
	const classes = normalized.match(/\.[\w-]+/g)?.length ?? 0;
	const attributes = normalized.match(/\[[^\]]+\]/g)?.length ?? 0;
	const withoutNonElements = normalized
		.replace(/#[\w-]+/g, ' ')
		.replace(/\.[\w-]+/g, ' ')
		.replace(/\[[^\]]+\]/g, ' ')
		.replace(/::?[\w-]+(?:\([^)]*\))?/g, ' ')
		.replace(/[>*+~,]/g, ' ');
	const elements = withoutNonElements.match(/\b[a-z][\w-]*\b/gi)?.length ?? 0;
	return [ids, classes + attributes, elements];
}

function compareSpecificity(left: Specificity, right: Specificity): number {
	for (let index = 0; index < left.length; index += 1) {
		const difference = left[index] - right[index];
		if (difference !== 0) return difference;
	}
	return 0;
}

function borderCascade(element: Element) {
	const candidates = [
		...dataTableRules.map((rule) => ({ owner: 'DataTable', rule })),
		...componentRules.map((rule) => ({ owner: 'HomeHero', rule })),
	]
		.filter(
			(candidate) =>
				candidate.rule.declarations.has('border') &&
				element.matches(normalizedSelector(candidate.rule.selector)),
		)
		.map((candidate) => ({
			owner: candidate.owner,
			selector: candidate.rule.selector,
			value: candidate.rule.declarations.get('border')!,
			specificity: specificity(candidate.rule.selector),
		}));
	const strongest = (owner: string) =>
		candidates
			.filter((candidate) => candidate.owner === owner)
			.sort((left, right) => compareSpecificity(left.specificity, right.specificity))
			.at(-1);
	const consumer = strongest('HomeHero');
	const shared = strongest('DataTable');
	const consumerOutranksShared =
		consumer != null &&
		(shared == null || compareSpecificity(consumer.specificity, shared.specificity) > 0);
	const winner = consumerOutranksShared ? consumer : shared;
	const winnerToken = winner?.value.match(/var\((--[\w-]+)\)/)?.[1] ?? null;

	return {
		consumerSpecificity: consumer?.specificity ?? null,
		sharedSpecificity: shared?.specificity ?? null,
		consumerOutranksShared,
		winnerToken,
		resolvedColor:
			winnerToken == null
				? null
				: document.documentElement.style.getPropertyValue(winnerToken).trim(),
	};
}

describe('HomeHero pulse DataTable', () => {
	it('renders Fleet status as the sole caption-named wash ledger with subtle gridlines', () => {
		const rootStyle = document.documentElement.style;
		const rootVariables = ['--border', '--border-subtle'].map((name) => ({
			name,
			value: rootStyle.getPropertyValue(name),
			priority: rootStyle.getPropertyPriority(name),
		}));
		const sharedBorderColor = 'rgb(201, 31, 31)';
		const subtleBorderColor = 'rgb(31, 201, 31)';
		let view: ReturnType<typeof render> | undefined;
		let actual: unknown;

		rootStyle.setProperty('--border', sharedBorderColor);
		rootStyle.setProperty('--border-subtle', subtleBorderColor);
		try {
			state.network = liveNetwork;
			view = render(HomeHero, {
				props: {
					locale: 'en',
					manifest,
					copy: homeCopy('en', manifest),
				},
			});

			const tables = screen.getAllByRole('table', { name: 'Fleet status' });
			const table = tables[0];
			const outer = table.closest('.pulse-dist');
			const frame = table.parentElement;
			const headerTypographyOwners = componentRules
				.filter(
					(rule) =>
						rule.selector.includes('.pulse-dist-table') &&
						/\b(?:th|td)\b/.test(rule.selector) &&
						[...rule.declarations.keys()].some((property) =>
							HEADER_TYPOGRAPHY_PROPERTIES.has(property),
						),
				)
				.map((rule) => rule.selector);
			const trackingDeclarations = componentRules.flatMap((rule) => {
				if (
					!rule.selector.includes('.pulse-dist-table thead th') &&
					rule.selector !== '.pulse-dist-status'
				)
					return [];
				const value = rule.declarations.get('letter-spacing');
				return value == null ? [] : [{ selector: rule.selector, value }];
			});
			const cellBorderCascades = Array.from(table.querySelectorAll('th, td')).map(borderCascade);

			actual = {
				tableCount: tables.length,
				caption: normalizedText(table.querySelector('caption')),
				tableContract: {
					hasPulseClass: table.classList.contains('pulse-dist-table'),
					slot: table.getAttribute('data-slot'),
				},
				outerExists: outer != null,
				namedGroupCount: screen.queryAllByRole('group', { name: 'Fleet status' }).length,
				outer: {
					role: outer?.getAttribute('role') ?? null,
					ariaLabel: outer?.getAttribute('aria-label') ?? null,
				},
				frame: {
					headerBand: frame?.getAttribute('data-header-band') ?? null,
					frame: frame?.getAttribute('data-frame') ?? null,
					responsive: frame?.getAttribute('data-responsive') ?? null,
					collapse: frame?.getAttribute('data-collapse') ?? null,
				},
				columnHeaders: Array.from(table.querySelectorAll('thead th')).map(normalizedText),
				body: Array.from(table.querySelectorAll('tbody tr')).map((row) => {
					const label = row.querySelector(':scope > th');
					const value = row.querySelector(':scope > td');
					return {
						label: normalizedText(label),
						labelTag: label?.tagName ?? null,
						labelScope: label?.getAttribute('scope') ?? null,
						value: normalizedText(value),
						valueTag: value?.tagName ?? null,
					};
				}),
				borderCascade: {
					table: borderCascade(table),
					cells: {
						allConsumerOutrankShared: cellBorderCascades.every(
							(result) => result.consumerOutranksShared,
						),
						consumerSpecificities: [
							...new Set(cellBorderCascades.map((result) => result.consumerSpecificity?.join(','))),
						],
						sharedSpecificities: [
							...new Set(cellBorderCascades.map((result) => result.sharedSpecificity?.join(','))),
						],
						winnerTokens: [...new Set(cellBorderCascades.map((result) => result.winnerToken))],
						resolvedColors: [...new Set(cellBorderCascades.map((result) => result.resolvedColor))],
					},
				},
				headerTypographyOwners,
				trackingDeclarations,
			};
		} finally {
			view?.unmount();
			state.network = null;
			for (const { name, value, priority } of rootVariables) {
				if (value === '') rootStyle.removeProperty(name);
				else rootStyle.setProperty(name, value, priority);
			}
		}

		expect(actual).toEqual({
			tableCount: 1,
			caption: 'Fleet status',
			tableContract: {
				hasPulseClass: true,
				slot: 'home-pulse-dist-table',
			},
			outerExists: true,
			namedGroupCount: 0,
			outer: { role: null, ariaLabel: null },
			frame: {
				headerBand: 'wash',
				frame: 'gridlines',
				responsive: 'none',
				collapse: 'collapse',
			},
			columnHeaders: ['status', 'vehicles'],
			body: [
				{ label: 'Early', labelTag: 'TH', labelScope: 'row', value: '0', valueTag: 'TD' },
				{ label: 'On-time', labelTag: 'TH', labelScope: 'row', value: '8', valueTag: 'TD' },
				{ label: 'Late', labelTag: 'TH', labelScope: 'row', value: '2', valueTag: 'TD' },
				{ label: 'Severe', labelTag: 'TH', labelScope: 'row', value: '0', valueTag: 'TD' },
				{ label: 'Unknown', labelTag: 'TH', labelScope: 'row', value: '0', valueTag: 'TD' },
			],
			borderCascade: {
				table: {
					consumerSpecificity: [0, 4, 0],
					sharedSpecificity: [0, 3, 0],
					consumerOutranksShared: true,
					winnerToken: '--border-subtle',
					resolvedColor: subtleBorderColor,
				},
				cells: {
					allConsumerOutrankShared: true,
					consumerSpecificities: ['0,4,1'],
					sharedSpecificities: ['0,3,1'],
					winnerTokens: ['--border-subtle'],
					resolvedColors: [subtleBorderColor],
				},
			},
			headerTypographyOwners: ['.pulse-dist :global(.pulse-dist-table thead th)'],
			trackingDeclarations: [
				{
					selector: '.pulse-dist :global(.pulse-dist-table thead th)',
					value: 'var(--tracking-eyebrow)',
				},
				{ selector: '.pulse-dist-status', value: 'var(--tracking-eyebrow)' },
			],
		});
	});
});
