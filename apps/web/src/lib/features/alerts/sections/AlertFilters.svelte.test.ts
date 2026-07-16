import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { alertHistoryCopy } from '../alerts.copy';
import AlertFilters from './AlertFilters.svelte';

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/features/alerts/sections/AlertFilters.svelte'),
	'utf8',
);

const executableSource = source
	.replace(/<!--[\s\S]*?-->/g, '')
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/\/\/.*$/gm, '');

function props(overrides: Record<string, unknown> = {}) {
	return {
		affects: 'all',
		severity: 'all',
		route: null,
		stop: null,
		window: { from: '2026-06-01', to: '2026-06-30' },
		lineOptions: [],
		stopOptions: [],
		availableDates: ['2026-01-01', '2026-07-13'],
		filtersActive: false,
		matchCount: 2,
		copy: alertHistoryCopy.en,
		locale: 'en',
		historyCoverageText: 'Archive coverage: Jan 1 to Jul 13, 2026',
		historySelectionText: 'Selected: Jun 1 to Jun 30, 2026',
		historyAnnouncement: null,
		onWindowChange: vi.fn(),
		onClear: vi.fn(),
		...overrides,
	};
}

describe('AlertFilters history composition', () => {
	it('uses the shared control stack with history first and joined primary filters', () => {
		const { container } = render(AlertFilters, {
			props: props() as never,
		});

		const stack = container.querySelector('[data-slot="article-control-stack"]');
		expect(stack).not.toBeNull();
		expect(
			Array.from(stack?.children ?? []).map((region) => region.getAttribute('data-region')),
		).toEqual(['history', 'primary', 'secondary']);

		const history = container.querySelector('[data-slot="window-pick"]') as HTMLElement;
		const affects = within(container).getByText('Affects');
		expect(history).not.toBeNull();
		expect(history.compareDocumentPosition(affects) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

		const joinedGroups = container.querySelectorAll(
			'[data-region="primary"] [data-slot="segmented-choice"][data-variant="joined-grid"]',
		);
		expect(joinedGroups).toHaveLength(2);
		expect(joinedGroups[0]).toHaveAttribute('data-segment-count', '3');
		expect(joinedGroups[1]).toHaveAttribute('data-segment-count', '4');
	});

	it('delegates outer control order and spacing without page-local stack geometry', () => {
		expect(executableSource).toMatch(
			/import\s*\{[^}]*\bArticleControlStack(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"]\$lib\/components\/surface['"]/,
		);
		expect(executableSource.match(/variant="joined-grid"/g)).toHaveLength(2);
		const localBodyRule = source.match(/\.alert-filters-body\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		expect(localBodyRule).not.toMatch(/display\s*:\s*(?:flex|grid)/);
		expect(localBodyRule).not.toMatch(/gap\s*:/);
	});

	it('uses one controlled HistoryNavigator and forwards a normalized complete range', async () => {
		const onWindowChange = vi.fn();
		const view = render(AlertFilters, {
			props: props({ onWindowChange }) as never,
		});
		const { container } = view;
		const navigator = container.querySelector('[data-slot="history-navigator"]') as HTMLElement;

		expect(navigator).not.toBeNull();
		expect(container.querySelectorAll('[data-slot="history-navigator"]')).toHaveLength(1);
		expect(
			within(navigator).getByText('Archive coverage: Jan 1 to Jul 13, 2026'),
		).toBeInTheDocument();
		expect(within(navigator).getByText('Selected: Jun 1 to Jun 30, 2026')).toBeInTheDocument();

		await fireEvent.change(within(navigator).getByLabelText('Alert history range · From'), {
			target: { value: '2026-05-01' },
		});
		await view.rerender(
			props({
				onWindowChange,
				window: { from: '2026-05-01', to: '2026-06-30' },
			}) as never,
		);
		await fireEvent.change(within(navigator).getByLabelText('Alert history range · To'), {
			target: { value: '2026-05-31' },
		});
		expect(onWindowChange).toHaveBeenLastCalledWith({
			from: '2026-05-01',
			to: '2026-05-31',
		});
	});

	it('owns no URL, resource, rail, disclosure, or duplicate date-picker state', () => {
		expect(executableSource).toMatch(
			/import\s*\{[^}]*\bHistoryNavigator(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"]\$lib\/components\/surface['"]/,
		);
		expect(executableSource).not.toMatch(
			/import\s*\{[^}]*\bDateRangePicker(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"]\$lib\/components\/surface['"]/,
		);
		expect(executableSource).not.toMatch(/from\s+['"]\$app\/(?:state|navigation)['"]/);
		expect(executableSource).not.toMatch(/from\s+['"]\$lib\/v1\/resource\.svelte['"]/);
		expect(executableSource).not.toMatch(/\bmirrorSearchParams\s*\(/);
		expect(executableSource).not.toMatch(
			/import\s*\{[^}]*\bSurfaceRail(?:\s+as\s+\w+)?[^}]*\}\s*from/,
		);
		expect(executableSource).not.toMatch(/\bCollapsibleSection\b/);
		expect(executableSource).not.toMatch(/\$state(?:\.|\s*\()/);
	});
});
