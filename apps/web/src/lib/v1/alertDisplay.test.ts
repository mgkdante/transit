import { describe, expect, it } from 'vitest';
import { alertDisplayText, alertDisplayUrl, type AlertDisplaySource } from './alertDisplay';

const localizedSource = {
	header_key: 'Votre arrêt',
	header_text: 'Votre arrêt',
	header_text_en: 'Your stop',
	description: 'Cet arrêt est annulé en raison de travaux.',
	description_en: 'This stop is cancelled due to roadworks.',
} satisfies AlertDisplaySource;

describe('alertDisplayText', () => {
	it('prefers the requested English and French source descriptions', () => {
		expect(alertDisplayText(localizedSource, 'en')).toEqual({
			text: 'This stop is cancelled due to roadworks.',
			lang: 'en',
			isFallback: false,
		});
		expect(alertDisplayText(localizedSource, 'fr')).toEqual({
			text: 'Cet arrêt est annulé en raison de travaux.',
			lang: 'fr',
			isFallback: false,
		});
	});

	it('prefers a same-language header over a foreign-language description in both directions', () => {
		expect(
			alertDisplayText(
				{
					description: 'Message français',
					header_text_en: 'English header',
				},
				'en',
			),
		).toEqual({ text: 'English header', lang: 'en', isFallback: false });
		expect(
			alertDisplayText(
				{
					description_en: 'English message',
					header_text: 'En-tête français',
				},
				'fr',
			),
		).toEqual({ text: 'En-tête français', lang: 'fr', isFallback: false });
	});

	it('reports the actual language when falling back to foreign-language copy', () => {
		expect(alertDisplayText({ description: 'Message français' }, 'en')).toEqual({
			text: 'Message français',
			lang: 'fr',
			isFallback: true,
		});
		expect(alertDisplayText({ header_text_en: 'English header' }, 'fr')).toEqual({
			text: 'English header',
			lang: 'en',
			isFallback: true,
		});
	});

	it('scrubs HTML and decodes entities in both locale paths', () => {
		expect(
			alertDisplayText({ description_en: '<p>Route <strong>24</strong> &amp; 55</p>' }, 'en'),
		).toEqual({ text: 'Route 24 & 55', lang: 'en', isFallback: false });
		expect(
			alertDisplayText({ description: '<div>Lignes <b>24</b> &amp; 55&nbsp;touchées</div>' }, 'fr'),
		).toEqual({ text: 'Lignes 24 & 55 touchées', lang: 'fr', isFallback: false });
	});

	it('uses meaningful localized header copy when source descriptions are absent', () => {
		expect(
			alertDisplayText(
				{ header_key: 'Votre ligne', header_text: 'Travaux sur René-Lévesque' },
				'fr',
			),
		).toEqual({ text: 'Travaux sur René-Lévesque', lang: 'fr', isFallback: false });
		expect(
			alertDisplayText(
				{ header_text: 'Travaux sur René-Lévesque', header_text_en: 'Work on René-Lévesque' },
				'en',
			),
		).toEqual({ text: 'Work on René-Lévesque', lang: 'en', isFallback: false });
	});

	it('uses header_key only after both languages and marks its language undetermined', () => {
		expect(
			alertDisplayText(
				{
					description_en: 'null',
					description: 'undefined',
					header_text_en: 'Your stop',
					header_text: 'Votre ligne',
					header_key: 'metro.service.disruption',
				},
				'en',
			),
		).toEqual({
			text: 'metro.service.disruption',
			lang: null,
			isFallback: true,
		});
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
		).toEqual({ text: 'Service alert', lang: 'en', isFallback: false });
	});

	it('uses the bilingual generic fallback only when no meaningful source copy exists', () => {
		const genericOnly: AlertDisplaySource = {
			header_key: '',
			header_text: 'Votre ligne',
			header_text_en: 'Your line',
		};

		expect(alertDisplayText(genericOnly, 'en')).toEqual({
			text: 'Service alert',
			lang: 'en',
			isFallback: false,
		});
		expect(alertDisplayText(genericOnly, 'fr')).toEqual({
			text: 'Alerte de service',
			lang: 'fr',
			isFallback: false,
		});
		expect(alertDisplayText({}, 'en')).toEqual({
			text: 'Service alert',
			lang: 'en',
			isFallback: false,
		});
		expect(alertDisplayText({}, 'fr')).toEqual({
			text: 'Alerte de service',
			lang: 'fr',
			isFallback: false,
		});
	});
});

describe('alertDisplayUrl', () => {
	it('uses the requested-language live URL when it is safe', () => {
		const source = { url: 'https://example.test/fr/avis', url_en: 'https://example.test/en/alert' };
		expect(alertDisplayUrl(source, 'en')).toEqual({
			href: 'https://example.test/en/alert',
			host: 'example.test',
			lang: 'en',
			isFallback: false,
		});
		expect(alertDisplayUrl(source, 'fr')).toEqual({
			href: 'https://example.test/fr/avis',
			host: 'example.test',
			lang: 'fr',
			isFallback: false,
		});
	});

	it('falls back to the safe other-language URL when requested is missing or unsafe', () => {
		expect(
			alertDisplayUrl({ url: 'https://example.test/fr/avis', url_en: 'javascript:alert(1)' }, 'en'),
		).toEqual({
			href: 'https://example.test/fr/avis',
			host: 'example.test',
			lang: 'fr',
			isFallback: true,
		});
		expect(
			alertDisplayUrl({ url: 'data:text/html,x', url_en: 'https://example.test/en' }, 'fr'),
		).toEqual({
			href: 'https://example.test/en',
			host: 'example.test',
			lang: 'en',
			isFallback: true,
		});
		expect(alertDisplayUrl({ url: 'javascript:alert(1)', url_en: 'not a url' }, 'en')).toBeNull();
	});
});
