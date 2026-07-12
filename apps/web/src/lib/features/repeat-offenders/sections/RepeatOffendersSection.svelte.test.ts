import { render, screen, within } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { describe, expect, it } from 'vitest';
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

const recurrence = [
	{
		key: 'trip-T1-11',
		label: 'Trip T1',
		text: 'Late-prone on 5 of 7 observed days',
	},
] as const;

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
	recurrence,
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
	it('renders exactly one supplied ladder, tray, and recurrence list without tabs', () => {
		const { container } = renderSection();

		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByRole('tab')).toBeNull();
		expect(container.querySelectorAll('[data-slot="offender-ladder"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="offender-tray"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="offender-recurrence"]')).toHaveLength(1);
		expect(screen.getByText(recurrence[0].text)).toBeInTheDocument();
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
		const { container } = renderSection({ ladder: emptyLadder, recurrence: [] });

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
		const { container } = renderSection({ ladder: emptyLadder, tray: [], recurrence: [] });

		expect(container.querySelector('[data-slot="offender-ladder-empty"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="offender-tray"]')).toBeNull();
		expect(container).not.toHaveTextContent(/\b0\b/);
	});
});
