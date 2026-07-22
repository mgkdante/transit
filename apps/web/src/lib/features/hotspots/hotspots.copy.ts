// hotspots.copy.ts: co-located bilingual copy for the Hotspots surface (S12 re-seat).
//
// All user-facing strings the Hotspots screen renders live here, keyed by Locale, so
// the .svelte files carry zero inline copy. Provider-agnostic: no carrier name, no
// city hardcoded — a city/provider name comes from the SERVED label (or the provider
// id) at the call site, never fabricated here. Domain-intrinsic labels already owned
// by the spine primitives (the Chart's own a11y text, GrainPicker roles) are NOT
// duplicated here.

import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	fr: {
		kicker: 'RESPONSABILITÉ · POINTS CHAUDS',
		heading: 'Points chauds',
		subheading: '// PIRES EN PREMIER',
		lede: 'Les arrêts et les lignes qui tirent le réseau vers le bas, classés du pire au moins pire par le taux de retards graves. On n’invente jamais de données.',
		article: {
			watermark: 'Points chauds',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['chauds', 'lignes', 'arrêts', 'retards graves'],
			sections: (count: number) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'À JOUR AU',
		history: {
			navigator: {
				group: 'Parcourir l’historique conservé des points chauds',
				picker: {
					group: 'Historique des points chauds',
					start: 'Du',
					end: 'Au',
					clear: 'Données actuelles',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
					single: 'Date historique',
				},
				previous: 'Date précédente',
				next: 'Date suivante',
			},
			coverage: (first: string, last: string) => `Historique disponible : du ${first} au ${last}.`,
			selection: (date: string) => `Date affichée : ${date}.`,
			correction: {
				malformed: 'Cette date n’était pas valide. Affichage des points chauds les plus récents.',
				'outside-coverage':
					'Cette date est hors de l’historique conservé. Affichage des points chauds les plus récents.',
				gap: 'Cette date tombe dans une lacune de publication. Affichage des points chauds les plus récents.',
				unpublished:
					'Cette journée n’a pas été publiée. Affichage des points chauds les plus récents.',
			},
			retainedWindow: (date: string) =>
				`Observations conservées disponibles se terminant le ${date}.`,
			retainedTopSubtitle:
				'Le pire point chaud des observations conservées sélectionnées et les preuves qui l’expliquent',
			retainedVerdictNone:
				'Aucun point chaud classé dans les observations conservées sélectionnées.',
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
			top: {
				title: 'Point chaud principal',
				subtitle: 'Le pire point chaud actuel et les preuves qui l’expliquent',
			},
			lines: {
				title: 'Lignes',
				subtitle:
					'Lignes classées selon le taux de retards graves, y compris les petits échantillons',
			},
			stops: {
				title: 'Arrêts',
				subtitle:
					'Arrêts classés selon le taux de retards graves, y compris les petits échantillons',
			},
		},
		caveatLabel: 'Mise en garde',
		grain: {
			label: 'Granularité',
			day: 'Jour',
			week: 'Semaine',
			month: 'Mois',
			shift: 'Heures de pointe',
			shiftCompact: 'Pointe',
		},
		window: {
			day: 'Classement sur la dernière journée de service.',
			week: 'Classement sur la dernière semaine glissante.',
			month: 'Classement sur le dernier mois glissant.',
			shift:
				'Classement sur les heures de pointe (matin et soir) de la dernière semaine glissante.',
		},
		worstN: {
			label: 'Afficher',
			all: 'Tout',
		},
		ladder: {
			heading: 'Pires points',
			severeRateLabel: 'Taux de retards graves',
			ci: 'IC à 95 %',
		},
		chart: {
			scroll: (sectionTitle: string) =>
				`Faire défiler horizontalement le graphique ${sectionTitle}`,
			popover: {
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
				viewLine: 'Voir la ligne',
				viewStop: 'Voir l’arrêt',
			},
		},
		tray: {
			heading: 'Sous le seuil de lecture fiable',
			reason: 'Trop peu d’observations pour un classement (moins de 30 relevés) · non classés.',
			listLabel: 'Points non classés, sous le seuil d’observations',
			columns: {
				item: 'Élément',
				typeId: 'Type / ID',
				readings: 'Relevés',
			},
			rowSubtitle: (kind: string, id: string) => `${kind} · ${id}`,
		},
		note: {
			severe: 'graves',
			avg: 'moy',
			samples: 'n',
		},
		deltaLost: (pts: string) => `${pts} pts de ponctualité perdus`,
		verdict: {
			label: 'Point chaud n°1',
			topWithDelta: (name: string, deltaPts: string) =>
				`Pire point chaud : ${name}, ${deltaPts} pts de ponctualité perdus.`,
			topNoDelta: (name: string) => `Pire point chaud : ${name}.`,
			none: 'Aucun point chaud pour l’instant.',
		},
		type: {
			route: 'Ligne',
			stop: 'Arrêt',
		},
		unnamed: (id: string) => `Élément ${id}`,
		viewDetail: (title: string) => `Voir le détail de ${title}`,
		shownOfTotal: (shown: number, total: number) => `· ${shown}/${total}`,
		caveat:
			'Classement sur fenêtre glissante, pondéré par les observations, pas un palmarès certifié; les petits échantillons varient.',
		units: { pts: 'pts', pct: '%', min: ' min' },
	},
	en: {
		kicker: 'ACCOUNTABILITY · HOTSPOTS',
		heading: 'Hotspots',
		subheading: '// WORST FIRST',
		lede: 'The stops and lines dragging the network down, ranked worst first by their severe-delay rate. We never invent data.',
		article: {
			watermark: 'Hotspots',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['hotspots', 'lines', 'stops', 'severe delay'],
			sections: (count) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'AS OF',
		history: {
			navigator: {
				group: 'Browse retained hotspots history',
				picker: {
					group: 'Hotspots history',
					start: 'From',
					end: 'To',
					clear: 'Current data',
					anyStart: 'Earliest date',
					anyEnd: 'Latest date',
					single: 'History date',
				},
				previous: 'Previous date',
				next: 'Next date',
			},
			coverage: (first, last) => `History available: ${first} to ${last}.`,
			selection: (date) => `Showing date: ${date}.`,
			correction: {
				malformed: 'That date was not valid. Showing the latest hotspots.',
				'outside-coverage': 'That date is outside retained history. Showing the latest hotspots.',
				gap: 'That date falls in a publication gap. Showing the latest hotspots.',
				unpublished: 'That day was not published. Showing the latest hotspots.',
			},
			retainedWindow: (date) => `Available retained observations ending ${date}.`,
			retainedTopSubtitle:
				'The worst hotspot in the selected retained observations and the evidence behind it',
			retainedVerdictNone: 'No hotspot ranks in the selected retained observations.',
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
			top: {
				title: 'Top hotspot',
				subtitle: 'The worst current hotspot and the evidence behind it',
			},
			lines: {
				title: 'Lines',
				subtitle: 'Lines ranked by severe-delay rate, including low-sample cases',
			},
			stops: {
				title: 'Stops',
				subtitle: 'Stops ranked by severe-delay rate, including low-sample cases',
			},
		},
		caveatLabel: 'Caveat',
		grain: {
			label: 'Granularity',
			day: 'Day',
			week: 'Week',
			month: 'Month',
			shift: 'Peak hours',
			shiftCompact: 'Peak hours',
		},
		window: {
			day: 'Ranked over the latest service day.',
			week: 'Ranked over the latest trailing week.',
			month: 'Ranked over the latest trailing month.',
			shift: 'Ranked over the peak (rush-hour) periods of the trailing week.',
		},
		worstN: {
			label: 'Show',
			all: 'All',
		},
		ladder: {
			heading: 'Worst spots',
			severeRateLabel: 'Severe-delay rate',
			ci: '95% CI',
		},
		chart: {
			scroll: (sectionTitle) => `Scroll the ${sectionTitle} chart horizontally`,
			popover: {
				averageDelay: 'Average delay',
				readings: 'Readings',
				viewLine: 'View line',
				viewStop: 'View stop',
			},
		},
		tray: {
			heading: 'Below the reliable-reading floor',
			reason: 'Too few observations to rank (fewer than 30 readings) · not ranked.',
			listLabel: 'Un-ranked spots, below the observations floor',
			columns: {
				item: 'Item',
				typeId: 'Type / ID',
				readings: 'Readings',
			},
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		note: {
			severe: 'severe',
			avg: 'avg',
			samples: 'n',
		},
		deltaLost: (pts) => `${pts} on-time points lost`,
		verdict: {
			label: '#1 hotspot',
			topWithDelta: (name, deltaPts) => `Worst hotspot: ${name}, ${deltaPts} on-time points lost.`,
			topNoDelta: (name) => `Worst hotspot: ${name}.`,
			none: 'Nothing is a hotspot right now.',
		},
		type: {
			route: 'Line',
			stop: 'Stop',
		},
		unnamed: (id) => `Item ${id}`,
		viewDetail: (title) => `View detail for ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'Trailing-window, observation-weighted ranking, not a certified league table; small samples vary.',
		units: { pts: 'pts', pct: '%', min: ' min' },
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type HotspotsCopy = (typeof copy)[Locale];
