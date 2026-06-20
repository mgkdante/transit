// MetricsExplainer.methodology.svelte.test.ts — the live "Pipeline note (current
// run)" threading on /metrics, DOM gate.
//
// When the supplementary provenance resource carries a methodology dict, the
// matched metric's card renders a live note block carrying the VERBATIM published
// methodology string, set apart from the static science. Absent methodology → no
// note (the card is unchanged). The pure metric→key resolver is unit-tested in
// metrics.methodology.test.ts; here we assert the rendered wiring.
//
// The data ports are stubbed (the real $lib/v1 chain reads $env/dynamic/public)
// with a mutable `provState` the createResource mock reads by reference.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MetricsExplainer from './MetricsExplainer.svelte';
import { metricsCopy } from './metrics.copy';

const { provState } = vi.hoisted(() => ({
	provState: { data: null as { conformance: null; methodology: unknown } | null },
}));

vi.mock('$lib/v1', () => ({ getProvenance: vi.fn() }));
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

afterEach(() => {
	provState.data = null;
});

const liveMethodology = {
	otp_definition: 'LIVE-NOTE-OTP: on-time band -60s..+300s, observation-weighted',
	cancellation: 'LIVE-NOTE-CANCEL: canceled trip-days / observed trip-days, ramp-in',
};

describe('MetricsExplainer — live pipeline note', () => {
	it('renders the matched methodology string as a pipeline note inside its card', () => {
		provState.data = { conformance: null, methodology: liveMethodology };
		render(MetricsExplainer);

		// The pipeline-note overline appears (once per matched metric), and the
		// verbatim live strings are rendered as-is.
		expect(screen.getAllByText(metricsCopy.en.sections.pipelineNote).length).toBeGreaterThanOrEqual(
			2,
		);
		expect(screen.getByText(liveMethodology.otp_definition)).toBeInTheDocument();
		expect(screen.getByText(liveMethodology.cancellation)).toBeInTheDocument();

		// One note block per matched metric, each anchored in a metric card.
		const notes = document.querySelectorAll('[data-slot="pipeline-note"]');
		expect(notes.length).toBeGreaterThanOrEqual(2);
	});

	it('renders NO pipeline note when methodology is absent (card unchanged)', () => {
		provState.data = null;
		render(MetricsExplainer);

		expect(screen.queryByText(metricsCopy.en.sections.pipelineNote)).toBeNull();
		expect(document.querySelectorAll('[data-slot="pipeline-note"]').length).toBe(0);
	});
});
