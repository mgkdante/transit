// MetricsExplainer.svelte.test.ts: the /metrics screen, DOM gate.
//
// The explainer is now built on the yesid.dev blog/project detail-page shell:
// the shared CollapsibleSection cards + the shared TocNav rail + the shared
// TocPill mobile pill (all from $lib/components/shared, on transit tokens/i18n).
//
// It renders, in EN (getLocale() defaults to DEFAULT_LOCALE without a provider,
// same as the other feature-screen tests): the surface head, the provenance
// preamble + confidence legend, a sticky TOC rail (a TocNav with one jump button
// per metric, badge-numbered) and one anchored CollapsibleSection card per metric
// carrying the definition / math / SQL / "what it's NOT" / caveats cards. The SQL
// rides the shared typed-card terminal chrome. A mobile floating pill opens the
// same jump-nav as a drawer.
//
// These are the affordances the (i) tip deep-links into (/metrics#<anchor>), so
// every anchor must exist as an in-page element id and stay reachable.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import MetricsExplainer from './MetricsExplainer.svelte';
import { METRICS } from './metrics.content';
import { metricsCopy } from './metrics.copy';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

// The explainer now reads the provider's feed-conformance verdict off
// provenance.json for the honesty-layer badge. Stub the data ports so this DOM
// gate stays env-free (the real $lib/v1 chain reads $env/dynamic/public) and
// off-network. data:null → no conformance → the badge renders nothing, leaving
// every assertion below about the static article untouched.
const { provState } = vi.hoisted(() => ({
	provState: {
		data: null as {
			generated_utc: string;
			conformance: { status: string; extra_row_count: number; unknown_members: string[] };
			methodology: Record<string, unknown>;
		} | null,
	},
}));

vi.mock('$lib/v1', () => ({
	getProvenance: vi.fn(),
	getV1Context: () => ({
		manifest: { short_name: 'STM', display_name: 'STM', dataset_version: 'test' },
	}),
}));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		get data() {
			return provState.data;
		},
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

const en = metricsCopy.en;

// P5-R R3 — the page is DEFAULT-OPEN with per-card persisted open-state
// (sessionStorage key `transit.persisted:metrics-card-<anchor>`), plus the ToC's
// own `metrics-toc` key and the ONE site-wide collapsed-default preference
// ('transit:quiet-mode', owned by the shared quietModeStore — a module
// singleton whose state would leak between tests). `persisted()` seeds
// synchronously from sessionStorage, so wipe every relevant key AND reset the
// store before + after each test so every render starts from the true default
// (all cards open, ToC open, bulk collapse off) and no stale hash lingers.
const CARD_ANCHORS = [
	'metrics-provenance',
	...METRICS.map((m) => m.anchor),
	'live-positions',
	'structural-gaps',
];
function resetMetricsStorage(): void {
	provState.data = null;
	for (const anchor of CARD_ANCHORS) {
		sessionStorage.removeItem(`transit.persisted:metrics-card-${anchor}`);
	}
	for (const rail of ['provenance', 'coverage', 'freshness']) {
		sessionStorage.removeItem(`transit.persisted:metrics-rail-${rail}`);
	}
	sessionStorage.removeItem('transit.persisted:metrics-toc');
	quietModeStore.resetForTest();
	if (window.location.hash) window.location.hash = '';
}
beforeEach(resetMetricsStorage);
afterEach(resetMetricsStorage);

