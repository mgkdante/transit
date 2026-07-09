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

// S10 — the page is now DEFAULT-CLOSED with per-card persisted open-state
// (sessionStorage key `transit.persisted:metrics-card-<anchor>`), plus the ToC's
// own `metrics-toc` key and the FOCUS/remember keys. `persisted()` seeds
// synchronously from sessionStorage, so a value left by one test would leak into
// the next (same happy-dom worker) and pre-open a card. Wipe every relevant key
// before AND after each test so every render starts from the true default (all
// cards closed, ToC open, FOCUS off) and no stale hash lingers.
const CARD_ANCHORS = [...METRICS.map((m) => m.anchor), 'live-positions', 'structural-gaps'];
function resetMetricsStorage(): void {
	for (const anchor of CARD_ANCHORS) {
		sessionStorage.removeItem(`transit.persisted:metrics-card-${anchor}`);
	}
	sessionStorage.removeItem('transit.persisted:metrics-toc');
	sessionStorage.removeItem('metrics-quiet');
	localStorage.removeItem('metrics-quiet');
	localStorage.removeItem('metrics-focus-remembered');
	if (window.location.hash) window.location.hash = '';
}
beforeEach(resetMetricsStorage);
afterEach(resetMetricsStorage);

describe('MetricsExplainer', () => {
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

	it('mobile pill navigation OPENS the target card (default-closed page, review F1)', async () => {
		const { container } = render(MetricsExplainer);
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
		window.location.hash = '#%';
		expect(() => render(MetricsExplainer)).not.toThrow();
		// And nothing opened: the undecodable fragment simply cannot match a card.
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

	// ── D3: default-closed render ──────────────────────────────────────────────
	it('renders every metric card CLOSED on a fresh visit (default-closed page)', () => {
		const { container } = render(MetricsExplainer);

		const triggers = metricTriggers(container);
		expect(triggers.length).toBeGreaterThan(0);
		for (const trigger of triggers) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The collapsed content is force-mounted (so deep-links + tests still find
		// the text) but the collapsible reports the closed data-state.
		const firstBody = container.querySelector(
			`#${CSS.escape(METRICS[0].anchor)} [data-slot="collapsible-content"]`,
		);
		expect(firstBody).toHaveAttribute('data-state', 'closed');

		// The ToC rail is OPEN by default (only FOCUS or the reader's chevron folds it).
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
	});

	// ── D3: hash opener (mount) ────────────────────────────────────────────────
	it('opens ONLY the hash-named metric card on mount and leaves the rest closed', async () => {
		window.location.hash = '#otp';
		const { container } = render(MetricsExplainer);
		// The mount opener defers one tick so a restored pinned FOCUS flushes first
		// (deterministic deep-link precedence, review F3): one await for the opener's
		// own deferral, one for the open-signal effect flush.
		await tick();
		await tick();

		// #otp is a metric card anchor → that one card opens.
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
		// Every OTHER metric card stays closed.
		for (const entry of METRICS.filter((m) => m.anchor !== 'otp')) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
	});

	// ── D3: hash opener (hashchange, same-page (i) navigation) ─────────────────
	it('opens another card on a later hashchange without closing the first', async () => {
		window.location.hash = '#otp';
		const { container } = render(MetricsExplainer);
		await tick(); // the opener's own deferral (review F3)
		await tick(); // the open-signal effect flush
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');

		// A same-page (i) deep-link swaps the hash and fires hashchange (no remount).
		window.location.hash = '#headway';
		await fireEvent(window, new HashChangeEvent('hashchange'));

		expect(cardTrigger(container, 'headway')).toHaveAttribute('aria-expanded', 'true');
		// The first card stays open (opening is additive, not exclusive).
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
	});

	// ── D3: a preamble deep-link (supplemental (i) tips point here) opens no card
	it('scrolls to a non-card preamble anchor without opening any card and without crashing', () => {
		// Several supplemental (i) tips deep-link to /metrics#metrics-provenance, the
		// provenance PREAMBLE — a plain <section>, NOT a collapsible card. The opener
		// must distinguish: no card opens, and nothing throws.
		window.location.hash = '#metrics-provenance';
		const { container } = render(MetricsExplainer);

		for (const entry of METRICS) {
			expect(cardTrigger(container, entry.anchor)).toHaveAttribute('aria-expanded', 'false');
		}
		// The preamble section is present + carries the deep-link target id.
		expect(container.querySelector('#metrics-provenance')).not.toBeNull();
	});

	// ── D3: ToC navigation opens its target card, closed siblings stay closed ───
	it('ToC navigation opens the target card (closed siblings unaffected)', async () => {
		const { container } = render(MetricsExplainer);
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;

		// Every card starts closed; jump to a mid-page metric via the rail.
		const target = METRICS[3];
		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(within(rail).getByRole('button', { name: target.name.en }));

		expect(cardTrigger(container, target.anchor)).toHaveAttribute('aria-expanded', 'true');
		// A different, un-jumped card is still closed.
		expect(cardTrigger(container, METRICS[0].anchor)).toHaveAttribute('aria-expanded', 'false');
	});

	// ── D2 + D3: FOCUS collapses ALL cards AND the ToC; unfocus reopens ToC ONLY
	it('FOCUS ON collapses every card + the ToC; FOCUS OFF reopens the ToC only (cards stay closed)', async () => {
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('metrics-quiet-toggle');
		expect(toggle).toHaveAttribute('role', 'switch');
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		expect(toggle).toHaveAttribute('aria-label', en.quiet.enable);

		// Open a couple of cards + confirm the ToC is open, so we can watch FOCUS
		// fold everything.
		await fireEvent.click(cardTrigger(container, 'otp') as HTMLElement);
		await fireEvent.click(cardTrigger(container, 'headway') as HTMLElement);
		expect(cardTrigger(container, 'otp')).toHaveAttribute('aria-expanded', 'true');
		expect(cardTrigger(container, 'headway')).toHaveAttribute('aria-expanded', 'true');
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');

		// FOCUS ON → every card collapses AND the ToC rail folds (yesid Quiet-Mode
		// parity). Unpinned → the choice lives in sessionStorage.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		expect(toggle).toHaveAttribute('aria-label', en.quiet.disable);
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem('metrics-quiet')).toBe('1');
		expect(localStorage.getItem('metrics-quiet')).toBeNull();

		// The ToC rail is never HIDDEN (still in the DOM, still offers its jumps) —
		// FOCUS folds its CollapsibleSection, it does not display:none the column.
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(rail.style.display).not.toBe('none');
		// The detail grid never gains a quiet variant class (grid + gutter unchanged).
		expect(
			(container.querySelector('.detail-shell-grid') as HTMLElement).classList.contains('is-quiet'),
		).toBe(false);

		// FOCUS OFF → the ToC reopens; the cards STAY closed (default-closed page —
		// unfocus must not explode all 14 cards open).
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(sessionStorage.getItem('metrics-quiet')).toBe('0');
	});

	// ── D3: the ToC's OWN chevron still folds it, and it persists ──────────────
	it('keeps the ToC rail its OWN user-driven collapse chevron (persists across same-tab visits)', async () => {
		const { container } = render(MetricsExplainer);

		const railToggle = tocTrigger(container);
		expect(railToggle, 'ToC rail has its own disclosure trigger').not.toBeNull();
		expect(railToggle).toHaveAttribute('aria-expanded', 'true');

		// The reader folds the ToC via ITS OWN toggle — the metric cards are untouched.
		await fireEvent.click(railToggle as HTMLElement);
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The collapsed choice persists (sectionKey="metrics-toc" → sessionStorage).
		expect(sessionStorage.getItem('transit.persisted:metrics-toc')).toBe('false');
	});

	// ── D3: a per-card toggle persists in the same-tab session ─────────────────
	it('persists a per-card open choice under its own session key', async () => {
		const { container } = render(MetricsExplainer);

		// The card is closed; open it and confirm its own persisted key is written.
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(cardTrigger(container, 'severe') as HTMLElement);
		expect(cardTrigger(container, 'severe')).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:metrics-card-severe')).toBe('true');

		// A fresh render (same tab) restores that ONE card open, the rest closed.
		const { container: c2 } = render(MetricsExplainer);
		expect(cardTrigger(c2, 'severe')).toHaveAttribute('aria-expanded', 'true');
		expect(cardTrigger(c2, 'otp')).toHaveAttribute('aria-expanded', 'false');
	});

	// ── remember-pin persistence (unchanged by S10) ────────────────────────────
	it('remember-focus PINS the FOCUS preference across visits, and unpinning demotes it to session', async () => {
		render(MetricsExplainer);

		// A paired remember switch sits beside the FOCUS toggle, OFF by default.
		const remember = screen.getByTestId('metrics-quiet-remember');
		expect(remember).toHaveAttribute('role', 'switch');
		expect(remember).toHaveAttribute('aria-checked', 'false');
		expect(remember).toHaveAttribute('aria-label', en.quiet.remember);

		const focus = screen.getByTestId('metrics-quiet-toggle');

		// Turn FOCUS on (session-scoped while unpinned).
		await fireEvent.click(focus);
		expect(sessionStorage.getItem('metrics-quiet')).toBe('1');
		expect(localStorage.getItem('metrics-quiet')).toBeNull();

		// PIN it → promoted to localStorage (remembered across visits), session cleared.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'true');
		expect(remember).toHaveAttribute('aria-label', en.quiet.forget);
		expect(localStorage.getItem('metrics-focus-remembered')).toBe('1');
		expect(localStorage.getItem('metrics-quiet')).toBe('1');
		expect(sessionStorage.getItem('metrics-quiet')).toBeNull();

		// UNPIN → the pin clears and the preference demotes back to a session value.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'false');
		expect(localStorage.getItem('metrics-focus-remembered')).toBe('0');
		expect(localStorage.getItem('metrics-quiet')).toBeNull();
		expect(sessionStorage.getItem('metrics-quiet')).toBe('1');
	});

	it('restores a PINNED (remembered) FOCUS preference on mount → cards + ToC folded, rail still present', () => {
		// A prior visit pinned FOCUS ON. On mount the screen re-applies it: it bumps
		// the close signal so the ToC folds, and the cards are closed (default). The
		// rail is NEVER removed from the DOM.
		localStorage.setItem('metrics-focus-remembered', '1');
		localStorage.setItem('metrics-quiet', '1');
		const { container } = render(MetricsExplainer);

		expect(screen.getByTestId('metrics-quiet-toggle')).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByTestId('metrics-quiet-remember')).toHaveAttribute('aria-checked', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The restored FOCUS folded the ToC too (parity), but the rail is present.
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		const rail = container.querySelector('.metrics-toc-rail') as HTMLElement;
		expect(rail).not.toBeNull();
	});

	it('does NOT restore an unpinned FOCUS value from a prior visit (session-by-default), ToC stays open', () => {
		// localStorage holds a quiet value but the pin is OFF: a fresh visit IGNORES
		// it (FOCUS is session-only unless pinned) → calm, ToC open, cards closed.
		localStorage.setItem('metrics-quiet', '1');
		const { container } = render(MetricsExplainer);

		expect(screen.getByTestId('metrics-quiet-toggle')).toHaveAttribute('aria-checked', 'false');
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
	});
});
