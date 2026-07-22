// repeatOffenders.copy.ts: co-located bilingual copy for the Repeat-offenders
// ("récidivistes") accountability surface (S14 re-seat).
//
// All user-facing strings the screen renders live here, keyed by Locale, so the
// .svelte files carry zero inline copy. The FR voice is the canonical product voice
// (mirrors the raw-FR /v1 headers); EN is the parallel translation. Provider-agnostic:
// no operator/city names. Honest-not-alarmist tone — the copy EXPLAINS why an entity
// is flagged (natural-frequency recurrence), never dramatizes it. Absence strings
// carry NO em-dash.
//
// S14 grows the primary by_grain path (combined rail, stacked trip/vehicle cards,
// worst-N ladders, natural-frequency evidence, and trays) while KEEPING the legacy
// ledger fields (the fallback path reads the same recurrence / type / caveat copy).

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import { historyCopy } from '$lib/components/surface/historyCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'ACCOUNTABILITY · REPEAT OFFENDERS',
		heading: 'Repeat offenders',
		subheading: '// RÉCIDIVISTES',
		lede: 'The trips and vehicles that run severely late on day after day, ranked worst first by how reliably they slip. We never invent data: an absent reading shows as “no data”, never a fabricated zero.',
		article: articleCopy('en', {
			watermark: 'Repeat',
			tags: ['offenders', 'trips', 'vehicles', 'recurrence'],
			sections: (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		}),
		asOf: 'AS OF',
		history: {
			navigator: historyCopy('en', {
				mode: 'date',
				group: 'Browse retained repeat-offender history',
				picker: {
					group: 'Repeat-offender history',
					clear: 'Current data',
					anyStart: 'Earliest date',
					anyEnd: 'Latest date',
					single: 'History date',
				},
			}),
			coverage: (first, last) => `History available: ${first} to ${last}.`,
			selection: (date) => `Showing date: ${date}.`,
			correction: {
				malformed: 'That date was not valid. Showing the latest repeat offenders.',
				'outside-coverage':
					'That date is outside retained history. Showing the latest repeat offenders.',
				gap: 'That date falls in a publication gap. Showing the latest repeat offenders.',
				unpublished: 'That day was not published. Showing the latest repeat offenders.',
			},
			retainedWindow: (date) => `Available retained observations ending ${date}.`,
			retainedWorstSubtitle:
				'The worst repeat offender in the selected retained observations, its severe rate, and its streak',
			retainedHeroNone: 'No repeat offender ranks in the selected retained observations.',
		},
		rail: {
			label: 'View & contents',
			open: 'Open view controls and contents',
			close: 'Close view controls and contents',
			controls: 'View controls',
			toc: 'On this page',
			counterPrefix: 'SEC',
		},
		cards: {
			worst: {
				title: 'Worst repeat offender',
				subtitle: 'The current worst repeat offender, its severe rate, and its streak',
			},
			trips: {
				title: 'Trips',
				subtitle: 'Trips ranked by repeated severe lateness across observed days',
			},
			vehicles: {
				title: 'Vehicles',
				subtitle: 'Vehicles ranked by repeated severe lateness across observed days',
			},
		},
		caveatLabel: 'Caveat',
		viewControlsLabel: 'View',
		grain: {
			label: 'Window',
			week: 'Week',
			month: 'Month',
		},
		window: {
			week: 'Recurrence read over the latest trailing week of service.',
			month: 'Recurrence read over the latest trailing month of service.',
		},
		worstN: {
			label: 'Show',
			all: 'All',
		},
		headline: {
			label: 'Severe-delay rate',
			explanation:
				'Each row is a single trip or vehicle that keeps running severely late. The bar is its severe-delay rate, the share of its readings more than five minutes behind schedule, ranked worst first by the cautious (Wilson) lower bound, so a chronic offender with plenty of readings outranks a noisy one with few. The line beneath each bar says how many of its observed service days were late-prone, so you can see the recurrence, not just the average.',
		},
		hero: {
			label: 'Worst repeat offender',
			overline: '#1 offender',
			streakLabel: 'Streak',
			rateWithCi: (ratePct, lo, hi) =>
				`${ratePct} of readings severely late (95% sure between ${lo} and ${hi}%).`,
			rateNoCi: (ratePct) => `${ratePct} of readings severely late.`,
			none: 'No repeat offender ranks right now.',
		},
		ladder: {
			heading: 'Worst offenders',
			severeRateLabel: 'Severe-delay rate',
			ci: '95% CI',
		},
		chart: {
			popover: {
				recurrence: 'Recurrence',
				averageDelay: 'Average delay',
				readings: 'Readings',
				viewLine: 'View line',
			},
		},
		evidenceTable: {
			caption: 'Evidence for ranked repeat offenders',
			columns: {
				item: 'Item',
				typeId: 'Type / ID',
				severeRate: 'Severe-delay rate',
				recurrence: 'Recurrence',
				averageDelay: 'Average delay',
				readings: 'Readings',
			},
		},
		recurrence: {
			naturalFrequency: (lateDays, observedDays) =>
				`Late-prone on ${lateDays} of ${observedDays} observed days`,
			unknown: 'recurrence not recorded',
		},
		note: {
			severe: 'severe',
			samples: 'n',
		},
		tray: {
			heading: 'Below the reliable-reading floor',
			reason: 'Too few observations to rank (fewer than 30 readings) · not ranked.',
			listLabel: 'Un-ranked offenders, below the observations floor',
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		type: {
			trip: 'Trip',
			vehicle: 'Vehicle',
			route: 'Line',
			stop: 'Stop',
			other: 'Entity',
		},
		unnamed: (id) => `Item ${id}`,
		viewDetail: (title) => `View detail for ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'A trailing-window recurrence proxy, not a certified scorecard. “Observed days” counts only the service days we actually recorded this entity, so the denominator reflects our coverage, not the full timetable, and small samples vary. Open a row to see the offending line in full.',
		units: { min: ' min', pct: '%' },

		listSection: 'Worst first',
		listSummary: 'Repeat-offender lines and stops, ranked by average delay, worst first.',
		rowCaption: 'Average delay, with how often the lateness recurs',
		recurrenceLabel: 'recurs',
		recurrenceUnknown: 'recurrence not recorded',
	},
	fr: {
		kicker: 'REDDITION DE COMPTES · RÉCIDIVISTES',
		heading: 'Récidivistes',
		subheading: '// REPEAT OFFENDERS',
		lede: 'Les voyages et les véhicules qui accumulent les retards graves jour après jour, classés du pire au moins pire selon la régularité de leurs ratés. On n’invente jamais de données : une lecture absente s’affiche « aucune donnée », jamais un zéro fabriqué.',
		article: articleCopy('fr', {
			watermark: 'Récidive',
			tags: ['récidivistes', 'voyages', 'véhicules', 'récurrence'],
			sections: (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		}),
		asOf: 'À JOUR AU',
		history: {
			navigator: historyCopy('fr', {
				mode: 'date',
				group: 'Parcourir l’historique conservé des récidivistes',
				picker: {
					group: 'Historique des récidivistes',
					clear: 'Données actuelles',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
					single: 'Date historique',
				},
			}),
			coverage: (first: string, last: string) => `Historique disponible : du ${first} au ${last}.`,
			selection: (date: string) => `Date affichée : ${date}.`,
			correction: {
				malformed: 'Cette date n’était pas valide. Affichage des récidivistes les plus récents.',
				'outside-coverage':
					'Cette date est hors de l’historique conservé. Affichage des récidivistes les plus récents.',
				gap: 'Cette date tombe dans une lacune de publication. Affichage des récidivistes les plus récents.',
				unpublished:
					'Cette journée n’a pas été publiée. Affichage des récidivistes les plus récents.',
			},
			retainedWindow: (date: string) =>
				`Observations conservées disponibles se terminant le ${date}.`,
			retainedWorstSubtitle:
				'Le pire récidiviste des observations conservées sélectionnées, son taux de retards graves et sa série',
			retainedHeroNone: 'Aucun récidiviste classé dans les observations conservées sélectionnées.',
		},
		rail: {
			label: 'Vue et sommaire',
			open: 'Ouvrir les commandes et le sommaire',
			close: 'Fermer les commandes et le sommaire',
			controls: 'Commandes de vue',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		},
		cards: {
			worst: {
				title: 'Pire récidiviste',
				subtitle: 'Le pire récidiviste actuel, son taux de retards graves et sa série',
			},
			trips: {
				title: 'Voyages',
				subtitle: 'Voyages classés selon la répétition des retards graves sur les jours observés',
			},
			vehicles: {
				title: 'Véhicules',
				subtitle: 'Véhicules classés selon la répétition des retards graves sur les jours observés',
			},
		},
		caveatLabel: 'Mise en garde',
		viewControlsLabel: 'Vue',
		grain: {
			label: 'Fenêtre',
			week: 'Semaine',
			month: 'Mois',
		},
		window: {
			week: 'Récurrence calculée sur la dernière semaine glissante de service.',
			month: 'Récurrence calculée sur le dernier mois glissant de service.',
		},
		worstN: {
			label: 'Afficher',
			all: 'Tout',
		},
		headline: {
			label: 'Taux de retards graves',
			explanation:
				'Chaque rangée est un seul voyage ou véhicule qui accumule les retards graves. La barre indique son taux de retards graves, soit la part de ses relevés à plus de cinq minutes de retard, classé du pire au moins pire selon la borne inférieure prudente (Wilson), afin qu’un récidiviste chronique avec beaucoup de relevés devance un cas bruyant avec peu de relevés. La ligne sous chaque barre indique combien de ses jours de service observés étaient sujets aux retards, pour voir la récurrence et pas seulement la moyenne.',
		},
		hero: {
			label: 'Pire récidiviste',
			overline: 'Récidiviste n°1',
			streakLabel: 'Série',
			rateWithCi: (ratePct: string, lo: string, hi: string) =>
				`${ratePct} des relevés en retard grave (sûr à 95 % entre ${lo} et ${hi} %).`,
			rateNoCi: (ratePct: string) => `${ratePct} des relevés en retard grave.`,
			none: 'Aucun récidiviste classé pour l’instant.',
		},
		ladder: {
			heading: 'Pires récidivistes',
			severeRateLabel: 'Taux de retards graves',
			ci: 'IC à 95 %',
		},
		chart: {
			popover: {
				recurrence: 'Récurrence',
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
				viewLine: 'Voir la ligne',
			},
		},
		evidenceTable: {
			caption: 'Données probantes des récidivistes classés',
			columns: {
				item: 'Élément',
				typeId: 'Type / ID',
				severeRate: 'Taux de retards graves',
				recurrence: 'Récurrence',
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
			},
		},
		recurrence: {
			naturalFrequency: (lateDays: number, observedDays: number) =>
				`Sujet aux retards ${lateDays} ${lateDays === 1 ? 'jour' : 'jours'} sur ${observedDays} ${observedDays === 1 ? 'observé' : 'observés'}`,
			unknown: 'récurrence non consignée',
		},
		note: {
			severe: 'graves',
			samples: 'n',
		},
		tray: {
			heading: 'Sous le seuil de lecture fiable',
			reason: 'Trop peu d’observations pour un classement (moins de 30 relevés) · non classés.',
			listLabel: 'Récidivistes non classés, sous le seuil d’observations',
			rowSubtitle: (kind: string, id: string) => `${kind} · ${id}`,
		},
		type: {
			trip: 'Voyage',
			vehicle: 'Véhicule',
			route: 'Ligne',
			stop: 'Arrêt',
			other: 'Entité',
		},
		unnamed: (id: string) => `Élément ${id}`,
		viewDetail: (title: string) => `Voir le détail de ${title}`,
		shownOfTotal: (shown: number, total: number) => `· ${shown}/${total}`,
		caveat:
			'Une estimation de récurrence sur fenêtre glissante, pas un bulletin certifié. Les « jours observés » ne comptent que les jours de service réellement relevés pour cette entité, donc le dénominateur reflète notre couverture, pas l’horaire complet, et les petits échantillons varient. Ouvrez une rangée pour voir la ligne fautive au complet.',
		units: { min: ' min', pct: '%' },

		listSection: 'Les pires d’abord',
		listSummary: 'Lignes et arrêts récidivistes, classés par retard moyen, les pires d’abord.',
		rowCaption: 'Retard moyen, avec la fréquence de récurrence du retard',
		recurrenceLabel: 'récurrence',
		recurrenceUnknown: 'récurrence non consignée',
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type RepeatOffendersCopy = (typeof copy)[Locale];
