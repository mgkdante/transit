// MetricsExplainer.svelte.test.ts — the /metrics screen, DOM gate.
//
// The explainer renders, in EN (getLocale() defaults to DEFAULT_LOCALE without a
// provider — same as the other feature-screen tests): the surface head, the
// provenance preamble + confidence legend, a jump-nav (ToC) with one anchor link
// per metric, and one anchored <article id={anchor}> section per metric carrying
// the definition / math / SQL / "what it's NOT" / caveats blocks. These are the
// affordances the (i) tip deep-links into, so every anchor must exist.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
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

	it('renders a jump-nav with one anchor link per metric', () => {
		render(MetricsExplainer);

		const toc = screen.getByRole('navigation', { name: en.tocLabel });
		const links = within(toc).getAllByRole('link');
		expect(links).toHaveLength(METRIC_KEYS.length);

		// Each ToC link points at a real in-page anchor.
		for (const entry of METRICS) {
			const link = within(toc).getByRole('link', { name: entry.name.en });
			expect(link).toHaveAttribute('href', `#${entry.anchor}`);
		}
	});

	it('renders one anchored section per metric with the science blocks', () => {
		const { container } = render(MetricsExplainer);

		for (const entry of METRICS) {
			const section = container.querySelector(`#${CSS.escape(entry.anchor)}`);
			expect(section, `section #${entry.anchor}`).not.toBeNull();
			// Heading + verbatim science survive into the DOM.
			expect(section?.textContent).toContain(entry.name.en);
			expect(section?.textContent).toContain(entry.definition.en);
			expect(section?.textContent).toContain(entry.sql);
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
});
