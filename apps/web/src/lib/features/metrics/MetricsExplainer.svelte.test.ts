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
// carrying the definition / math / SQL / "what it's NOT" / caveats blocks. The SQL
// rides the shared CodeBlock (syntax chrome). A mobile floating pill opens the
// same jump-nav as a drawer.
//
// These are the affordances the (i) tip deep-links into (/metrics#<anchor>), so
// every anchor must exist as an in-page element id and stay reachable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import MetricsExplainer from './MetricsExplainer.svelte';
import { METRICS, METRIC_KEYS } from './metrics.content';
import { metricsCopy } from './metrics.copy';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

// The explainer now reads the provider's feed-conformance verdict off
// provenance.json for the honesty-layer badge. Stub the data ports so this DOM
// gate stays env-free (the real $lib/v1 chain reads $env/dynamic/public) and
// off-network. data:null → no conformance → the badge renders nothing, leaving
// every assertion below about the static article untouched.
vi.mock('$lib/v1', () => ({
	getProvenance: vi.fn(),
	getV1Context: () => ({
		manifest: { short_name: 'STM', display_name: 'STM', dataset_version: 'test' },
	}),
}));
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: () => ({
		data: null,
		error: null,
		loading: false,
		settled: true,
		reload: vi.fn(),
	}),
}));

const en = metricsCopy.en;

// P5-R R3 — the page is DEFAULT-OPEN with per-card persisted open-state
// (sessionStorage key `transit.persisted:metrics-card-<anchor>`), plus the ToC's
// own `metrics-toc` key and the ONE site-wide FOCUS preference
// ('transit:quiet-mode', owned by the shared quietModeStore — a module
// singleton whose state would leak between tests). `persisted()` seeds
// synchronously from sessionStorage, so wipe every relevant key AND reset the
// store before + after each test so every render starts from the true default
// (all cards open, ToC open, FOCUS off) and no stale hash lingers.
const CARD_ANCHORS = [...METRICS.map((m) => m.anchor), 'live-positions', 'structural-gaps'];
function resetMetricsStorage(): void {
	for (const anchor of CARD_ANCHORS) {
		sessionStorage.removeItem(`transit.persisted:metrics-card-${anchor}`);
	}
	sessionStorage.removeItem('transit.persisted:metrics-toc');
	quietModeStore.resetForTest();
	if (window.location.hash) window.location.hash = '';
}
beforeEach(resetMetricsStorage);
afterEach(resetMetricsStorage);

