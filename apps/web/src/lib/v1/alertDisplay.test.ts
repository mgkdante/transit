import { describe, expect, it } from 'vitest';
import { alertDisplayText, type AlertDisplaySource } from './alertDisplay';

const localizedSource = {
	header_key: 'Votre arrêt',
	header_text: 'Votre arrêt',
	header_text_en: 'Your stop',
	description: 'Cet arrêt est annulé en raison de travaux.',
	description_en: 'This stop is cancelled due to roadworks.',
} satisfies AlertDisplaySource;

describe('alertDisplayText', () => {
	it('prefers the requested English and French source descriptions', () => {
		expect(alertDisplayText(localizedSource, 'en')).toBe(
			'This stop is cancelled due to roadworks.',
		);
		expect(alertDisplayText(localizedSource, 'fr')).toBe(
			'Cet arrêt est annulé en raison de travaux.',
		);
	});

	it('falls across locales only when the requested description is absent', () => {
		expect(alertDisplayText({ description: 'Message français', description_en: null }, 'en')).toBe(
			'Message français',
		);
		expect(alertDisplayText({ description: null, description_en: 'English message' }, 'fr')).toBe(
			'English message',
		);
	});

	it('scrubs HTML and decodes entities in both locale paths', () => {
		expect(
			alertDisplayText({ description_en: '<p>Route <strong>24</strong> &amp; 55</p>' }, 'en'),
		).toBe('Route 24 & 55');
		expect(
			alertDisplayText({ description: '<div>Lignes <b>24</b> &amp; 55&nbsp;touchées</div>' }, 'fr'),
		).toBe('Lignes 24 & 55 touchées');
	});

	it('uses meaningful localized header copy when source descriptions are absent', () => {
		expect(
			alertDisplayText(
				{ header_key: 'Votre ligne', header_text: 'Travaux sur René-Lévesque' },
				'fr',
			),
		).toBe('Travaux sur René-Lévesque');
		expect(
			alertDisplayText(
				{ header_text: 'Travaux sur René-Lévesque', header_text_en: 'Work on René-Lévesque' },
				'en',
			),
		).toBe('Work on René-Lévesque');
	});

	it('drops serialized nullish translation junk before choosing a real fallback', () => {
		expect(
			alertDisplayText(
				{
					description_en: '{"text": None, "language": "en"}',
					description: 'undefined',
					header_text_en: 'null',
					header_text: 'Votre arrêt',
					header_key: 'Votre ligne',
				},
				'en',
			),
		).toBe('Service alert');
	});

	it('uses the bilingual generic fallback only when no meaningful source copy exists', () => {
		const genericOnly: AlertDisplaySource = {
			header_key: '',
			header_text: 'Votre ligne',
			header_text_en: 'Your line',
		};

		expect(alertDisplayText(genericOnly, 'en')).toBe('Service alert');
		expect(alertDisplayText(genericOnly, 'fr')).toBe('Alerte de service');
		expect(alertDisplayText({}, 'en')).toBe('Service alert');
		expect(alertDisplayText({}, 'fr')).toBe('Alerte de service');
	});
});
