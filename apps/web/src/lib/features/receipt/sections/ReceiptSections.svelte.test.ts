import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SectionAffected from './SectionAffected.svelte';
import SectionHeadline from './SectionHeadline.svelte';
import SectionNotReported from './SectionNotReported.svelte';
import SectionStateCuts from './SectionStateCuts.svelte';
import SectionTimeOfDay from './SectionTimeOfDay.svelte';
import SectionWorst from './SectionWorst.svelte';
import type { StateCutsVM } from '../selectors/stateCuts';
import type { NotReportedVM } from '../selectors/notReportedLines';

const info = (_key: string, name: string) => ({
	tip: `${name} definition`,
	href: '/metrics',
	label: `About ${name}`,
	linkLabel: 'Read methodology',
});

const headlineProps = {
	kpis: [{ key: 'otp', label: 'On time', value: '82%', size: 'lg' }] as const,
	heading: 'Headline',
	noData: 'No data',
	info,
	locale: 'en' as const,
};

const affectedProps = {
	counts: [{ key: 'routes', label: 'Lines', value: '4' }] as const,
	heading: 'Affected',
	info,
	locale: 'en' as const,
};

const worstProps = {
	worst: {
		route: {
			id: '51',
			title: 'Line 51',
			subtitle: 'Line · 51',
			meta: 'OTP delta −8 pts',
		},
		stop: null,
		hasWorst: true,
	},
	heading: 'Worst',
	info,
	locale: 'en' as const,
};

const timeOfDayProps = {
	rows: [
		{
			key: 'am_peak',
			rank: 1,
			title: 'AM peak',
			severity: 'high',
			value: 12,
			domain: [0, 100],
			unit: '%',
			display: '12.0%',
		},
	] as const,
	heading: 'By time of day',
	subtitle: 'Severe delays',
	caveat: 'Observed service periods only.',
	caveatLabel: 'Caveat',
	info,
	locale: 'en' as const,
};

const stateCutsState: StateCutsVM = {
	completeness: 80,
	completenessDisplay: '80.0%',
	rows: [
		{
			key: 'delivered',
			label: 'Delivered',
			severity: 'watch',
			value: 80,
			domain: [0, 100],
			display: '80.0%',
		},
	],
	hasData: true,
};

const stateCutsProps = {
	state: stateCutsState,
	heading: 'Service delivered',
	completenessLabel: 'Completeness',
	explainer: 'Observed scheduled service.',
	standDown: 'Not available.',
	splitLabel: 'Service states',
	noData: 'No data',
	info,
	locale: 'en' as const,
};

const notReportedList: NotReportedVM = {
	rows: [
		{
			key: '51',
			rank: 1,
			title: 'Line 51',
			subtitle: 'Line',
			severity: 'critical',
			value: 8,
			domain: [0, 20],
			display: '8 scheduled',
			href: '/lines/51',
			ariaLabel: 'View line 51',
		},
	],
	shown: 1,
	total: 1,
	hasData: true,
};

const notReportedProps = {
	list: notReportedList,
	heading: 'Scheduled but never appeared',
	caveat: 'No live-feed reading was observed.',
	shownOfTotal: (shown: number, total: number) => `Showing ${shown} of ${total}`,
};

afterEach(cleanup);

describe('Daily Receipt section heading levels', () => {
	it('keeps h2 as the default for every standalone presenter', () => {
		const views = [
			render(SectionHeadline, { props: headlineProps }),
			render(SectionAffected, { props: affectedProps }),
			render(SectionWorst, { props: worstProps }),
			render(SectionTimeOfDay, { props: timeOfDayProps }),
			render(SectionStateCuts, { props: stateCutsProps }),
			render(SectionNotReported, { props: notReportedProps }),
		];

		for (const view of views) {
			expect(within(view.container).getByRole('heading', { level: 2 })).toBeInTheDocument();
		}
	});

	it('allows every presenter to render an h3 inside an article card', () => {
		const views = [
			render(SectionHeadline, { props: { ...headlineProps, headingLevel: 3 as const } }),
			render(SectionAffected, { props: { ...affectedProps, headingLevel: 3 as const } }),
			render(SectionWorst, { props: { ...worstProps, headingLevel: 3 as const } }),
			render(SectionTimeOfDay, { props: { ...timeOfDayProps, headingLevel: 3 as const } }),
			render(SectionStateCuts, { props: { ...stateCutsProps, headingLevel: 3 as const } }),
			render(SectionNotReported, { props: { ...notReportedProps, headingLevel: 3 as const } }),
		];

		for (const view of views) {
			expect(view.container.querySelector('[data-slot="section-heading"] > h3')).not.toBeNull();
			expect(view.container.querySelector('[data-slot="section-heading"] > h2')).toBeNull();
		}
	});
});

describe('Daily Receipt presenter refinements', () => {
	it('renders the time-of-day caveat as a labeled typed caveat card after the ranking', () => {
		const { container } = render(SectionTimeOfDay, { props: timeOfDayProps });
		const list = container.querySelector('[data-slot="receipt-time-of-day"] [role="list"]');
		const card = container.querySelector('[data-slot="typed-information-card"]');

		expect(list).not.toBeNull();
		expect(card).not.toBeNull();
		expect(card).toHaveAttribute('data-kind', 'caveat');
		expect(
			within(card as HTMLElement).getByRole('heading', { name: 'Caveat' }),
		).toBeInTheDocument();
		expect(card).toHaveTextContent('Observed service periods only.');
		expect(
			list!.compareDocumentPosition(card as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(container.querySelector('.receipt-tod-caveat')).toBeNull();
	});

	it('keeps the not-reported list to one column below 1024px', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/receipt/sections/SectionNotReported.svelte'),
			'utf8',
		);
		const desktopStart = source.indexOf('@media (min-width: 1024px)');

		expect(desktopStart).toBeGreaterThan(-1);
		const base = source.slice(0, desktopStart);
		const desktop = source.slice(desktopStart);
		expect(base).toMatch(
			/\.receipt-not-reported-list\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
		);
		expect(base).not.toMatch(/repeat\(auto-fit/);
		expect(desktop).toMatch(
			/\.receipt-not-reported-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(16rem, 100%\), 1fr\)\)/,
		);
	});

	it('keeps headline metrics one column in a narrow mobile article card', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/receipt/sections/SectionHeadline.svelte'),
			'utf8',
		);
		const twoColumnStart = source.indexOf('@container receipt (min-width: 24rem)');
		const fourColumnStart = source.indexOf('@container receipt (min-width: 46rem)');
		expect(twoColumnStart).toBeGreaterThan(-1);
		expect(fourColumnStart).toBeGreaterThan(twoColumnStart);
		const base = source.slice(0, twoColumnStart);
		const wider = source.slice(twoColumnStart, fourColumnStart);
		const widest = source.slice(fourColumnStart);
		expect(base).toMatch(/\.receipt-metrics\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
		expect(base).not.toMatch(/repeat\(2/);
		expect(wider).toMatch(
			/\.receipt-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
		);
		expect(widest).toMatch(
			/\.receipt-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
		);
	});
});
