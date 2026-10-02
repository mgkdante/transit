import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import { historyCopy } from '$lib/components/surface/historyCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'ACCOUNTABILITY · REPEAT OFFENDERS',
		heading: 'Repeat offenders',
		subheading: '// RÉCIDIVISTES',
		lede: 'Trips and vehicles with recurring delays over five minutes.',
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
			retainedWorstSubtitle: 'Severe-delay rate and recurrence in the selected observations',
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
				subtitle: 'Severe-delay rate and recurrence',
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
				'Bars show the share of readings more than five minutes late. Ranking uses the Wilson lower bound to account for sample size. Recurrence counts late-prone days among the days observed; those days need not be consecutive.',
		},
		hero: {
			label: 'Worst repeat offender',
			overline: '#1 offender',
			recurrenceLabel: 'Recurrence',
			rateWithCi: (ratePct, lo, hi) =>
				`${ratePct} of readings severely late (95% Wilson interval: ${lo}–${hi}%).`,
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
			'Observed days reflect recorded coverage, not the full timetable. Missing readings stay missing, and small samples vary. Open a row for its line’s details.',
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
		lede: 'Les voyages et véhicules qui accumulent les retards de plus de cinq minutes.',
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
				'Taux de retards graves et récurrence dans les observations sélectionnées',
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
				subtitle: 'Taux de retards graves et récurrence',
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
				'Les barres montrent la part des relevés à plus de cinq minutes de retard. Le classement utilise la borne inférieure de Wilson pour tenir compte de la taille de l’échantillon. La récurrence compte les jours sujets aux retards parmi les jours observés, sans exiger qu’ils soient consécutifs.',
		},
		hero: {
			label: 'Pire récidiviste',
			overline: 'Récidiviste n°1',
			recurrenceLabel: 'Récurrence',
			rateWithCi: (ratePct: string, lo: string, hi: string) =>
				`${ratePct} des relevés en retard grave (intervalle de Wilson à 95 % : ${lo}–${hi} %).`,
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
			'Les jours observés reflètent la couverture des relevés, pas l’horaire complet. Les lectures absentes restent absentes et les petits échantillons varient. Ouvrez une rangée pour voir les détails de sa ligne.',
		units: { min: ' min', pct: '%' },

		listSection: 'Les pires d’abord',
		listSummary: 'Lignes et arrêts récidivistes, classés par retard moyen, les pires d’abord.',
		rowCaption: 'Retard moyen, avec la fréquence de récurrence du retard',
		recurrenceLabel: 'récurrence',
		recurrenceUnknown: 'récurrence non consignée',
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type RepeatOffendersCopy = (typeof copy)[Locale];
