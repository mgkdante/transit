import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Alert } from '$lib/v1/schemas';
import AffectedAlerts, { type AffectedAlertsCopy } from './AffectedAlerts.svelte';

const EN_COPY: AffectedAlertsCopy = {
	heading: 'Service alerts',
	listLabel: 'Service alerts affecting this stop',
	cause: 'Cause',
	effect: 'Effect',
	from: 'From',
	until: 'Until',
	severity: { critical: 'Critical', high: 'High', watch: 'Watch' },
	more: (n) => `+${n} more`,
	showLess: 'Show less',
};

const FR_COPY: AffectedAlertsCopy = {
	heading: 'Avis de service',
	listLabel: 'Avis de service touchant cet arrêt',
	cause: 'Cause',
	effect: 'Effet',
	from: 'À partir de',
	until: 'Jusqu’à',
	severity: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
	more: (n) => `+${n} de plus`,
	showLess: 'Réduire',
};

// An alert carrying an EN + FR headline, a known GTFS-RT cause + effect, and an
// active window. `severity: 'critical'` drives the severity rail + the a11y word.
const ALERT_FULL = {
	id: 'al-1',
	severity: 'critical',
	header_key: 'cle-fr',
	header_text: 'Détour sur la ligne 24',
	header_text_en: 'Detour on line 24',
	cause: 'CONSTRUCTION',
	effect: 'DETOUR',
	start_utc: '2026-06-15T12:00:00Z',
	end_utc: '2026-06-16T03:00:00Z',
	routes: ['24'],
} as unknown as Alert;

// A bare alert: a high-severity headline, no cause/effect/window → the meta block
// must be omitted, never fabricated.
const ALERT_BARE = {
	id: 'al-2',
	severity: 'high',
	header_key: 'Réduction de service',
} as unknown as Alert;

describe('AffectedAlerts — rendering', () => {
	it('renders the heading + a labelled list when alerts are present', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		expect(screen.getByText('Service alerts')).toBeInTheDocument();
		expect(
			screen.getByRole('list', { name: 'Service alerts affecting this stop' }),
		).toBeInTheDocument();
	});

	it('shows the localized EN headline + cause/effect labels + window', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		// EN headline preferred (header_text_en) when locale is en.
		expect(screen.getByText('Detour on line 24')).toBeInTheDocument();
		// Cause/effect resolve through gtfsAlertLabels (humanized, bilingual).
		expect(screen.getByText('Construction')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		// Window captions present (the exact wall-clock string is zone-formatted).
		expect(screen.getByText('From')).toBeInTheDocument();
		expect(screen.getByText('Until')).toBeInTheDocument();
	});

	it('shows the localized FR headline + FR cause/effect labels', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'fr', copy: FR_COPY } });

		// FR headline preferred (header_text) when locale is fr.
		expect(screen.getByText('Détour sur la ligne 24')).toBeInTheDocument();
		expect(screen.getByText('Travaux')).toBeInTheDocument(); // CONSTRUCTION (fr)
		expect(screen.getByText('Détour')).toBeInTheDocument(); // DETOUR (fr)
	});

	it('encodes severity with a data attribute + a visually-hidden severity word', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		const item = screen.getByRole('listitem');
		// Severity rides the dataviz severity scale via the data-severity attribute.
		expect(item).toHaveAttribute('data-severity', 'critical');
		// Colour is never the sole channel: the severity word is present for AT.
		expect(within(item).getByText('Critical')).toBeInTheDocument();
	});

	it('omits the meta block entirely for an alert with no cause/effect/window', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_BARE], locale: 'en', copy: EN_COPY } });

		expect(screen.getByText('Réduction de service')).toBeInTheDocument();
		// No fabricated cause/effect/window captions.
		expect(screen.queryByText('Cause')).not.toBeInTheDocument();
		expect(screen.queryByText('Effect')).not.toBeInTheDocument();
		expect(screen.queryByText('From')).not.toBeInTheDocument();
	});

	it('applies the supplied data-testid to the section root (slot is reserved)', () => {
		const { container } = render(AffectedAlerts, {
			props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY, testId: 'stop-alerts' },
		});
		expect(container.querySelector('[data-testid="stop-alerts"]')).not.toBeNull();
	});
});

describe('AffectedAlerts — severity sort + cap disclosure', () => {
	// Six alerts in NON-severity source order: the component renders them in the
	// order the caller supplies (the selector sorts severity-first upstream); the
	// cap keeps the first VISIBLE_CAP (4) visible. Headlines double as identifiers.
	const SORTED_SIX = [
		{ id: 's1', severity: 'critical', header_key: 'Crit one' },
		{ id: 's2', severity: 'critical', header_key: 'Crit two' },
		{ id: 's3', severity: 'high', header_key: 'High one' },
		{ id: 's4', severity: 'high', header_key: 'High two' },
		{ id: 's5', severity: 'watch', header_key: 'Watch one' },
		{ id: 's6', severity: 'watch', header_key: 'Watch two' },
	] as unknown as Alert[];

	it('caps the visible list at 4 and discloses the rest behind a "+N more" button', () => {
		render(AffectedAlerts, { props: { alerts: SORTED_SIX, locale: 'en', copy: EN_COPY } });

		// Only the first four (highest-severity) are visible.
		expect(screen.getByText('Crit one')).toBeInTheDocument();
		expect(screen.getByText('High two')).toBeInTheDocument();
		expect(screen.queryByText('Watch one')).not.toBeInTheDocument();
		expect(screen.queryByText('Watch two')).not.toBeInTheDocument();
		expect(screen.getAllByRole('listitem')).toHaveLength(4);

		// The overflow is named, not silently dropped — an honest disclosure.
		const more = screen.getByRole('button', { name: '+2 more' });
		expect(more).toHaveAttribute('aria-expanded', 'false');
	});

	it('expands to show every alert when the disclosure is clicked', async () => {
		render(AffectedAlerts, { props: { alerts: SORTED_SIX, locale: 'en', copy: EN_COPY } });

		await fireEvent.click(screen.getByRole('button', { name: '+2 more' }));

		// All six now render; the button flips to its collapse label + aria state.
		expect(screen.getAllByRole('listitem')).toHaveLength(6);
		expect(screen.getByText('Watch one')).toBeInTheDocument();
		expect(screen.getByText('Watch two')).toBeInTheDocument();
		const less = screen.getByRole('button', { name: 'Show less' });
		expect(less).toHaveAttribute('aria-expanded', 'true');
	});

	it('renders no disclosure when the list is within the cap', () => {
		render(AffectedAlerts, {
			props: { alerts: SORTED_SIX.slice(0, 4), locale: 'en', copy: EN_COPY },
		});

		expect(screen.getAllByRole('listitem')).toHaveLength(4);
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});

describe('AffectedAlerts — empty stand-down', () => {
	it('renders NOTHING when the alert list is empty', () => {
		const { container } = render(AffectedAlerts, {
			props: { alerts: [], locale: 'en', copy: EN_COPY },
		});

		// Stands down entirely — no heading, no list, no fabricated "no alerts" row.
		expect(screen.queryByText('Service alerts')).not.toBeInTheDocument();
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
		expect(container.querySelector('[data-testid="affected-alerts"]')).toBeNull();
	});
});
