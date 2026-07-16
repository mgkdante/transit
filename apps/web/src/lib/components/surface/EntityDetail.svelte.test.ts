import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tick } from 'svelte';
import EntityDetailHarness from './__fixtures__/EntityDetailHarness.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('https://transit.yesid.dev/lines/24') },
}));

// Regression guard for the signage-active tab look (yesid StationTabs parity).
// EntityDetail's tab strip renders each bits-ui TabsTrigger through a `child`
// snippet <button> so behavior/ARIA stay on bits-ui while the active VISUAL is the
// theme-invariant metro-signage chip (--signage-bg/--signage-text). A vitest can't
// compile the scoped CSS, so we scan the source for the load-bearing pieces (same
// approach as the tabs-trigger variant guard). The rendered behavior is covered by
// the RouteDetail/StopDetail feature tests that mount the real EntityDetail.
const src = readFileSync(
	join(process.cwd(), 'src/lib/components/surface/EntityDetail.svelte'),
	'utf8',
);
const detailShellSrc = readFileSync(
	join(process.cwd(), 'src/lib/components/layout/DetailShell.svelte'),
	'utf8',
);

describe('EntityDetail — signage-active tab pattern', () => {
	it('renders each trigger through a bits-ui child snippet (behavior stays on bits-ui)', () => {
		expect(src).toMatch(/\{#snippet child\(\{ props \}\)\}/);
		expect(src).toContain('class:active={t.key === active}');
	});

	it('paints the active tab with the theme-invariant signage chip', () => {
		expect(src).toContain('--signage-bg');
		expect(src).toContain('--signage-text');
		expect(src).toMatch(
			/\.station-tab\.active\s*\{[\s\S]*?border-bottom-color:\s*var\(--signage-text\)/,
		);
	});

	it('renders one full-width primary strip with one tablist and an inert overflow cue', () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const strip = container.querySelector('[data-slot="entity-detail-tabs"]');

		expect(strip).not.toBeNull();
		expect(strip?.querySelectorAll('[role="tablist"]')).toHaveLength(1);
		expect(strip?.querySelectorAll('[data-slot="entity-detail-tabs-fade"]')).toHaveLength(1);
		expect(strip?.querySelector('[data-slot="entity-detail-tabs-fade"]')).toHaveAttribute(
			'aria-hidden',
			'true',
		);
		expect(detailShellSrc).toMatch(
			/\.detail-shell-toolbar\s*\{[\s\S]*?width:\s*100%[\s\S]*?background:\s*var\(--primary\)/,
		);
		expect(src).toMatch(/overflow-x:\s*auto/);
		expect(src).toMatch(/overscroll-behavior-inline:\s*contain/);
	});

	it('keeps the outer band full bleed while centering a materially narrower tab viewport', () => {
		expect(detailShellSrc).toMatch(
			/\.detail-shell-toolbar\s*\{[\s\S]*?width:\s*100%[\s\S]*?background:\s*var\(--primary\)/,
		);
		expect(src).toMatch(
			/\.entity-tabs\s*\{[\s\S]*?--entity-tabs-max-width:\s*46rem[\s\S]*?width:\s*100%/,
		);
		expect(src).toMatch(
			/\.entity-tabs__scroll\s*\{[\s\S]*?width:\s*min\(100%,\s*var\(--entity-tabs-max-width\)\)[\s\S]*?margin-inline:\s*auto/,
		);
		expect(src).toMatch(/\.entity-tabs\s+:global\(\[role='tablist'\]\)\s*\{[\s\S]*?width:\s*100%/);
		expect(src).toMatch(/\.station-tab\s*\{[\s\S]*?min-height:\s*var\(--size-tap-min\)/);
	});

	it.each([
		{ reduced: false, behavior: 'smooth' },
		{ reduced: true, behavior: 'auto' },
	] as const)(
		'centers the active tab inside only the strip with $behavior movement when reduced motion is $reduced',
		async ({ reduced, behavior }) => {
			const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
			const scrollIntoView = vi.fn();
			Object.defineProperty(globalThis, 'matchMedia', {
				configurable: true,
				value: vi.fn(() => ({
					matches: reduced,
					media: '(prefers-reduced-motion: reduce)',
					addEventListener: vi.fn(),
					removeEventListener: vi.fn(),
				})),
			});

			try {
				const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
				const tabList = screen.getByRole('tablist');
				const scrollport = container.querySelector<HTMLElement>(
					'[data-slot="entity-detail-tabs-scroll"]',
				) as HTMLElement;
				const schedule = screen.getByRole('tab', { name: 'Schedule' });
				const scrollTo = vi.fn();
				Object.defineProperties(scrollport, {
					clientWidth: { configurable: true, value: 200 },
					scrollWidth: { configurable: true, value: 600 },
					scrollTo: { configurable: true, value: scrollTo },
				});
				Object.defineProperties(schedule, {
					offsetLeft: { configurable: true, value: 250 },
					offsetWidth: { configurable: true, value: 100 },
					scrollIntoView: { configurable: true, value: scrollIntoView },
				});
				await tick();
				scrollTo.mockClear();

				await fireEvent.click(schedule);

				await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ behavior, left: 200 }));
				expect(scrollIntoView).not.toHaveBeenCalled();
				expect(screen.getByRole('tablist')).toBe(tabList);
				expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
				expect(screen.getByRole('tab', { name: 'Schedule' })).toHaveAttribute(
					'aria-selected',
					'true',
				);
				expect(screen.getByRole('tabpanel')).toHaveTextContent('Schedule pane');
			} finally {
				if (originalMatchMedia) Object.defineProperty(globalThis, 'matchMedia', originalMatchMedia);
				else Reflect.deleteProperty(globalThis, 'matchMedia');
			}
		},
	);

	it('does not activate a tab when a touch gesture horizontally scrolled the strip', async () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const scrollport = container.querySelector<HTMLElement>(
			'[data-slot="entity-detail-tabs-scroll"]',
		);
		expect(scrollport).not.toBeNull();

		await fireEvent.pointerDown(scrollport as HTMLElement, { pointerType: 'touch' });
		(scrollport as HTMLElement).scrollLeft = 32;
		await fireEvent.scroll(scrollport as HTMLElement);
		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel')).toHaveTextContent('Detail pane');

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(screen.getByRole('tab', { name: 'Reliability' })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});

	it('does not activate a tab after a horizontal boundary swipe with no scroll delta', async () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const scrollport = container.querySelector<HTMLElement>(
			'[data-slot="entity-detail-tabs-scroll"]',
		) as HTMLElement;

		await fireEvent.pointerDown(scrollport, { pointerType: 'touch', clientX: 120, clientY: 20 });
		await fireEvent.pointerMove(scrollport, { pointerType: 'touch', clientX: 80, clientY: 22 });
		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel')).toHaveTextContent('Detail pane');
	});
});

describe('EntityDetail — optional article cover', () => {
	it('preserves breadcrumb, back, kicker, header, banner, tabs, and separator in classic mode', () => {
		const { container } = render(EntityDetailHarness);

		expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Back to lines' })).toHaveAttribute('href', '/lines');
		expect(screen.getByText('LINE')).toBeInTheDocument();
		expect(screen.getByTestId('classic-header')).toBeInTheDocument();
		expect(screen.getByText('Service banner')).toBeInTheDocument();
		expect(screen.getAllByRole('tab')).toHaveLength(3);
		expect(screen.getByText('Detail pane')).toBeInTheDocument();
		expect(container.querySelectorAll('[style*="repeating-linear-gradient"]')).toHaveLength(1);
	});

	it('renders the supplied cover in the shared article shell without classic head duplication', () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const cover = screen.getByTestId('article-cover');
		const shell = container.querySelector('[data-slot="detail-shell"]');

		expect(shell).not.toBeNull();
		expect(shell).toContainElement(cover);
		expect(shell?.querySelector('[data-slot="detail-shell-toolbar"]')).not.toBeNull();
		expect(shell?.querySelector('[data-slot="detail-shell-center"]')).not.toBeNull();
		expect(shell?.querySelectorAll('[data-slot="entity-detail-tabs"]')).toHaveLength(1);
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		expect(screen.getAllByRole('link', { name: 'Article back' })).toHaveLength(1);
		expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Back to lines' })).not.toBeInTheDocument();
		expect(screen.queryByText('LINE')).not.toBeInTheDocument();
		expect(screen.queryByTestId('classic-header')).not.toBeInTheDocument();
		expect(container.querySelectorAll('[style*="repeating-linear-gradient"]')).toHaveLength(1);
	});

	it('keeps banner, tabs, panes, and active binding working in article mode', async () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const tabs = container.querySelector<HTMLElement>('[data-slot="entity-detail-tabs"]');
		const toolbar = container.querySelector('[data-slot="detail-shell-toolbar"]');

		expect(screen.getByText('Service banner')).toBeInTheDocument();
		const detailSummary = container.querySelector('[data-slot="detail-shell-summary"]');
		const detailCenter = container.querySelector('[data-slot="detail-shell-center"]');
		expect(detailSummary).toContainElement(screen.getByText('Service banner'));
		expect(detailCenter?.firstElementChild).toBe(detailSummary);
		expect(screen.getByText('Detail pane')).toBeInTheDocument();
		expect(screen.getByTestId('active-tab')).toHaveTextContent('detail');
		expect(toolbar).toContainElement(tabs as HTMLElement);
		const detailRail = container.querySelector('[data-slot="detail-shell-left"]');
		expect(detailRail).not.toBeNull();
		expect(detailRail?.contains(tabs)).toBe(false);
		expect(detailRail).toHaveTextContent('Detail section');

		await fireEvent.click(screen.getByRole('tab', { name: 'Schedule' }));

		expect(screen.getByText('Schedule pane')).toBeInTheDocument();
		expect(screen.getByTestId('active-tab')).toHaveTextContent('schedule');
		expect(container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(tabs);
		expect(container.querySelector('.detail-shell-grid')).not.toHaveClass(
			'detail-shell-grid--pane-owned',
		);
		expect(container.querySelector('[data-slot="detail-shell-left"]')).toHaveTextContent(
			'Schedule section',
		);

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));

		expect(screen.getByText('Reliability pane')).toBeInTheDocument();
		expect(screen.getByTestId('active-tab')).toHaveTextContent('reliability');
		expect(container.querySelector('[data-slot="detail-shell-toolbar"]')).toContainElement(tabs);
		expect(container.querySelector('.detail-shell-grid')).toHaveClass(
			'detail-shell-grid--pane-owned',
		);
		expect(container.querySelector('[data-slot="detail-shell-left"]')).toBeNull();
		expect(container.querySelectorAll('[data-slot="entity-detail-tabs"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="detail-shell-summary"]')).toBeNull();
		const reliabilityLayout = container.querySelector('[data-slot="reliability-rail-layout"]');
		const reliabilityRail = reliabilityLayout?.querySelector('[data-slot="surface-rail"]');
		const reliabilityContent = reliabilityLayout?.querySelector(
			'[data-slot="reliability-rail-content"]',
		);
		const reliabilitySummary = reliabilityLayout?.querySelector(
			'[data-slot="reliability-rail-summary"]',
		);
		expect(reliabilityRail?.parentElement).toBe(reliabilityLayout);
		expect(reliabilityContent?.parentElement).toBe(reliabilityLayout);
		expect(reliabilityContent?.firstElementChild).toBe(reliabilitySummary);
		expect(reliabilitySummary).toContainElement(screen.getByText('Service banner'));
		expect(screen.getAllByText('Service banner')).toHaveLength(1);
	});

	it('hands the outer summary lane to non-rail panes and stands it down for pane-owned rails', () => {
		expect(src).toContain('summary={paneOwnsRail || !banner ? undefined : articleSummary}');
		const articleCenter = src.match(/\{#snippet articleCenter\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1];
		expect(articleCenter).not.toContain('{#if banner}');
	});

	it('moves the first card to the shared top edge when optional verdict data is absent', async () => {
		const { container } = render(EntityDetailHarness, {
			props: { mode: 'article', withBanner: false },
		});

		expect(container.querySelector('[data-slot="detail-shell-summary"]')).toBeNull();
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		expect(center.querySelector('[data-toc="detail-section"]')).not.toBeNull();

		await fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
		expect(container.querySelector('[data-slot="reliability-rail-summary"]')).toBeNull();
		expect(container.querySelector('[data-toc="reliability-section"]')).not.toBeNull();
	});

	it('removes the legacy pane inset only in article mode so the rail and first card align', () => {
		const { container } = render(EntityDetailHarness, {
			props: { mode: 'article', withBanner: false },
		});
		const activePane = container.querySelector('.surface-pane[data-state="active"]');

		expect(activePane).toHaveClass('surface-pane--article');
		expect(src).toMatch(/\.surface-pane--article\)\s*\{[^}]*padding-top:\s*0/s);
	});

	it('lets the shared summary lane own verdict-to-card spacing without a second margin', () => {
		const { container } = render(EntityDetailHarness, { props: { mode: 'article' } });
		const articleBanner = container.querySelector(
			'[data-slot="detail-shell-summary"] [data-slot="entity-detail-banner"]',
		);

		expect(articleBanner).toHaveClass('surface-banner--article');
		expect(src).toMatch(/\.surface-banner--article\s*\{[^}]*margin:\s*0/s);
	});

	it('defines the shared tab body once', () => {
		expect(src.match(/<Tabs bind:value=\{active\}>/g)).toHaveLength(1);
		expect(src.match(/<TabsContent value=\{t\.key\}/g)).toHaveLength(1);
	});

	it('rebinds persisted ToC disclosure state when client navigation changes entity keys', async () => {
		const firstKey = 'entity-route-24-toc-test';
		const secondKey = 'entity-route-51-toc-test';
		sessionStorage.removeItem(`transit.persisted:${firstKey}`);
		sessionStorage.removeItem(`transit.persisted:${secondKey}`);

		const view = render(EntityDetailHarness, {
			props: { mode: 'article', sectionKey: firstKey },
		});
		const firstToggle = screen.getByRole('button', { name: 'On this page' });
		expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(firstToggle);
		expect(sessionStorage.getItem(`transit.persisted:${firstKey}`)).toBe('false');

		await view.rerender({ mode: 'article', sectionKey: secondKey });
		const secondToggle = screen.getByRole('button', { name: 'On this page' });
		expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(secondToggle);
		expect(sessionStorage.getItem(`transit.persisted:${secondKey}`)).toBe('false');
		expect(sessionStorage.getItem(`transit.persisted:${firstKey}`)).toBe('false');

		sessionStorage.removeItem(`transit.persisted:${firstKey}`);
		sessionStorage.removeItem(`transit.persisted:${secondKey}`);
	});
});