describe('MetricsExplainer', () => {
	it('scopes the narrow freshness label treatment to the Metrics freshness rail', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/metrics/MetricsExplainer.svelte'),
			'utf8',
		);
		expect(source).toMatch(
			/\.metrics-stat__body\[data-slot='stat-freshness'\]\s*:global\(\.freshness-stamp-label\)\s*\{[\s\S]*?flex-shrink:\s*0[\s\S]*?white-space:\s*nowrap/,
		);
	});

	it('stacks every mobile summary rail card in one full-width grid row', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/metrics/MetricsExplainer.svelte'),
			'utf8',
		);

		expect(source).toMatch(
			/:global\(\.detail-shell-mobile-summary\) \.metrics-stat-rail\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
		);
		expect(source).toMatch(
			/:global\(\.detail-shell-mobile-summary\)[\s\S]*?\.metrics-stat-rail[\s\S]*?> :global\(\[data-slot='card'\]\)\s*\{[^}]*width:\s*100%;/,
		);
		expect(source).not.toMatch(/flex:\s*1 1 12rem/);
	});

	it('keeps every information kind in one foreground stack at every width', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/metrics/MetricsExplainer.svelte'),
			'utf8',
		);
		expect(source).toMatch(
			/\.metric__paired-information\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column/,
		);
		expect(source).not.toMatch(
			/\.metric__paired-information\s*\{[^}]*grid-template-columns:/,
		);
		expect(source).not.toMatch(
			/\.metric__paired-information\s*>\s*:global\(\[data-slot='typed-information-card'\]\)\s*\{[^}]*height:\s*100%/,
		);
		expect(source).not.toMatch(
			/\.metric__prose--mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/,
		);
		expect(source).not.toMatch(
			/\.(?:metric__prose--mono|metric__not|metric__pipeline-note|metric__caveats)\s*\{[^}]*color:\s*var\(--muted-foreground\)/,
		);
	});

	it('renders the shared article header with metrics keywords, back link, and body lede', () => {
		const { container } = render(MetricsExplainer);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;

		expect(header).not.toBeNull();
		expect(within(header).getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(within(header).getByRole('link', { name: en.article.back })).toHaveAttribute(
			'href',
			'/',
		);
		const keywords = within(header).getByRole('list', { name: en.article.tagsAria });
		for (const keyword of en.article.tags) {
			expect(within(keywords).getByText(keyword)).toBeInTheDocument();
		}
		expect(header.querySelector('.detail-header-grid')).not.toBeNull();
		expect(header.querySelector('[data-testid="manifesto-canvas"]')).not.toBeNull();

		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		expect(within(center).getByText(en.lede)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell-header"]')).toBeNull();
		expect(container.textContent).not.toMatch(/blueprint/i);
		expect(container.querySelector('[data-slot="detail-shell"]')?.parentElement).toBe(container);
	});

	it('renders exactly the two source controls and no metrics-only third control', async () => {
		const { container } = render(MetricsExplainer);
		const header = container.querySelector('[data-slot="article-header"]') as HTMLElement;
		expect(within(header).getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
		expect(
			within(header).getByRole('button', { name: 'Always start collapsed' }),
		).toBeInTheDocument();
		expect(within(header).queryByTestId('metrics-expand-all')).toBeNull();
	});

	it('places the lede and methodology inside the opening provenance card', () => {
		const { container } = render(MetricsExplainer);
		const center = container.querySelector('[data-slot="detail-shell-center"]') as HTMLElement;
		const trigger = within(center).getByRole('button', { name: en.provenance.label });
		const card = trigger.closest('[data-slot="card"]') as HTMLElement;
		expect(within(card).getByText(en.lede)).toBeInTheDocument();
		expect(within(card).getByText(en.provenance.body)).toBeInTheDocument();
		expect(card).toHaveAttribute('data-toc', 'metrics-provenance');
	});

	it('renders the surface head + provenance preamble', () => {
		const { container } = render(MetricsExplainer);

		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.provenance.body)).toBeInTheDocument();
		// Both confidence-level chips appear in the legend.
		expect(container.textContent).toContain(en.confidence.levels.proxy.meaning);
		expect(container.textContent).toContain(en.confidence.levels.medium.meaning);
	});

	it('re-seats onto the DetailShell 3-col shell (left ToC rail · center sections · right stat rail)', () => {
		const { container } = render(MetricsExplainer);

		// P5.4c: the surface is now a DetailShell. The left rail carries the ToC,
		// the center carries the sections column, the right rail carries the stat cards.
		const grid = container.querySelector('.detail-shell-grid') as HTMLElement;
		expect(grid).not.toBeNull();
		expect(grid.querySelector('[data-slot="detail-shell-left"] .metrics-toc-rail')).not.toBeNull();
		expect(grid.querySelector('[data-slot="detail-shell-center"] .sections-column')).not.toBeNull();
		expect(
			grid.querySelector('[data-slot="detail-shell-right"] .metrics-stat-rail'),
		).not.toBeNull();
	});

	it('opts every Metrics section and stat card into article-summary headers', () => {
		provState.data = {
			generated_utc: '2026-07-11T04:00:00Z',
			conformance: { status: 'conformant', extra_row_count: 0, unknown_members: [] },
			methodology: {},
		};
		const { container } = render(MetricsExplainer);
		const sectionCards = Array.from(
			container.querySelectorAll<HTMLElement>(
				'[data-testid="metrics-sections"] .section-block > [data-slot="card"]',
			),
		);
		const railCards = Array.from(
			container.querySelectorAll<HTMLElement>('.metrics-stat-rail > [data-slot="card"]'),
		);

		expect(sectionCards).toHaveLength(METRICS.length + 3);
		expect(railCards).toHaveLength(6);
		for (const card of [...sectionCards, ...railCards]) {
			expect(card).toHaveAttribute('data-header-variant', 'article-summary');
		}
		expect(
			container.querySelector('.metrics-toc-rail [data-header-variant="article-summary"]'),
		).toBeNull();
	});

	it('keeps a metric one-liner linked to its article-summary trigger across collapse', async () => {
		const first = METRICS[0];
		const { container } = render(MetricsExplainer);
		const card = container.querySelector(
			`#${CSS.escape(first.anchor)} > [data-slot="card"][data-header-variant="article-summary"]`,
		) as HTMLElement;
		const trigger = card?.querySelector(
			'h2.section-heading > button.section-header',
		) as HTMLButtonElement;

		expect(card).not.toBeNull();
		expect(trigger).toHaveAccessibleName(first.name.en);
		const subtitleId = trigger.getAttribute('aria-describedby') ?? '';
		expect(subtitleId).not.toBe('');
		const subtitle = card.querySelector(`#${CSS.escape(subtitleId)}`) as HTMLElement;
		expect(subtitle).toBeVisible();
		expect(subtitle.textContent?.trim()).toBe(first.oneLiner.en);
		expect(subtitle).toHaveAttribute('data-state', 'open');

		await fireEvent.click(trigger);

		expect(subtitle).toHaveAttribute('data-state', 'closed');
		expect(subtitle.textContent?.trim()).toBe(first.oneLiner.en);
	});

	it('renders the desktop TOC rail with one numbered jump button per metric', () => {
		const { container } = render(MetricsExplainer);

		// The TocNav lives in the desktop left rail; its jump items are buttons (not
		// links, the shared TocNav drives scroll via onNavigate, not href). One
		// per metric, each labelled with the metric name.
		const rail = container.querySelector('.metrics-toc-rail');
		expect(rail).not.toBeNull();
		for (const entry of METRICS) {
			expect(
				within(rail as HTMLElement).getByRole('button', { name: entry.name.en }),
			).toBeInTheDocument();
		}
	});

	it('renders every anchored metric with the exact typed-card anatomy and terminal SQL', () => {
		const { container } = render(MetricsExplainer);

		for (const entry of METRICS) {
			// The deep-link target: a section block carrying the metric anchor as its
			// element id (so /metrics#<anchor> scrolls here natively).
			const block = container.querySelector(`#${CSS.escape(entry.anchor)}`);
			expect(block, `section block #${entry.anchor}`).not.toBeNull();

			// Inside it, the shared CollapsibleSection card carries the same anchor as
			// its data-toc scroll/active-tracking hook + a disclosure trigger button.
			const card = block?.querySelector(`[data-toc="${CSS.escape(entry.anchor)}"]`);
			expect(card, `${entry.anchor} card [data-toc]`).not.toBeNull();
			expect(
				card?.querySelector('[data-slot="collapsible-trigger"]'),
				`${entry.anchor} has a disclosure trigger`,
			).not.toBeNull();

			// Heading + verbatim science survive into the DOM (content is force-mounted
			// by the shared collapsible, so it is present even while collapsed).
			expect(block?.textContent).toContain(entry.name.en);
			expect(block?.textContent).toContain(entry.definition.en);

			const informationCards = Array.from(
				card?.querySelectorAll<HTMLElement>('[data-slot="typed-information-card"]') ?? [],
			);
			expect(
				informationCards.map((informationCard) => informationCard.dataset.kind),
				`${entry.anchor} typed-card kinds`,
			).toEqual(['definition', 'math', 'sql', 'not-really', 'caveat']);

			const sqlCard = informationCards.find(
				(informationCard) => informationCard.dataset.kind === 'sql',
			);
			expect(sqlCard?.querySelector('[data-slot="terminal-panel"]')).toBeInTheDocument();
			const sqlRegion = sqlCard?.querySelector<HTMLElement>('[role="region"]');
			expect(sqlRegion).toHaveAttribute('tabindex', '0');
			expect(sqlRegion?.textContent, `${entry.anchor} SQL remains byte-for-byte`).toBe(entry.sql);
		}
	});

	it('labels each metric section with the definition / math / SQL / caveats overlines', () => {
		const { container } = render(MetricsExplainer);
		const text = container.textContent ?? '';
		expect(text).toContain(en.sections.definition);
		expect(text).toContain(en.sections.math);
		expect(text).toContain(en.sections.sql);
		expect(text).toContain(en.sections.notReally);
		expect(text).toContain(en.sections.caveats);
	});

	it('exposes a mobile floating pill that opens the same jump-nav as a drawer', async () => {
		const { container } = render(MetricsExplainer);

		// The TocPill renders a floating pill (aria-expanded reflects the drawer).
		const pillContainer = container.querySelector('[data-testid="toc-pill"]');
		expect(pillContainer).not.toBeNull();
		const pill = within(pillContainer as HTMLElement).getByRole('button', { expanded: false });

		// No drawer items until the pill is pressed.
		expect(
			within(pillContainer as HTMLElement).queryByRole('button', { name: METRICS[0].name.en }),
		).not.toBeInTheDocument();

		await fireEvent.click(pill);
		expect(pill).toHaveAttribute('aria-expanded', 'true');
		// The drawer hosts the same per-metric jump buttons (one per metric).
		for (const entry of METRICS) {
			expect(
				within(pillContainer as HTMLElement).getByRole('button', { name: entry.name.en }),
			).toBeInTheDocument();
		}

		// Escape dismisses the drawer.
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(pill).toHaveAttribute('aria-expanded', 'false');
	});

	it('mobile pill navigation OPENS the target card through a folded page (review F1)', async () => {
		const { container } = render(MetricsExplainer);
		// Fold the default-open page first so the reveal is observable.
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		const target = METRICS[0];
		const card = container
			.querySelector(`#${CSS.escape(target.anchor)}`)
			?.querySelector('[data-state]');
		expect(card).toHaveAttribute('data-state', 'closed');

		const pillContainer = container.querySelector('[data-testid="toc-pill"]') as HTMLElement;
		await fireEvent.click(within(pillContainer).getByRole('button', { expanded: false }));
		await fireEvent.click(within(pillContainer).getByRole('button', { name: target.name.en }));
		// The drawer routes through the page's open-then-scroll path, so the jump
		// must reveal the card, never land on a shut one.
		expect(card).toHaveAttribute('data-state', 'open');
	});

	it('a malformed hash fragment never throws during mount (review F2)', async () => {
		// Save collapsed mode so the page mounts folded — "nothing opened" is observable.
		localStorage.setItem('transit:quiet-mode', 'true');
		window.location.hash = '#%';
		expect(() => render(MetricsExplainer)).not.toThrow();
		// And nothing opened: the undecodable fragment simply cannot match a card.
		await tick();
		await tick();
		expect(document.querySelectorAll('.section-block [data-state="open"]')).toHaveLength(0);
	});

	it('keeps the TOC entries and the section cards in lock-step (same anchors)', () => {
		const { container } = render(MetricsExplainer);

		// Every metric anchor resolves to exactly one in-page section block, and the
		// rail offers a jump for it (the (i)-tip deep-link contract).
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		for (const entry of METRICS) {
			expect(container.querySelectorAll(`#${CSS.escape(entry.anchor)}`)).toHaveLength(1);
			expect(within(rail).getByRole('button', { name: entry.name.en })).toBeInTheDocument();
		}
	});

	it('renders the structural-gaps ("Lacunes") card with all three named gaps', () => {
		const { container } = render(MetricsExplainer);

		// The card is an anchored section block (deep-linkable like a metric card).
		const block = container.querySelector('#structural-gaps');
		expect(block, 'structural-gaps section block').not.toBeNull();
		expect(
			block?.querySelector('[data-toc="structural-gaps"]'),
			'structural-gaps card [data-toc]',
		).not.toBeNull();

		// Title + lede + the three honest gap headings + bodies survive into the DOM
		// (content is force-mounted by the shared collapsible).
		const text = block?.textContent ?? '';
		expect(text).toContain(en.lacunes.title);
		expect(text).toContain(en.lacunes.lede);
		for (const gap of en.lacunes.gaps) {
			expect(text).toContain(gap.heading);
			expect(text).toContain(gap.body);
		}
		// The three gaps render as a list, each gap an <li> + an <h3> heading (a11y).
		expect(block?.querySelectorAll('.metrics-lacunes__list li')).toHaveLength(3);
		expect(block?.querySelectorAll('.metrics-lacunes__heading')).toHaveLength(3);
	});

	it('registers the structural-gaps section in the desktop TOC rail (after the metrics)', () => {
		const { container } = render(MetricsExplainer);
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;

		// The rail offers a jump to the Lacunes card by its title (one ToC entry).
		expect(within(rail).getByRole('button', { name: en.lacunes.title })).toBeInTheDocument();
	});

	it('renders the live-positions ("almost real-time, not real-time") explainer card with every named point', () => {
		const { container } = render(MetricsExplainer);

		// The on-map "How this works" link deep-links to /metrics#live-positions, so
		// this anchored section block MUST exist as an in-page element id.
		const block = container.querySelector('#live-positions');
		expect(block, 'live-positions section block').not.toBeNull();
		expect(
			block?.querySelector('[data-toc="live-positions"]'),
			'live-positions card [data-toc]',
		).not.toBeNull();

		// Title + lede + every honest sub-point heading + body survive into the DOM
		// (content is force-mounted by the shared collapsible, present while collapsed).
		const text = block?.textContent ?? '';
		expect(text).toContain(en.livePositions.title);
		expect(text).toContain(en.livePositions.lede);
		for (const point of en.livePositions.points) {
			expect(text).toContain(point.heading);
			expect(text).toContain(point.body);
		}
		// Each point renders as a list <li> + an <h3> heading (a11y structure).
		const count = en.livePositions.points.length;
		expect(block?.querySelectorAll('.metrics-live__list li')).toHaveLength(count);
		expect(block?.querySelectorAll('.metrics-live__heading')).toHaveLength(count);
	});

	it('registers the live-positions section in the desktop TOC rail', () => {
		const { container } = render(MetricsExplainer);
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		expect(within(rail).getByRole('button', { name: en.livePositions.title })).toBeInTheDocument();
	});

	it('keeps the live-positions explainer honest (names estimate vs measured, no fabricated certainty)', () => {
		// The whole point is honest framing: the EN copy must say it is an estimate /
		// approximation between reports, that a stale bus freezes with a "!", and that
		// raw shows measured-only. Guard the load-bearing honesty words.
		const joined = [en.livePositions.lede, ...en.livePositions.points.map((p) => p.body)]
			.join(' ')
			.toLowerCase();
		expect(joined).toContain('estimate');
		expect(joined).toContain('approximation');
		expect(joined).toContain('measured');
		expect(joined).toContain('freezes');
		expect(joined).toContain('~20-60 seconds');
	});

	// Helpers: the metric section cards are the shared CollapsibleSection, whose
	// open/closed state is reflected on the disclosure trigger's aria-expanded.
	function metricTriggers(container: HTMLElement): HTMLElement[] {
		const column = container.querySelector('[data-testid="metrics-sections"]') as HTMLElement;
		return Array.from(
			column.querySelectorAll('[data-slot="collapsible-trigger"]'),
		) as HTMLElement[];
	}

	// The desktop ToC rail's OWN collapse trigger. It is the header disclosure
	// trigger inside .metrics-toc-rail — DISTINCT from the metric-card triggers (which
	// live in metrics-sections).
	function tocTrigger(container: HTMLElement): HTMLElement | null {
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		return rail?.querySelector('[data-slot="collapsible-trigger"]') ?? null;
	}

	// The disclosure trigger for a single metric card, keyed by its anchor (the
	// section block carries the anchor as its element id). aria-expanded on this
	// button reflects that ONE card's open/closed state.
	function cardTrigger(container: HTMLElement, anchor: string): HTMLElement | null {
		const block = container.querySelector(`#${CSS.escape(anchor)}`) as HTMLElement | null;
		return block?.querySelector('[data-slot="collapsible-trigger"]') ?? null;
	}

	// ── R3: default-OPEN render (the yesid article contract) ───────────────────
	it('renders every metric card OPEN on a fresh visit (default-open article)', () => {
		const { container } = render(MetricsExplainer);

		const triggers = metricTriggers(container);
		expect(triggers.length).toBeGreaterThan(0);
		for (const trigger of triggers) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
		const firstBody = container.querySelector(
			`#${CSS.escape(METRICS[0].anchor)} [data-slot="collapsible-content"]`,
		);
		expect(firstBody).toHaveAttribute('data-state', 'open');

		// The ToC rail is OPEN by default too.
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
	});

	// ── R3: the hash opener reveals its target through a folded page ───────────
	it('opens the hash-named card on mount even when a saved collapse default folded the page', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		window.location.hash = '#otp';
		const { container } = render(MetricsExplainer);
		// One await for the opener's own deferral (review F3), one for the
		// open-signal effect flush.
		await tick();
		await tick();

		// Saved collapsed mode restored → the page folded; the deep-linked card still opens
		// (quiet folds cards but never locks them against explicit intent).
		const quietToggle = screen.getByTestId('quiet-mode-toggle');
		expect(quietToggle).toHaveAttribute('data-collapsed', 'true');
		expect(quietToggle).toHaveTextContent('Expand all');
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
		for (const entry of METRICS.filter((m) => m.anchor !== 'otp')) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
	});

	it('scrolls the hash-named card into position after opening it on mount', async () => {
		// The design contract: a direct load opens the destination BEFORE final
		// positioning. Relying on the native anchor jump alone lands wrong when the
		// remembered collapse reshapes the page after the browser has scrolled.
		const scrollCalls: Array<{ expanded: string | null; args: unknown }> = [];
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		const { container } = await (async () => {
			localStorage.setItem('transit:quiet-mode', 'true');
			window.location.hash = '#otp';
			return render(MetricsExplainer);
		})();
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: function (this: Element, args: unknown) {
				scrollCalls.push({
					expanded: cardTrigger(container, 'otp')!.getAttribute('aria-expanded'),
					args,
				});
			},
		});
		try {
			await vi.waitFor(() => expect(scrollCalls.length).toBeGreaterThanOrEqual(1));
			expect(scrollCalls[0].expanded).toBe('true');
			expect(scrollCalls[0].args).toMatchObject({ block: 'start' });
		} finally {
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('scrolls the newly hash-named card after a same-page hashchange', async () => {
		const { container } = render(MetricsExplainer);
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));

		const scrollCalls: Array<string | null> = [];
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: function (this: Element) {
				scrollCalls.push(cardTrigger(container, 'headway')!.getAttribute('aria-expanded'));
			},
		});
		try {
			window.location.hash = '#headway';
			await fireEvent(window, new HashChangeEvent('hashchange'));
			await vi.waitFor(() => expect(scrollCalls.length).toBeGreaterThanOrEqual(1));
			// The card is already open by the time the positioning scroll fires.
			expect(scrollCalls[0]).toBe('true');
		} finally {
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('scrolls only the latest target when the hash changes again while layout settles', async () => {
		const { container } = render(MetricsExplainer);
		await tick();

		const scrollCalls: Array<string | null> = [];
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: function (this: Element) {
				scrollCalls.push(this.getAttribute('data-toc'));
			},
		});
		try {
			window.history.replaceState(null, '', '#otp');
			await fireEvent(window, new HashChangeEvent('hashchange'));
			window.history.replaceState(null, '', '#headway');
			await fireEvent(window, new HashChangeEvent('hashchange'));

			await vi.waitFor(() => expect(scrollCalls).toEqual(['headway']));
		} finally {
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
			window.history.replaceState(null, '', window.location.pathname);
			void container;
		}
	});

	it('opens another card on a later hashchange without closing the first (folded page)', async () => {
		const { container } = render(MetricsExplainer);
		// Fold everything first so the additive opening is observable.
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}

		window.location.hash = '#otp';
		await fireEvent(window, new HashChangeEvent('hashchange'));
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');

		// A same-page (i) deep-link swaps the hash and fires hashchange (no remount).
		window.location.hash = '#headway';
		await fireEvent(window, new HashChangeEvent('hashchange'));
		expect(cardTrigger(container, 'headway')).toHaveAttribute('aria-expanded', 'true');
		// The first card stays open (opening is additive, not exclusive).
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
	});

	it('opens the provenance card on mount when a saved collapse default folded the page', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		window.location.hash = '#metrics-provenance';
		const { container } = render(MetricsExplainer);
		await tick();
		await tick();

		expect(cardTrigger(container, 'metrics-provenance')).toHaveAttribute('aria-expanded', 'true');
		for (const entry of METRICS) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
	});

	it('ToC navigation opens the target card through a folded page (siblings unaffected)', async () => {
		const { container } = render(MetricsExplainer);
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;

		const target = METRICS[3];
		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(within(rail).getByRole('button', { name: target.name.en }));

		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'true');
		// A different, un-jumped card stays folded.
		expect(cardTrigger(container, METRICS[0].anchor)).toHaveAttribute('aria-expanded', 'false');
	});

	// ── R3: the full yesid contract (collapse all / expand all) ────────────────
	it('Collapse all folds every card + the ToC; Expand all reopens everything', async () => {
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('quiet-mode-toggle');
		expect(toggle).not.toHaveAttribute('role', 'switch');
		expect(toggle).toHaveAttribute('data-collapsed', 'false');
		expect(toggle).toHaveTextContent('Collapse all');
		expect(toggle).toHaveAttribute('title', 'Collapse all sections on this page');

		// Collapse all → every card collapses AND the ToC rail folds.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('data-collapsed', 'true');
		expect(toggle).toHaveTextContent('Expand all');
		expect(toggle).toHaveAttribute('title', 'Expand all sections on this page');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		// An unsaved collapse action writes no storage.
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();

		// The ToC rail is never HIDDEN (still in the DOM, still offers its jumps);
		// the detail grid never gains a quiet variant class (grid + gutter unchanged).
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.style.display).not.toBe('none');
		expect(
			(container.querySelector('.detail-shell-grid') as HTMLElement).classList.contains('is-quiet'),
		).toBe(false);

		// Expand all → everything reopens (cards + ToC).
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('data-collapsed', 'false');
		expect(toggle).toHaveTextContent('Collapse all');
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
	});

	it('collapses and expands left, center, and both responsive rail mounts', async () => {
		const { container } = render(MetricsExplainer);
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		for (const trigger of container.querySelectorAll('button.section-header')) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		await fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
		for (const trigger of container.querySelectorAll('button.section-header')) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
	});

	it('keeps a mobile Coverage action scoped to Coverage across both responsive rail mounts', async () => {
		provState.data = {
			generated_utc: '2026-07-10T12:00:00Z',
			conformance: { status: 'conformant', extra_row_count: 0, unknown_members: [] },
			methodology: {},
		};
		const { container } = render(MetricsExplainer);
		const mobileSummary = container.querySelector(
			'[data-slot="detail-shell-mobile-summary"]',
		) as HTMLElement;
		const coverage = screen.getAllByRole('button', { name: en.statRail.coverage.title });
		expect(coverage).toHaveLength(2);
		const mobileCoverage = within(mobileSummary).getByRole('button', {
			name: en.statRail.coverage.title,
		});
		const otherRailTriggers = Array.from(
			container.querySelectorAll<HTMLButtonElement>('.metrics-stat-rail button.section-header'),
		).filter((trigger) => !coverage.includes(trigger));
		const otherRailStates = otherRailTriggers.map((trigger) =>
			trigger.getAttribute('aria-expanded'),
		);

		await fireEvent.click(mobileCoverage);

		const mobileCoverageBody = mobileCoverage
			.closest('[data-slot="card"]')
			?.querySelector('[data-slot="collapsible-content"]');
		expect(mobileCoverageBody).toHaveAttribute('data-state', 'closed');
		for (const trigger of coverage) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(otherRailTriggers.map((trigger) => trigger.getAttribute('aria-expanded'))).toEqual(
			otherRailStates,
		);
	});

	it('keeps the ToC rail its OWN user-driven collapse chevron (cards untouched, persisted)', async () => {
		const { container } = render(MetricsExplainer);

		const railToggle = tocTrigger(container);
		expect(railToggle, 'ToC rail has its own disclosure trigger').not.toBeNull();
		expect(railToggle).toHaveAttribute('aria-expanded', 'true');

		// The reader folds the ToC via ITS OWN toggle — the metric cards stay OPEN.
		await fireEvent.click(railToggle as HTMLElement);
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
		// The collapsed choice persists (sectionKey="metrics-toc" → sessionStorage).
		expect(sessionStorage.getItem('transit.persisted:metrics-toc')).toBe('false');
	});

	it('writes a per-card CLOSE choice, then resets it on an unremembered article mount', async () => {
		const { container } = render(MetricsExplainer);

		// The card starts open; close it and confirm its own persisted key is written.
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(cardTrigger(container, 'severe') as HTMLElement);
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem('transit.persisted:metrics-card-severe')).toBe('false');

		// A fresh unremembered article resets all participating cards open. Its
		// mount-time openSignal intentionally overrides the prior per-card choice.
		const { container: c2 } = render(MetricsExplainer);
		expect(cardTrigger(c2, 'severe')).toHaveAttribute('aria-expanded', 'true');
		expect(cardTrigger(c2, 'otp')).toHaveAttribute('aria-expanded', 'true');
	});

	// ── R3: the remembered collapsed default (ONE site-wide preference) ───────
	it('Always start collapsed persists; forgetting clears the default without unfolding', async () => {
		const { container } = render(MetricsExplainer);

		const remember = screen.getByTestId('quiet-mode-remember');
		expect(remember).not.toHaveAttribute('role', 'switch');
		expect(remember).toHaveAttribute('data-remembered', 'false');
		expect(remember).toHaveTextContent('Always start collapsed');

		// Remembering engages collapsed mode and persists the site-wide preference.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('data-remembered', 'true');
		expect(remember).toHaveTextContent("Don't start collapsed");
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('data-collapsed', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}

		// Forgetting clears the preference; the on-screen folded state is untouched.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('data-remembered', 'false');
		expect(remember).toHaveTextContent('Always start collapsed');
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('data-collapsed', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');
	});

	it('restores a saved collapsed preference on mount → cards + ToC folded, rail still present', () => {
		// A prior visit saved collapsed mode under the ONE site-wide key. On mount the shared
		// store re-applies it: the close signal folds cards + ToC; the rail is NEVER
		// removed from the DOM.
		localStorage.setItem('transit:quiet-mode', 'true');
		const { container } = render(MetricsExplainer);

		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('data-collapsed', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');
		expect(screen.getByTestId('quiet-mode-remember')).toHaveAttribute('data-remembered', 'true');
		expect(screen.getByTestId('quiet-mode-remember')).toHaveTextContent("Don't start collapsed");
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		expect(container.querySelector('.metrics-toc-rail')).not.toBeNull();
	});
});
