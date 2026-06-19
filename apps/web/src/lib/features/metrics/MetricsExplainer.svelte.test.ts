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

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import MetricsExplainer from './MetricsExplainer.svelte';
import { METRICS, METRIC_KEYS } from './metrics.content';
import { metricsCopy } from './metrics.copy';

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
});
