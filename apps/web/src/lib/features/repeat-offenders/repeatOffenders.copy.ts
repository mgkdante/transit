// repeatOffenders.copy.ts: co-located bilingual copy for the Repeat-offenders
// ("récidivistes") accountability surface.
//
// Co-located with RepeatOffenders.svelte so the screen owns no inline strings.
// The FR voice is the canonical product voice (mirrors the raw-FR /v1 headers);
// EN is the parallel translation. Provider-agnostic: no operator/city names.
//
// Shape: `Record<Locale, {...}>` extending the shared surface-head triple.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface RepeatOffendersCopy extends SurfaceHeadCopy {
	/** Section caption above the ranked list. */
	readonly listSection: string;
	/** Accessible summary of the ranked list (role="list"). */
	readonly listSummary: string;
	/** Per-list caption: what the headline value + magnitude bar encode. */
	readonly rowCaption: string;
	/** Accessible label for a row that links into its detail page. */
	readonly viewDetail: (title: string) => string;
	/** Subtitle prefix for the recurrence reading. */
	readonly recurrenceLabel: string;
	/** Subtitle fallback when a row carries no recurrence string. */
	readonly recurrenceUnknown: string;
	/** Mono mode-tag labels for the entity-type discriminator. */
	readonly type: {
		readonly route: string;
		readonly stop: string;
		/** Any other / unknown discriminator value. */
		readonly other: string;
	};
	/** Honest caveat under the list. */
	readonly caveat: string;
	/** Shown in place of a value when the contract reports null. */
	readonly noData: string;
	/** Units appended to formatted values (kept out of the .svelte). */
	readonly units: {
		readonly min: string;
	};
}

export const copy: Record<Locale, RepeatOffendersCopy> = {
	en: {
		kicker: 'ACCOUNTABILITY · REPEAT OFFENDERS',
		heading: 'Repeat offenders',
		subheading: '// RÉCIDIVISTES',
		lede: 'The lines and stops that run late again and again, ranked worst first by how reliably they slip. We never invent data: an absent delay shows as “no data”, never a fabricated zero.',
		listSection: 'Worst first',
		listSummary: 'Repeat-offender lines and stops, ranked by average delay, worst first.',
		rowCaption: 'Average delay, with how often the lateness recurs',
		viewDetail: (title) => `View detail for ${title}`,
		recurrenceLabel: 'recurs',
		recurrenceUnknown: 'recurrence not recorded',
		type: { route: 'Line', stop: 'Stop', other: 'Entity' },
		caveat:
			'A trailing-window roll-up of entities that are late again and again. The ranking is a recurrence proxy, not a certified scorecard, and small samples vary. Open a row to see the offending line or stop in full.',
		noData: 'no data',
		units: { min: ' min' },
	},
	fr: {
		kicker: 'REDDITION DE COMPTES · RÉCIDIVISTES',
		heading: 'Récidivistes',
		subheading: '// REPEAT OFFENDERS',
		lede: 'Les lignes et les arrêts qui accumulent les retards, classés du pire au moins pire selon la régularité de leurs ratés. On n’invente jamais de données : un retard absent s’affiche « aucune donnée », jamais un zéro fabriqué.',
		listSection: 'Les pires d’abord',
		listSummary: 'Lignes et arrêts récidivistes, classés par retard moyen, les pires d’abord.',
		rowCaption: 'Retard moyen, avec la fréquence de récurrence du retard',
		viewDetail: (title) => `Voir le détail de ${title}`,
		recurrenceLabel: 'récurrence',
		recurrenceUnknown: 'récurrence non consignée',
		type: { route: 'Ligne', stop: 'Arrêt', other: 'Entité' },
		caveat:
			'Un cumul sur fenêtre glissante des entités en retard de façon répétée. Le classement est une estimation de récurrence, pas un bulletin certifié, et les petits échantillons varient. Ouvrez une rangée pour voir la ligne ou l’arrêt fautif au complet.',
		noData: 'aucune donnée',
		units: { min: ' min' },
	},
};
