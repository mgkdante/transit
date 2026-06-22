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

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import MetricsExplainer from './MetricsExplainer.svelte';
import { METRICS, METRIC_KEYS } from './metrics.content';
import { metricsCopy } from './metrics.copy';

// The explainer now reads the provider's feed-conformance verdict off
// provenance.json for the honesty-layer badge. Stub the data ports so this DOM
// gate stays env-free (the real $lib/v1 chain reads $env/dynamic/public) and
// off-network. data:null → no conformance → the badge renders nothing, leaving
// every assertion below about the static article untouched.
vi.mock('$lib/v1', () => ({ getProvenance: vi.fn() }));
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

describe('MetricsExplainer', () => {
	it('renders the surface head + provenance preamble', () => {
		const { container } = render(MetricsExplainer);

		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.provenance.body)).toBeInTheDocument();
		// Both confidence-level chips appear in the legend.
		expect(container.textContent).toContain(en.confidence.levels.proxy.meaning);
		expect(container.textContent).toContain(en.confidence.levels.medium.meaning);
	});

	it('lays the body out as a 2-column grid (ToC rail + content, no empty third measure rail)', () => {
		const { container } = render(MetricsExplainer);

		// slice-9.8-B dropped the empty right rail: the body grid is now ToC rail +
		// reading column only. The legacy .entry-column is gone entirely.
		expect(container.querySelector('.entry-column')).toBeNull();

		// Exactly the two grid children remain: the ToC rail and the sections column.
		const grid = container.querySelector('.body-grid') as HTMLElement;
		expect(grid).not.toBeNull();
		expect(grid.querySelector('.context-column')).not.toBeNull();
		expect(grid.querySelector('.sections-column')).not.toBeNull();
		const directChildren = Array.from(grid.children);
		expect(directChildren).toHaveLength(2);
	});

	it('renders the desktop TOC rail with one numbered jump button per metric', () => {
		const { container } = render(MetricsExplainer);

		// The TocNav lives in the desktop rail; its jump items are buttons (not
		// links, the shared TocNav drives scroll via onNavigate, not href). One
		// per metric, each labelled with the metric name.
		const rail = container.querySelector('.context-column');
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

	it('keeps the TOC entries and the section cards in lock-step (same anchors)', () => {
		const { container } = render(MetricsExplainer);

		// Every metric anchor resolves to exactly one in-page section block, and the
		// rail offers a jump for it (the (i)-tip deep-link contract).
		const rail = container.querySelector('.context-column') as HTMLElement;
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
		const rail = container.querySelector('.context-column') as HTMLElement;

		// The rail offers a jump to the Lacunes card by its title (one ToC entry).
		expect(within(rail).getByRole('button', { name: en.lacunes.title })).toBeInTheDocument();
	});

	// Helpers: the metric section cards are the shared CollapsibleSection, whose
	// open/closed state is reflected on the disclosure trigger's aria-expanded.
	function metricTriggers(container: HTMLElement): HTMLElement[] {
		const column = container.querySelector('[data-testid="metrics-sections"]') as HTMLElement;
		return Array.from(
			column.querySelectorAll('[data-slot="collapsible-trigger"]'),
		) as HTMLElement[];
	}

	// The desktop ToC rail's OWN collapse trigger (slice-9.8-B). It is the header
	// disclosure trigger inside .context-column — DISTINCT from the metric-card
	// triggers (which live in metrics-sections). Helper so the A2 guards can prove
	// the FOCUS toggle never touches it.
	function tocTrigger(container: HTMLElement): HTMLElement | null {
		const rail = container.querySelector('.context-column') as HTMLElement;
		return rail?.querySelector('[data-slot="collapsible-trigger"]') ?? null;
	}

	it('quiet/FOCUS mode COLLAPSES the metric cards while the ToC rail stays visible, and persists (session by default)', async () => {
		localStorage.removeItem('metrics-quiet');
		sessionStorage.removeItem('transit.persisted:metrics-toc');
		localStorage.removeItem('metrics-focus-remembered');
		sessionStorage.removeItem('metrics-quiet');
		const { container } = render(MetricsExplainer);

		// The header carries a single quiet/focus switch — a real <button role="switch">,
		// OFF by default (aria-checked=false), labelled to ENTER focus reading.
		const toggle = screen.getByTestId('metrics-quiet-toggle');
		expect(toggle).toHaveAttribute('role', 'switch');
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		expect(toggle).toHaveAttribute('aria-label', en.quiet.enable);

		// Default (calm): every metric card is OPEN.
		const triggers = metricTriggers(container);
		expect(triggers.length).toBeGreaterThan(0);
		for (const trigger of triggers) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}

		// The ToC rail exists and is visible in BOTH modes — grab it up front so we
		// can assert it survives quiet mode (the operator's core complaint). It is
		// OPEN by default (its own collapse is independent of FOCUS).
		const rail = container.querySelector('.context-column') as HTMLElement;
		expect(rail).not.toBeNull();
		const railButton = within(rail).getByRole('button', { name: METRICS[0].name.en });
		expect(railButton).toBeInTheDocument();
		const railToggle = tocTrigger(container);
		expect(railToggle).not.toBeNull();
		expect(railToggle).toHaveAttribute('aria-expanded', 'true');

		// Press FOCUS ON → aria-checked flips, the cards COLLAPSE, the label swaps to
		// the EXIT action. Unpinned (default) → the choice lives in sessionStorage,
		// NOT localStorage.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		expect(toggle).toHaveAttribute('aria-label', en.quiet.disable);
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(sessionStorage.getItem('metrics-quiet')).toBe('1');
		expect(localStorage.getItem('metrics-quiet')).toBeNull();

		// NON-NEGOTIABLE (A2): FOCUS does NOT hide the ToC, and does NOT drive its
		// own collapse. The rail is still in the DOM, not display:none, still offers
		// its jump buttons, AND its own collapse toggle is STILL OPEN (FOCUS never
		// touched it).
		expect(container.querySelector('.context-column')).not.toBeNull();
		expect((container.querySelector('.context-column') as HTMLElement).style.display).not.toBe(
			'none',
		);
		expect(
			within(container.querySelector('.context-column') as HTMLElement).getByRole('button', {
				name: METRICS[0].name.en,
			}),
		).toBeInTheDocument();
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'true');
		// The body grid never gains a quiet variant class (grid + gutter unchanged).
		expect(
			(container.querySelector('.body-grid') as HTMLElement).classList.contains('is-quiet'),
		).toBe(false);

		// Press FOCUS OFF → the cards re-open; the session flag clears to '0'.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
		expect(sessionStorage.getItem('metrics-quiet')).toBe('0');

		sessionStorage.removeItem('metrics-quiet');
	});

	it('the ToC rail has its OWN collapse toggle that folds it, independent of FOCUS, and persists', async () => {
		localStorage.removeItem('metrics-focus-remembered');
		sessionStorage.removeItem('metrics-quiet');
		sessionStorage.removeItem('transit.persisted:metrics-toc');
		const { container } = render(MetricsExplainer);

		const railToggle = tocTrigger(container);
		expect(railToggle, 'ToC rail has its own disclosure trigger').not.toBeNull();
		// Open by default.
		expect(railToggle).toHaveAttribute('aria-expanded', 'true');

		// The reader folds the ToC via ITS OWN toggle — the metric cards are untouched.
		await fireEvent.click(railToggle as HTMLElement);
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
		// The collapsed choice persists (sectionKey="metrics-toc" → sessionStorage).
		expect(sessionStorage.getItem('transit.persisted:metrics-toc')).toBe('false');

		// FOCUS must NOT re-open or otherwise drive the manually-collapsed ToC.
		const focus = screen.getByTestId('metrics-quiet-toggle');
		await fireEvent.click(focus);
		expect(tocTrigger(container)).toHaveAttribute('aria-expanded', 'false');

		sessionStorage.removeItem('metrics-quiet');
		sessionStorage.removeItem('transit.persisted:metrics-toc');
	});

	it('remember-focus PINS the FOCUS preference across visits, and unpinning demotes it to session', async () => {
		localStorage.removeItem('metrics-quiet');
		localStorage.removeItem('metrics-focus-remembered');
		sessionStorage.removeItem('metrics-quiet');
		const { container } = render(MetricsExplainer);

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

		// PIN it → the preference is promoted to localStorage (remembered across
		// visits) and the session copy is cleared.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'true');
		expect(remember).toHaveAttribute('aria-label', en.quiet.forget);
		expect(localStorage.getItem('metrics-focus-remembered')).toBe('1');
		expect(localStorage.getItem('metrics-quiet')).toBe('1');
		expect(sessionStorage.getItem('metrics-quiet')).toBeNull();
		// FOCUS itself is unchanged by pinning (cards still collapsed).
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}

		// UNPIN → the pin clears and the preference demotes back to a session value.
		await fireEvent.click(remember);
		expect(remember).toHaveAttribute('aria-checked', 'false');
		expect(localStorage.getItem('metrics-focus-remembered')).toBe('0');
		expect(localStorage.getItem('metrics-quiet')).toBeNull();
		expect(sessionStorage.getItem('metrics-quiet')).toBe('1');

		localStorage.removeItem('metrics-focus-remembered');
		sessionStorage.removeItem('metrics-quiet');
	});

	it('restores a PINNED (remembered) FOCUS preference from localStorage on mount; ToC still shown', () => {
		// A prior visit pinned FOCUS ON. The screen re-applies it on mount from
		// localStorage (the remembered store) as a CARD-collapse preference. It must
		// NEVER restore a hidden ToC.
		localStorage.setItem('metrics-focus-remembered', '1');
		localStorage.setItem('metrics-quiet', '1');
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('metrics-quiet-toggle');
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		const remember = screen.getByTestId('metrics-quiet-remember');
		expect(remember).toHaveAttribute('aria-checked', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The ToC rail is present and reachable even with the restored quiet pref.
		const rail = container.querySelector('.context-column') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(within(rail).getByRole('button', { name: METRICS[0].name.en })).toBeInTheDocument();

		localStorage.removeItem('metrics-focus-remembered');
		localStorage.removeItem('metrics-quiet');
	});

	it('does NOT restore an unpinned FOCUS value from a prior visit (session-by-default)', () => {
		// localStorage holds a quiet value but the pin is OFF: a fresh visit must
		// IGNORE it (FOCUS is session-only unless pinned) and render calm/cards-open.
		localStorage.setItem('metrics-quiet', '1');
		localStorage.removeItem('metrics-focus-remembered');
		sessionStorage.removeItem('metrics-quiet');
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('metrics-quiet-toggle');
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}

		localStorage.removeItem('metrics-quiet');
	});
});
