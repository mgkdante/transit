import { render, screen, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { OffenderEvidenceRow } from '../selectors/offenderEvidence';
import type { OffenderLadderResult } from '../selectors/offenderLadder';
import { copy as COPY } from '../repeatOffenders.copy';
import RepeatOffendersSection from './RepeatOffendersSection.svelte';

const rankedLadder = {
	spec: {
		kind: 'magnitude-bars',
		mark: 'lollipop',
		title: 'Worst trips',
		locale: 'en',
		domain: [0, 100],
		unit: '%',
		rowLabel: 'Trip',
		xLabel: 'Severe-delay rate',
		rows: [
			{
				key: 'trip-T1-11',
				label: 'Trip T1',
				value: 42,
				severity: 'high',
				href: '/lines/11',
			},
		],
		sort: 'given',
		scale: 'severity',
	},
	total: 1,
	shown: 1,
} satisfies OffenderLadderResult;

const emptyLadder = {
	spec: {
		kind: 'absence',
		title: 'Worst trips',
		locale: 'en',
		reason: 'no-observations',
		variant: 'block',
	},
	total: 0,
	shown: 0,
} satisfies OffenderLadderResult;

const tray = [
	{
		key: 'vehicle-42010',
		title: 'Vehicle 42010',
		subtitle: 'Vehicle · 42010',
		href: '/lines/55',
		ariaLabel: 'View detail for Vehicle 42010',
	},
] as const;

const evidence = [
	{
		key: 'trip-T1-11',
		title: 'Trip T1',
		href: '/lines/11',
		ariaLabel: 'View detail for Trip T1',
		typeId: 'Trip · T1',
		severeRate: '42%',
		confidenceInterval: '35%–45%',
		recurrence: 'Late-prone on 5 of 7 observed days',
		averageDelay: '7.2 min',
		readings: '120',
	},
] satisfies readonly OffenderEvidenceRow[];

const info = {
	tip: 'Severe-delay rate definition',
	href: '/metrics#severe',
	label: 'About the severe-delay rate',
	linkLabel: 'View methodology',
};

const defaultProps = {
	heading: 'Worst trips',
	ladder: rankedLadder,
	tray,
	evidence,
	windowCaption: 'Recurrence read over the latest trailing week of service.',
	info,
	locale: 'en',
	copy: COPY.en,
} satisfies ComponentProps<typeof RepeatOffendersSection>;

function renderSection(overrides: Partial<ComponentProps<typeof RepeatOffendersSection>> = {}) {
	return render(RepeatOffendersSection, {
		props: { ...defaultProps, ...overrides },
	});
}

describe('RepeatOffendersSection article-card body', () => {
	it('renders one supplied ladder followed by one evidence table, with no recurrence list or tabs', () => {
		const { container } = renderSection();

		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByRole('tab')).toBeNull();
		expect(container.querySelectorAll('[data-slot="offender-ladder"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="offender-tray"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="offender-recurrence"]')).toBeNull();
		const ladder = container.querySelector('[data-slot="offender-ladder"]');
		const table = container.querySelector('[data-slot="offender-evidence-table"]');
		expect(container.querySelectorAll('[data-slot="offender-evidence-table"]')).toHaveLength(1);
		expect(ladder?.nextElementSibling).toBe(table);
		expect(screen.getByText(evidence[0].recurrence)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: info.label })).toHaveAttribute(
			'aria-expanded',
			'false',
		);
	});

	it('uses an h3 for its internal heading beneath the parent article-card h2', () => {
		renderSection();

		expect(screen.getByRole('heading', { level: 3, name: /Worst trips/ })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
	});

	it('does not render a local worst-N control', () => {
		renderSection();

		expect(screen.queryByRole('radiogroup')).toBeNull();
		expect(screen.queryByRole('radio')).toBeNull();
	});

	it('keeps the chart inside the parent card interactive boundary', () => {
		const { container } = renderSection();
		const ladder = container.querySelector('[data-slot="offender-ladder"]');

		expect(ladder).toHaveAttribute('data-card-interactive');
	});

	it('shows honest ranked absence while retaining a supplied below-floor tray', () => {
		const { container } = renderSection({ ladder: emptyLadder, evidence: [] });

		expect(container.querySelector('[data-slot="offender-ladder"]')).toBeNull();
		expect(container.querySelector('[data-slot="offender-ladder-empty"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		const belowFloor = container.querySelector('[data-slot="offender-tray"]') as HTMLElement;
		expect(within(belowFloor).getByRole('link', { name: tray[0].ariaLabel })).toHaveAttribute(
			'href',
			'/lines/55',
		);
	});

	it('renders an honest empty state when neither ranked nor below-floor evidence exists', () => {
		const { container } = renderSection({ ladder: emptyLadder, tray: [], evidence: [] });

		expect(container.querySelector('[data-slot="offender-ladder-empty"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="offender-tray"]')).toBeNull();
		expect(container).not.toHaveTextContent(/\b0\b/);
	});
});
