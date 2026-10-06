import { describe, expect, it } from 'vitest';
import { AlertMessageProvenanceSchema } from './schemas/alert_history';
import {
	alertDisplayText,
	alertDisplayUrl,
	alertLanguageNotice,
	type AlertDisplaySource,
} from './alertDisplay';

const message = AlertMessageProvenanceSchema.parse({
	snapshot_id: '1',
	alert_index: 0,
	captured_utc: '2026-10-04T00:00:00Z',
	header_language: 'fr',
	description_language: 'fr',
	url_language: 'fr',
});

const localizedSource = {
	message,
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
					message,
				},
				'fr',
			),
		).toEqual({ text: 'En-tête français', lang: 'fr', isFallback: false });
	});

	it('reports the actual language when falling back to foreign-language copy', () => {
		expect(alertDisplayText({ description: 'Message français', message }, 'en')).toEqual({
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
			alertDisplayText(
				{ description: '<div>Lignes <b>24</b> &amp; 55&nbsp;touchées</div>', message },
				'fr',
			),
		).toEqual({ text: 'Lignes 24 & 55 touchées', lang: 'fr', isFallback: false });
	});

	it('uses meaningful localized header copy when source descriptions are absent', () => {
		expect(
			alertDisplayText(
				{ header_key: 'Votre ligne', header_text: 'Travaux sur René-Lévesque', message },
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
	it.each(['en', 'fr'] as const)('restores the published UCI link on %s pages', (locale) => {
		const fr =
			'https://www.stm.info/fr/infos/etat-du-service/calendrier-des-evenements-planifies?utm_campaign=mip&utm_source=UCI&utm_medium=horairesstm';
		const en =
			'https://www.stm.info/en/info/service-updates/planned-events-calendar#id_deuxieme?utm_campaign=mip&utm_source=UCI&utm_medium=horairesstm';
		const source = {
			description: `Du 19 au 27 septembre, en raison des Championnats du Monde Route UCI 2026, votre ligne est déroutée durant certaines périodes. Info: stm.info/uci <a class="external" href="${fr}" target="_blank">Prévoyez vos déplacements</a>`,
			description_en: `From September 19 to 27, with the UCI Road World Championships 2026 taking place, this line is rerouted at certain times. stm.info/uci <a class="external" href="${en}" target="_blank">More info.</a>`,
		};
		const link = alertDisplayUrl(source, locale);
		expect(link).toEqual({
			href: locale === 'en' ? en : fr,
			host: 'www.stm.info',
			lang: null,
			isFallback: true,
		});
		expect(alertDisplayUrl({ ...source, message }, locale)).toEqual(link);
		expect(alertDisplayText(source, locale).text).not.toContain('<a');
		expect(alertDisplayUrl({ ...source, url: 'https://example.test/explicit' }, locale)?.href).toBe(
			'https://example.test/explicit',
		);
	});

	it.each([
		['No link', null],
		['<a href="https://example.test', null],
		['<a data-href="https://example.test">Info</a>', null],
		['<a href="https&Colon;//example.test">Info</a>', null],
		['<a href="https://example.test/?q=&constructor;">Info</a>', null],
		[
			'<a href="jav&#x61;script:alert(1)">Bad</a><a href="https://example.test/?a=1&amp;b=2">Info</a>',
			'https://example.test/?a=1&b=2',
		],
		['<a href="https://example.test/a">A</a><a href="https://example.test/b">B</a>', null],
	])('does not invent or conflate an embedded target: %s', (description_en, href) => {
		expect(alertDisplayUrl({ description_en }, 'en')?.href ?? null).toBe(href);
	});

	it.each(['en', 'fr'] as const)('uses the safe explicit URL in %s', (locale) => {
		const source = {
			message,
			url: 'https://example.test/fr/avis',
			url_en: 'https://example.test/en/alert',
		};
		expect(alertDisplayUrl(source, locale)).toEqual({
			href: source[locale === 'en' ? 'url_en' : 'url'],
			host: 'example.test',
			lang: locale,
			isFallback: false,
		});
	});

	it('falls back to the safe other-language URL when requested is missing or unsafe', () => {
		expect(
			alertDisplayUrl(
				{ message, url: 'https://example.test/fr/avis', url_en: 'javascript:alert(1)' },
				'en',
			),
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

it.each(['en', 'fr'] as const)('keeps untagged legacy wording unknown on %s pages', (locale) => {
	const result = alertDisplayText({ description: 'Agency wording' }, locale);
	expect(result).toEqual({ text: 'Agency wording', lang: null, isFallback: true });
	expect(alertLanguageNotice(result, locale)).toBe(
		locale === 'fr' ? '(langue source non précisée)' : '(Source language unspecified)',
	);
});

it('uses independent source tags for requested headers, foreign text and URLs', () => {
	const source = {
		description: 'English body',
		header_text: 'Titre français',
		url: 'https://example.test/en',
		message: { ...message, description_language: 'en', url_language: 'en' },
	};
	expect(alertDisplayText(source, 'fr')).toEqual({
		text: 'Titre français',
		lang: 'fr',
		isFallback: false,
	});
	expect(alertDisplayText({ ...source, header_text: 'Votre ligne' }, 'fr')).toEqual({
		text: 'English body',
		lang: 'en',
		isFallback: true,
	});
	const link = alertDisplayUrl(source, 'fr');
	expect(link).toMatchObject({ lang: 'en', isFallback: true });
	expect(alertLanguageNotice(link, 'fr')).toBe('(en anglais seulement)');
});
