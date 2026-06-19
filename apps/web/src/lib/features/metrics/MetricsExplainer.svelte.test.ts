// MetricsExplainer.svelte.test.ts — the /metrics screen, DOM gate.
//
// The explainer renders, in EN (getLocale() defaults to DEFAULT_LOCALE without a
// provider — same as the other feature-screen tests): the surface head, the
// provenance preamble + confidence legend, a sticky ToC rail (jump-nav) with one
// anchor link per metric, and one anchored COLLAPSIBLE <details id={anchor}>
// section per metric carrying the definition / math / SQL / "what it's NOT" /
// caveats blocks. The SQL rides the shared CodeBlock (syntax chrome). A mobile
// floating pill opens the same jump-nav as a focus-trapped sheet.
//
// These are the affordances the (i) tip deep-links into, so every anchor must
// exist and stay reachable.

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

	it('renders the sticky ToC rail with one anchor link per metric', () => {
		render(MetricsExplainer);

		// The rail nav is always present (the sheet nav only mounts when open).
		const toc = screen.getByRole('navigation', { name: en.tocLabel });
		const links = within(toc).getAllByRole('link');
		expect(links).toHaveLength(METRIC_KEYS.length);

		// Each ToC link points at a real in-page anchor.
		for (const entry of METRICS) {
			const link = within(toc).getByRole('link', { name: entry.name.en });
			expect(link).toHaveAttribute('href', `#${entry.anchor}`);
		}
	});

	it('renders one anchored COLLAPSIBLE <details> per metric with the science blocks', () => {
		const { container } = render(MetricsExplainer);

		for (const entry of METRICS) {
			const section = container.querySelector(`#${CSS.escape(entry.anchor)}`);
			expect(section, `section #${entry.anchor}`).not.toBeNull();
			// It is a native disclosure (open by default — a reference page hides nothing).
			expect(section?.tagName.toLowerCase(), `${entry.anchor} is <details>`).toBe('details');
			expect(section).toHaveAttribute('open');
			expect(section?.querySelector('summary'), `${entry.anchor} has a summary`).not.toBeNull();
			// Heading + verbatim science survive into the DOM.
			expect(section?.textContent).toContain(entry.name.en);
			expect(section?.textContent).toContain(entry.definition.en);
			// The verbatim SQL survives the CodeBlock tokenizer byte-for-byte.
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

	it('exposes a mobile floating pill that opens the jump-nav as a focus-trapped sheet', async () => {
		render(MetricsExplainer);

		const pill = screen.getByRole('button', { name: en.tocPill.open });
		expect(pill).toHaveAttribute('aria-expanded', 'false');
		// No dialog until the pill is pressed.
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		await fireEvent.click(pill);
		expect(pill).toHaveAttribute('aria-expanded', 'true');
		const sheet = screen.getByRole('dialog', { name: en.tocPill.title });
		expect(sheet).toBeInTheDocument();
		// The sheet hosts a close button + the same per-metric jump links.
		expect(within(sheet).getByRole('button', { name: en.tocPill.close })).toBeInTheDocument();
		expect(within(sheet).getAllByRole('link')).toHaveLength(METRIC_KEYS.length);

		// Escape dismisses the sheet.
		await fireEvent.keyDown(sheet, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(pill).toHaveAttribute('aria-expanded', 'false');
	});

	it('keeps a collapsed section reachable: a ToC jump re-opens its target', async () => {
		const { container } = render(MetricsExplainer);
		const first = METRICS[0];
		const details = container.querySelector<HTMLDetailsElement>(`#${CSS.escape(first.anchor)}`)!;

		// Collapse it, then click its ToC link → it re-opens.
		details.open = false;
		const toc = screen.getByRole('navigation', { name: en.tocLabel });
		await fireEvent.click(within(toc).getByRole('link', { name: first.name.en }));
		expect(details.open).toBe(true);
	});
});
