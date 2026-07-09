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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MetricsExplainer from './MetricsExplainer.svelte';
import { metricsCopy } from './metrics.copy';

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/features/metrics/MetricsExplainer.svelte'),
	'utf-8',
);

const { provState } = vi.hoisted(() => ({
	provState: {
		data: null as { conformance: null; methodology: unknown } | null,
		error: null as Error | null,
		settled: true,
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
		get error() {
			return provState.error;
		},
		loading: false,
		get settled() {
			return provState.settled;
		},
		reload: vi.fn(),
	}),
}));

afterEach(() => {
	provState.data = null;
	provState.error = null;
	provState.settled = true;
});

const liveMethodology = {
	otp_definition: 'LIVE-NOTE-OTP: on-time band -60s..+300s, observation-weighted',
	cancellation: 'LIVE-NOTE-CANCEL: canceled trip-days / observed trip-days, ramp-in',
};

describe('MetricsExplainer — live pipeline note', () => {
	it('uses the long-form detail tokens and article line heights for narrative prose', () => {
		expect(source).toContain('var(--text-detail-body-mobile)');
		expect(source).toContain('var(--text-detail-body-desktop)');
		expect(source).toMatch(/line-height:\s*1\.8/);
		expect(source).toMatch(/line-height:\s*1\.9/);
	});

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

describe('MetricsExplainer — "how we measure" doctrine constants (D6, dynamic)', () => {
	const en = metricsCopy.en;

	it('renders the static service-day + rounding notes regardless of provenance', () => {
		provState.data = null;
		render(MetricsExplainer);

		expect(screen.getByText(en.provenance.howWeMeasure.serviceDay.heading)).toBeInTheDocument();
		expect(screen.getByText(en.provenance.howWeMeasure.serviceDay.body)).toBeInTheDocument();
		expect(screen.getByText(en.provenance.howWeMeasure.rounding.heading)).toBeInTheDocument();
		expect(screen.getByText(en.provenance.howWeMeasure.rounding.body)).toBeInTheDocument();
	});

	it('renders the SERVED min_n_rate / wilson_z verbatim when provenance carries them', () => {
		provState.data = {
			conformance: null,
			methodology: { min_n_rate: 30, wilson_z: 1.96 },
		} as never;
		render(MetricsExplainer);

		const line = screen.getByTestId('metrics-doctrine-constants');
		// The served numbers appear (locale-formatted: 30 and 1.96 in en).
		expect(line.textContent).toContain('30');
		expect(line.textContent).toContain('1.96');
		// The honest-absence stand-down is NOT shown when the values are present.
		expect(screen.queryByTestId('metrics-doctrine-absent')).toBeNull();
	});

	it('renders honest-absence (never a hardcoded 30 / 1.96) when methodology is absent', () => {
		provState.data = null;
		render(MetricsExplainer);

		expect(screen.getByTestId('metrics-doctrine-absent')).toBeInTheDocument();
		expect(screen.getByText(en.provenance.howWeMeasure.constants.absent)).toBeInTheDocument();
		expect(screen.queryByTestId('metrics-doctrine-constants')).toBeNull();
	});

	it('falls back to honest-absence when only ONE constant is present (never a mixed prose)', () => {
		provState.data = {
			conformance: null,
			methodology: { min_n_rate: 30 }, // wilson_z missing
		} as never;
		render(MetricsExplainer);

		expect(screen.getByTestId('metrics-doctrine-absent')).toBeInTheDocument();
		expect(screen.queryByTestId('metrics-doctrine-constants')).toBeNull();
	});
});

describe('MetricsExplainer — provenance edge states (supplementary, never blocking)', () => {
	const en = metricsCopy.en;

	it('renders the full methodology + structural-gaps card when provenance is null (no error)', () => {
		provState.data = null;
		provState.error = null;
		const { container } = render(MetricsExplainer);

		// The static article is intact: head, provenance preamble, every metric card,
		// and the structural-gaps card. No stand-down line (null is not an error).
		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.provenance.body)).toBeInTheDocument();
		expect(container.querySelector('#structural-gaps')).not.toBeNull();
		expect(screen.getByText(en.lacunes.gaps[0].body)).toBeInTheDocument();
		expect(screen.queryByText(en.provenance.unavailable)).toBeNull();
	});

	it('degrades to a localized stand-down line when provenance errors, methodology + LACUNES still render', () => {
		provState.data = null;
		provState.error = new Error('provenance fetch failed');
		provState.settled = true;
		const { container } = render(MetricsExplainer);

		// Honest stand-down line takes the conformance badge's slot.
		expect(screen.getByText(en.provenance.unavailable)).toBeInTheDocument();

		// The article never blanks or throws: the full methodology + structural-gaps
		// card render exactly as on the happy path.
		expect(screen.getByRole('heading', { level: 1, name: en.heading })).toBeInTheDocument();
		expect(screen.getByText(en.provenance.body)).toBeInTheDocument();
		const lacunes = container.querySelector('#structural-gaps');
		expect(lacunes).not.toBeNull();
		expect(lacunes?.textContent).toContain(en.lacunes.title);
		for (const gap of en.lacunes.gaps) {
			expect(lacunes?.textContent).toContain(gap.heading);
		}
	});

	it('shows no stand-down line before the provenance fetch settles', () => {
		provState.data = null;
		provState.error = null;
		provState.settled = false;
		render(MetricsExplainer);

		// Mid-load: no premature "unavailable" flash.
		expect(screen.queryByText(en.provenance.unavailable)).toBeNull();
	});
});
