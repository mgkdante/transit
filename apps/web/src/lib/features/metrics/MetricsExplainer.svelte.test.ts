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

	it('quiet/FOCUS mode COLLAPSES the metric cards while the ToC rail stays visible, and persists', async () => {
		localStorage.removeItem('metrics-quiet');
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
		// can assert it survives quiet mode (the operator's core complaint).
		const rail = container.querySelector('.context-column') as HTMLElement;
		expect(rail).not.toBeNull();
		const railButton = within(rail).getByRole('button', { name: METRICS[0].name.en });
		expect(railButton).toBeInTheDocument();

		// Press it ON → aria-checked flips, the cards COLLAPSE, the label swaps to the
		// EXIT action, and the choice persists to localStorage.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		expect(toggle).toHaveAttribute('aria-label', en.quiet.disable);
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(localStorage.getItem('metrics-quiet')).toBe('1');

		// NON-NEGOTIABLE: quiet does NOT hide the ToC. The rail is still in the DOM,
		// not display:none, and still offers its jump buttons.
		expect(container.querySelector('.context-column')).not.toBeNull();
		expect((container.querySelector('.context-column') as HTMLElement).style.display).not.toBe(
			'none',
		);
		expect(
			within(container.querySelector('.context-column') as HTMLElement).getByRole('button', {
				name: METRICS[0].name.en,
			}),
		).toBeInTheDocument();
		// The body grid never gains a quiet variant class (grid + gutter unchanged).
		expect(
			(container.querySelector('.body-grid') as HTMLElement).classList.contains('is-quiet'),
		).toBe(false);

		// Press it OFF → the cards re-open and the persisted flag clears to '0'.
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'false');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'true');
		}
		expect(localStorage.getItem('metrics-quiet')).toBe('0');
	});

	it('restores the persisted quiet-mode preference on mount (cards collapsed, ToC still shown)', () => {
		// A prior session left quiet mode ON; the screen re-applies it on mount as a
		// CARD-collapse preference (SSR-safe: the onMount localStorage read drives it).
		// It must NEVER restore a hidden ToC.
		localStorage.setItem('metrics-quiet', '1');
		const { container } = render(MetricsExplainer);

		const toggle = screen.getByTestId('metrics-quiet-toggle');
		expect(toggle).toHaveAttribute('aria-checked', 'true');
		for (const trigger of metricTriggers(container)) {
			expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		// The ToC rail is present and reachable even with the restored quiet pref.
		const rail = container.querySelector('.context-column') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(within(rail).getByRole('button', { name: METRICS[0].name.en })).toBeInTheDocument();

		localStorage.removeItem('metrics-quiet');
	});

	it('the ToC rail is non-hideable: no disclosure trigger inside the rail', () => {
		const { container } = render(MetricsExplainer);
		const rail = container.querySelector('.context-column') as HTMLElement;
		expect(rail).not.toBeNull();
		// The rail heading is a plain header, NOT a collapsible disclosure trigger —
		// there is no user affordance (and no persisted state) that hides the ToC.
		expect(rail.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();
	});
});