describe('MetricsExplainer', () => {
	it('renders the shared article header with metrics keywords, back link, body lede, and working controls', () => {
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
		expect(within(header).getByTestId('quiet-mode-toggle')).toBeInTheDocument();
		expect(within(header).getByTestId('metrics-expand-all')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell-header"]')).toBeNull();
		expect(container.textContent).not.toMatch(/blueprint/i);
		expect(container.querySelector('[data-slot="detail-shell"]')?.parentElement).toBe(container);
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

	it('renders one anchored CollapsibleSection card per metric with the science blocks', () => {
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
			// The verbatim SQL survives the CodeBlock tokenizer byte-for-byte.
			expect(block?.textContent).toContain(entry.sql);
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

	it('gives the SQL the CodeBlock chrome (a SQL language tag per metric)', () => {
		const { container } = render(MetricsExplainer);
		const blocks = container.querySelectorAll('.codeblock');
		expect(blocks).toHaveLength(METRIC_KEYS.length);
		// Each code region is keyboard-scrollable (focusable) for pointer-free overflow.
		for (const block of blocks) {
			const region = block.querySelector('[role="region"]');
			expect(region).toHaveAttribute('tabindex', '0');
		}
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
		// Fold the default-open page first (FOCUS) so the reveal is observable.
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
		// Pin FOCUS so the page mounts folded — "nothing opened" is then observable.
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
	it('opens the hash-named card on mount even when a pinned FOCUS folded the page', async () => {
		localStorage.setItem('transit:quiet-mode', 'true'); // a prior visit pinned FOCUS
		window.location.hash = '#otp';
		const { container } = render(MetricsExplainer);
		// One await for the opener's own deferral (review F3), one for the
		// open-signal effect flush.
		await tick();
		await tick();

		// FOCUS restored ON → the page folded; the deep-linked card still opens
		// (quiet folds cards but never locks them against explicit intent).
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('aria-checked', 'true');
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
		for (const entry of METRICS.filter((m) => m.anchor !== 'otp')) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
	});

	it('opens another card on a later hashchange without closing the first (folded page)', async () => {
		const { container } = render(MetricsExplainer);
		// Fold everything first (FOCUS) so the additive opening is observable.
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

	it('scrolls to a non-card preamble anchor without opening any folded card and without crashing', async () => {
		// Several supplemental (i) tips deep-link to /metrics#metrics-provenance, the
		// provenance PREAMBLE — a plain <section>, NOT a collapsible card. Fold the
		// page first (pinned FOCUS) so "no card opens" is observable.
		localStorage.setItem('transit:quiet-mode', 'true');
		window.location.hash = '#metrics-provenance';
		const { container } = render(MetricsExplainer);
		await tick();
		await tick();

		for (const entry of METRICS) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
		// The preamble section is present + carries the deep-link target id.
		expect(container.querySelector('#metrics-provenance')).not.toBeNull();
	});

	it('ToC navigation opens the target card through FOCUS (folded siblings unaffected)', async () => {
		const { container } = render(MetricsExplainer);
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle')); // fold all
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;

		const target = METRICS[3];
		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(within(rail).getByRole('button', { name: target.name.en }));

		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'true');
		// A different, un-jumped card stays folded.
		expect(cardTrigger(container, METRICS[0].anchor)).toHaveAttribute('aria-expanded', 'false');
	});

	// ── R3: FOCUS = the full yesid contract (fold all / reopen ALL) ────────────
	it('FOCUS ON collapses every card + the ToC; FOCUS OFF reopens EVERYTHING', async () => {
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('quiet-mode-toggle');
		expect(toggle).toHaveAttribute('role', 'switch');
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		// The accessible NAME is the stable visible word (WCAG 2.5.3); the action
		// phrase rides title only and may flip with state.
		expect(toggle).toHaveTextContent('Focus');
		expect(toggle).toHaveAttribute('title', 'Enter focus reading');

		// FOCUS ON → every card collapses AND the ToC rail folds.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		expect(toggle).toHaveTextContent('Focus');
		expect(toggle).toHaveAttribute('title', 'Exit focus reading');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		// Unpinned FOCUS writes NO storage (session-only, in-memory).
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();

		// The ToC rail is never HIDDEN (still in the DOM, still offers its jumps);
		// the detail grid never gains a quiet variant class (grid + gutter unchanged).
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.style.display).not.toBe('none');
		expect(
			(container.querySelector('.detail-shell-grid') as HTMLElement).classList.contains('is-quiet'),
		).toBe(false);

		// FOCUS OFF → EVERYTHING reopens (cards + ToC — the yesid contract; the S10
		// reopen-ToC-only deviation retired with the default-open flip).
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
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

	it('persists a per-card CLOSE choice under its own session key (default-open page)', async () => {
		const { container } = render(MetricsExplainer);

		// The card starts open; close it and confirm its own persisted key is written.
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(cardTrigger(container, 'severe') as HTMLElement);
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem('transit.persisted:metrics-card-severe')).toBe('false');

		// A fresh render (same tab) restores that ONE card closed, the rest open.
		const { container: c2 } = render(MetricsExplainer);
		expect(cardTrigger(c2, 'severe')).toHaveAttribute('aria-expanded', 'false');
		expect(cardTrigger(c2, 'otp')).toHaveAttribute('aria-expanded', 'true');
	});

	// ── R3: the REMEMBER pin (ONE site-wide preference) ────────────────────────
	it('REMEMBER pins FOCUS across visits under the site-wide key; forgetting unpins without unfolding', async () => {
		const { container } = render(MetricsExplainer);

		const remember = screen.getByTestId('quiet-mode-remember');
		expect(remember).toHaveAttribute('role', 'switch');
		expect(remember).toHaveAttribute('aria-checked', 'false');

		// PIN → engages FOCUS and persists the site-wide preference.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('aria-checked', 'true');
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}

		// FORGET → the preference clears; the on-screen folded state is untouched.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'false');
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('aria-checked', 'true');
	});

	it('restores a PINNED FOCUS preference on mount → cards + ToC folded, rail still present', () => {
		// A prior visit pinned FOCUS ON (the ONE site-wide key). On mount the shared
		// store re-applies it: the close signal folds cards + ToC; the rail is NEVER
		// removed from the DOM.
		localStorage.setItem('transit:quiet-mode', 'true');
		const { container } = render(MetricsExplainer);

		expect(screen.getByTestId('quiet-mode-toggle')).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByTestId('quiet-mode-remember')).toHaveAttribute('aria-checked', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		expect(container.querySelector('.metrics-toc-rail')).not.toBeNull();
	});

	// ── §C5.8: the bulk expand/collapse control on a default-open page ─────────
	it('collapse-all folds every card but leaves the ToC; expand-all reopens them', async () => {
		const { container } = render(MetricsExplainer);

		const bulk = screen.getByTestId('metrics-expand-all');
		// Default-open page → the control starts as "Collapse all".
		expect(bulk).toHaveTextContent(en.expand.collapseAll);

		await fireEvent.click(bulk);
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The bulk control never folds the ToC (only FOCUS does).
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
		expect(bulk).toHaveTextContent(en.expand.expandAll);

		await fireEvent.click(bulk);
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
	});
});
