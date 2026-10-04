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
	link: 'Details',
	linkAria: (host) => `Open alert details on ${host} (new tab)`,
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
	link: 'Détails',
	linkAria: (host) => `Ouvrir les détails sur ${host} (nouvel onglet)`,
};

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

const ALERT_BARE = {
	id: 'al-2',
	severity: 'high',
	header_key: 'Réduction de service',
} as unknown as Alert;

const ALERT_SOURCE_MESSAGE = {
	...ALERT_FULL,
	id: 'al-source-message',
	header_text: 'Votre ligne',
	header_text_en: 'Your line',
	description: '<p>La ligne <strong>24</strong> est détournée &amp; ralentie.</p>',
	description_en: '<p>Route <strong>24</strong> is diverted &amp; delayed.</p>',
} as Alert;

describe('AffectedAlerts — rendering', () => {
	it.each(['en', 'fr'] as const)('rejects raw provider copy in %s', (locale) => {
		const { container } = render(AffectedAlerts, {
			props: {
				alerts: [
					{
						...ALERT_FULL,
						header_key: 'Votre ligne',
						header_text: 'Votre arrêt',
						header_text_en: 'Your stop',
						description: 'null',
						description_en: '{"text": None}',
					},
				],
				locale,
				copy: locale === 'en' ? EN_COPY : FR_COPY,
			},
		});
		expect(
			screen.getByText(locale === 'en' ? 'Service alert' : 'Alerte de service'),
		).toBeInTheDocument();
		expect(container.textContent).not.toMatch(/Votre ligne|Votre arrêt|Your stop|None|null/);
	});

	it('renders the heading + a labelled list when alerts are present', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		expect(screen.getByText('Service alerts')).toBeInTheDocument();
		expect(
			screen.getByRole('list', { name: 'Service alerts affecting this stop' }),
		).toBeInTheDocument();
	});

	it('shows the localized EN headline + cause/effect labels + window', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		expect(screen.getByText('Detour on line 24')).toBeInTheDocument();
		expect(screen.getByText('Construction')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.getByText('From')).toBeInTheDocument();
		expect(screen.getByText('Until')).toBeInTheDocument();
	});

	it('shows the localized FR headline + FR cause/effect labels', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'fr', copy: FR_COPY } });

		expect(screen.getByText('Détour sur la ligne 24')).toBeInTheDocument();
		expect(screen.getByText('Travaux')).toBeInTheDocument();
		expect(screen.getByText('Détour')).toBeInTheDocument();
	});

	it('renders scrubbed localized source descriptions instead of generic headers', async () => {
		const { rerender } = render(AffectedAlerts, {
			props: { alerts: [ALERT_SOURCE_MESSAGE], locale: 'en', copy: EN_COPY },
		});

		expect(screen.getByText('Route 24 is diverted & delayed.')).toBeInTheDocument();
		expect(screen.queryByText('Your line')).not.toBeInTheDocument();

		await rerender({ alerts: [ALERT_SOURCE_MESSAGE], locale: 'fr', copy: FR_COPY });
		expect(screen.getByText('La ligne 24 est détournée & ralentie.')).toBeInTheDocument();
		expect(screen.queryByText('Votre ligne')).not.toBeInTheDocument();
	});

	it('encodes severity with a data attribute + a visually-hidden severity word', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_FULL], locale: 'en', copy: EN_COPY } });

		const item = screen.getByRole('listitem');
		expect(item).toHaveAttribute('data-severity', 'critical');
		expect(within(item).getByText('Critical')).toBeInTheDocument();
	});

	it('omits the meta block entirely for an alert with no cause/effect/window', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_BARE], locale: 'en', copy: EN_COPY } });

		expect(screen.getByText('Réduction de service')).toBeInTheDocument();
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

	it('marks foreign provider text and safely links to the actual fallback language', () => {
		render(AffectedAlerts, {
			props: {
				alerts: [
					{
						...ALERT_FULL,
						description: 'Texte français seulement',
						message: {
							snapshot_id: '1',
							alert_index: 0,
							captured_utc: '2026-10-04T00:00:00Z',
							description_language: 'fr',
							url_language: 'fr',
						},
						description_en: null,
						header_text_en: null,
						url: 'https://example.test/fr/avis',
						url_en: 'javascript:alert(1)',
					} as Alert,
				],
				locale: 'en',
				copy: EN_COPY,
			},
		});
		expect(screen.getByText('Texte français seulement')).toHaveAttribute('lang', 'fr');
		expect(screen.getAllByText('(French only)')).toHaveLength(2);
		const link = screen.getByRole('link', { name: 'Open alert details on example.test (new tab)' });
		expect(link).toHaveAttribute('href', 'https://example.test/fr/avis');
		expect(link).toHaveAttribute('hreflang', 'fr');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
	});

	it('marks a header_key fallback as unknown without inheriting the page language', () => {
		render(AffectedAlerts, { props: { alerts: [ALERT_BARE], locale: 'en', copy: EN_COPY } });
		expect(screen.getByText('Réduction de service')).toHaveAttribute('lang', '');
		expect(screen.getByText('(Source language unspecified)')).toBeInTheDocument();
		expect(screen.queryByText('(French only)')).not.toBeInTheDocument();
	});
});

describe('AffectedAlerts — severity sort + cap disclosure', () => {
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

		expect(screen.getByText('Crit one')).toBeInTheDocument();
		expect(screen.getByText('High two')).toBeInTheDocument();
		expect(screen.queryByText('Watch one')).not.toBeInTheDocument();
		expect(screen.queryByText('Watch two')).not.toBeInTheDocument();
		expect(screen.getAllByRole('listitem')).toHaveLength(4);

		const more = screen.getByRole('button', { name: '+2 more' });
		expect(more).toHaveAttribute('aria-expanded', 'false');
	});

	it('expands to show every alert when the disclosure is clicked', async () => {
		render(AffectedAlerts, { props: { alerts: SORTED_SIX, locale: 'en', copy: EN_COPY } });

		await fireEvent.click(screen.getByRole('button', { name: '+2 more' }));

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

		expect(screen.queryByText('Service alerts')).not.toBeInTheDocument();
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
		expect(container.querySelector('[data-testid="affected-alerts"]')).toBeNull();
	});
});
