import { describe, expect, it } from 'vitest';

import { copy } from './receipt.copy';

describe('Daily Receipt article copy', () => {
	it.each([
		[0, '0 lines with severe-delay predictions', '0 lignes avec des prévisions de retard grave'],
		[1, '1 line with severe-delay predictions', '1 ligne avec des prévisions de retard grave'],
		[2, '2 lines with severe-delay predictions', '2 lignes avec des prévisions de retard grave'],
		[
			1000,
			'1,000 lines with severe-delay predictions',
			'1\u00a0000 lignes avec des prévisions de retard grave',
		],
	])('formats %i affected lines in each locale', (count, en, fr) => {
		expect(copy.en.dayVerdict.affected(count)).toBe(en);
		expect(copy.fr.dayVerdict.affected(count)).toBe(fr);
	});

	it('matches the approved English article, rail, card, and caveat contract', () => {
		expect(copy.en.article).toEqual({
			watermark: 'Receipt',
			back: '← Back to overview',
			tagsAria: 'Page keywords',
			tags: ['receipt', 'reliability', 'service', 'accountability'],
			generatedLabel: 'GENERATED',
			selectedLabel: 'FOR',
			sections: expect.any(Function),
		});
		expect(copy.en.article.sections(1)).toBe('1 section');
		expect(copy.en.article.sections(4)).toBe('4 sections');

		expect(copy.en.rail).toEqual({
			label: 'Day & contents',
			open: 'Open day controls and contents',
			close: 'Close day controls and contents',
			controls: 'Day',
			toc: 'On this page',
			counterPrefix: 'SEC',
		});

		expect(copy.en.cards).toEqual({
			main: {
				title: 'The receipt',
				subtitle: expect.stringMatching(/\?$/),
			},
			time: {
				title: 'By time of day',
				subtitle: expect.stringMatching(/\?$/),
			},
			delivered: {
				title: 'Service counts',
				subtitle: expect.stringMatching(/\?$/),
			},
			silent: {
				title: 'Scheduled but never appeared',
				subtitle: expect.stringMatching(/\?$/),
			},
		});
		expect(copy.en.caveatLabel).toBe('Caveat');
	});

	it('matches the approved French article, rail, card, and caveat contract', () => {
		expect(copy.fr.article).toEqual({
			watermark: 'Reçu',
			back: '← Retour à l’aperçu',
			tagsAria: 'Mots-clés de la page',
			tags: ['reçu', 'fiabilité', 'service', 'imputabilité'],
			generatedLabel: 'PRODUIT',
			selectedLabel: 'POUR LE',
			sections: expect.any(Function),
		});
		expect(copy.fr.article.sections(1)).toBe('1 section');
		expect(copy.fr.article.sections(4)).toBe('4 sections');

		expect(copy.fr.rail).toEqual({
			label: 'Jour et sommaire',
			open: 'Ouvrir le choix du jour et le sommaire',
			close: 'Fermer le choix du jour et le sommaire',
			controls: 'Jour',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		});

		expect(copy.fr.cards).toEqual({
			main: {
				title: 'Le reçu',
				subtitle: expect.stringMatching(/\?$/),
			},
			time: {
				title: 'Par moment de la journée',
				subtitle: expect.stringMatching(/\?$/),
			},
			delivered: {
				title: 'Décomptes de service',
				subtitle: expect.stringMatching(/\?$/),
			},
			silent: {
				title: 'Planifiés mais jamais apparus',
				subtitle: expect.stringMatching(/\?$/),
			},
		});
		expect(copy.fr.caveatLabel).toBe('Mise en garde');
		expect(copy.fr.dayVerdict.worst('Bridge', '+4,2 pts')).toBe(
			'retard moyen maximal : Bridge (ponctualité +4,2 pts c. réseau)',
		);
	});
});
