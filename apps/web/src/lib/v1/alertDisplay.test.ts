import { describe, expect, it } from 'vitest';
import type { Alert } from '$lib/v1/schemas';
import { alertDisplayText } from './alertDisplay';

const genericStopAlert: Alert = {
	id: 'stop-alert',
	severity: 'watch',
	header_key: 'Votre arrêt',
	header_text: 'Votre arrêt',
	header_text_en: 'Your stop',
	description: 'Cet arrêt est annulé en raison de travaux.',
	description_en: 'This stop is cancelled due to roadworks.',
	routes: ['161'],
	stops: ['53355'],
};

describe('alertDisplayText', () => {
	it('prefers the actual English description over generic STM alert headers', () => {
		expect(alertDisplayText(genericStopAlert, 'en')).toBe(
			'This stop is cancelled due to roadworks.',
		);
	});

	it('drops stringified null translation payloads before falling back', () => {
		expect(
			alertDisplayText(
				{
					...genericStopAlert,
					header_text_en: "{'text': None, 'language': 'en'}",
					description_en: "{'text': None, 'language': 'en'}",
				},
				'en',
			),
		).toBe('Cet arrêt est annulé en raison de travaux.');
	});

	it('strips STM html from descriptions before display', () => {
		expect(
			alertDisplayText(
				{
					...genericStopAlert,
					description_en: 'Temporary terminus. <a href="https://stm.info">More info.</a>',
				},
				'en',
			),
		).toBe('Temporary terminus. More info.');
	});

	it('falls back to the shared "Service alert" for a generic-only headline', () => {
		expect(
			alertDisplayText(
				{ id: 'g', severity: 'watch', header_key: '', header_text: 'Votre ligne' },
				'en',
			),
		).toBe('Service alert');
		expect(
			alertDisplayText(
				{ id: 'g', severity: 'watch', header_key: '', header_text: 'Votre ligne' },
				'fr',
			),
		).toBe('Alerte de service');
	});
});
