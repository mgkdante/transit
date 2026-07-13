import { describe, expect, it } from 'vitest';

import { copy } from './receipt.copy';

describe('Daily Receipt article copy', () => {
	it('matches the approved English article, rail, card, and caveat contract', () => {
		expect(copy.en.article).toEqual({
			watermark: 'Receipt',
			back: '← Back to the dashboard',
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
				subtitle: 'The day’s reliability figures, affected service, and worst readings',
			},
			time: {
				title: 'By time of day',
				subtitle: 'Severe delays across the day’s service periods',
			},
			delivered: {
				title: 'Service delivered',
				subtitle: 'Scheduled service split into delivered, cancelled, and silent outcomes',
			},
			silent: {
				title: 'Scheduled but never appeared',
				subtitle: 'Lines with scheduled trips that never appeared in the live feed',
			},
		});
		expect(copy.en.caveatLabel).toBe('Caveat');
	});

	it('matches the approved French article, rail, card, and caveat contract', () => {
		expect(copy.fr.article).toEqual({
			watermark: 'Reçu',
			back: '← Retour au tableau de bord',
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
				subtitle: 'Les chiffres de fiabilité du jour, le service touché et les pires lectures',
			},
			time: {
				title: 'Par moment de la journée',
				subtitle: 'Les retards graves selon les périodes de service de la journée',
			},
			delivered: {
				title: 'Service livré',
				subtitle: 'Le service planifié réparti entre livré, annulé et silencieux',
			},
			silent: {
				title: 'Planifiés mais jamais apparus',
				subtitle:
					'Les lignes dont des voyages planifiés ne sont jamais apparus dans le flux en direct',
			},
		});
		expect(copy.fr.caveatLabel).toBe('Mise en garde');
		expect(copy.fr.dayVerdict.worst('Bridge', '40 pts')).toBe('pire ligne Bridge (40 pts perdus)');
	});
});
