import { serviceComparisonCopy } from '$lib/v1/serviceComparison';
import { defineCopy, type Locale } from '$lib/i18n/copy';
import { historyCopy } from '$lib/components/surface/historyCopy';
import type { VerdictCopy } from '$lib/v1/verdict';
import { routeVerdictCopy } from './routeVerdict.copy';

/** The five cluster keys, in surface order. */
export type ReliabilityClusterKey =
	| 'punctuality'
	| 'waitRegularity'
	| 'serviceDelivered'
	| 'crowding'
	| 'habits';

export const reliabilityCopy = defineCopy({
	fr: {
		clusters: {
			punctuality: 'Ponctualité',
			serviceDelivered: serviceComparisonCopy.fr.section,
			crowding: 'Encombrement',
			waitRegularity: 'Régularité des attentes',
			habits: 'Habitudes horaires',
		},
		strip: {
			snapshotLabel: 'Aperçu de la fiabilité',
			otpPct: 'Ponctualité',
			target: 'Cible',
			avgDelayMin: 'Retard moyen',
			p50Min: 'Retard médian',
			p90Min: 'Retard au 90e percentile',
			headwayRegularityCov: 'Régularité (CV)',
			cancellationRatePct: "Taux d'annulation",
			skippedStopRatePct: "Taux d'arrêts ignorés",
			serviceCompletenessPct: serviceComparisonCopy.fr.label,
			cancellationFraction: (c: string, total: string) => `${c} annulés sur ${total} jours-trajets`,
			skippedFraction: (s: string, total: string) =>
				`${s} ignorés sur ${total} mises à jour d'arrêt`,
			serviceCompletenessFraction: serviceComparisonCopy.fr.fraction,
			p50Caption: 'Médiane estimée des relevés de retard',
			p90Caption: '90e percentile estimé des relevés de retard',
			delayDistHeading: 'Retard médian et 90e percentile',
			delayDistLabel: 'Retard, de tôt à tard (min)',
			delayDistCount: 'Relevés',
			delayDistCaption:
				'L’aire de chaque barre représente le nombre de relevés dans cet intervalle de retard. Les intervalles ont des largeurs différentes : la hauteur indique la densité. Les traits marquent la médiane et le 90e percentile. Vue de -5 à +30 min.',
			percentileNudge:
				'Les estimations du retard médian et du 90e percentile sont indisponibles ici. Consultez une vue par semaine ou par mois.',
			severePct: 'Part des retards graves',
			severeCaption: 'Proportion de passages en retard grave',
			weakStopsHeading: 'Les arrêts les plus en retard',
			worstNLabel: 'Arrêts affichés',
			severeRateLabel: 'Taux de retard grave',
			worstNAll: 'Tous',
			weakStopNote: { severe: 'grave', avg: 'moy.', samples: 'n' },
			weakStopCi: 'IC 95 %',
			excessWaitCaption: '0 = le service respecte (ou dépasse) sa fréquence prévue',
			skippedStopCaption: 'Arrêts non desservis',
			wilsonBandCaption:
				'Bande ombrée : intervalle de Wilson à 95 %. Plus il est large, moins l’estimation est précise. Les relevés répétés d’un même trajet peuvent le rendre trop étroit. Pointillés : cible de 80 %.',
			rampInNote: 'Les signalements manquants peuvent masquer des interruptions de service.',
			regularity: {
				regular: 'Apparitions régulières',
				irregular: 'Apparitions irrégulières',
			},
		},
		windows: {
			trend: '30 derniers jours',
			trendByDay: 'Par jour',
			trendByTimeOfDay: 'Par moment de la journée',
			crowding: '30 derniers jours',
			weakStops: 'Cumul hebdomadaire',
			habits: 'Toutes les données accumulées',
			serviceSpan: (date: string | null) =>
				date ? `Dernière journée de service · ${date}` : 'Dernière journée de service',
		},
		peak: {
			heading: 'Par période de la journée',
			dayType: 'Semaine vs fin de semaine',
			dayOfWeekSevere: 'Part des retards graves',
			caveat:
				'Estimation sur fenêtre glissante, pondérée par les observations, pas une ponctualité certifiée; les petits échantillons varient.',
			weekday: 'Semaine',
			weekend: 'Fin de semaine',
			strip: {
				ariaLabel: 'Retards graves par période',
				mean: (value: string) => `Moyenne approx. des périodes affichées : ${value}`,
			},
		},
		byDow: {
			heading: 'Encombrement par jour de la semaine',
			caption:
				"Répartition de l'occupation pour chaque jour, du lundi au dimanche. Un jour sans télémétrie le dit clairement plutôt que d'inventer une barre.",
		},
		delayByCrowding: {
			heading: "Retard selon l'occupation",
			bandHeader: "Niveau d'occupation",
			typical: (p50: string) => `typique ${p50}`,
		},
		crosstab: {
			heading: 'Par période et type de jour',
			shiftHeader: 'Période',
			dayTypeHeader: 'Type de jour',
			caption:
				'Ponctualité (% à l’heure) par période de la journée et type de jour, sur une échelle fixe de 0 à 100 %. Une cellule avec moins de 30 observations est grisée; jamais un zéro inventé.',
			heatmapLabel: 'Ponctualité par période et type de jour',
			legend: {
				low: 'Faible (0–40 %)',
				mid: 'Moyenne (40–80 %)',
				high: 'Élevée (80–100 %)',
			},
			hottest: 'Meilleure ponctualité',
			obs: (n: number) => `n=${n}`,
			lowSample: 'moins de 30 observations',
		},
		regularityTerms: {
			scheduledGap: 'Intervalle prévu',
			observedGap: 'Intervalle dans le flux',
			excessWait: 'Attente excédentaire',
			spread: 'Régularité (CV)',
			clumped: 'Apparitions rapprochées',
			bunchingHelp:
				'Chaque ligne compare l’intervalle médian prévu (●) à celui des premières apparitions de trajets dans le flux (●). La part d’apparitions rapprochées estime les intervalles inférieurs à la moitié de la médiane. Ces écarts ne mesurent ni les arrivées à votre arrêt ni votre attente réelle.',
		},
		serviceSpanTimeline: {
			heading: 'Premières apparitions de trajets',
			ariaLabel: (first: string, last: string) =>
				`Premières captures des trajets, du premier relevé le plus tôt à ${first} au premier relevé le plus tard à ${last}`,
			firstTrip: 'Premier relevé le plus tôt',
			lastTrip: 'Premier relevé le plus tard',
			span: (len: string) => `Écart arrondi ${len}`,
			trips: (n: string) => `${n} identifiants de trajet observés`,
			firstDelay: 'Premier trajet : retard du premier relevé',
			lastDelay: 'Dernier trajet : retard du dernier relevé',
			caption:
				'Les extrémités marquent des premières captures. Les dates locales et décalages UTC accompagnent un axe en heures écoulées; l’écart affiché s’arrondit à la minute. Les retards viennent du premier relevé du premier trajet et du dernier relevé du dernier trajet, qui peut être postérieur à l’extrémité droite.',
		},
		units: { pct: '%', min: ' min' },
		priorDelta: {
			onTimeHeading: 'Ponctualité par période',
			waitHeading: 'Attente par période',
			vsPrior: {
				day: 'p/r à la veille',
				week: 'p/r à la sem. préc.',
				month: 'p/r au mois préc.',
			},
			noPrior: {
				day: 'pas de veille',
				week: 'pas de semaine précédente',
				month: 'pas de mois précédent',
			},
			onTimeNoun: 'ponctualité',
			waitNoun: 'attente',
			pts: 'pts',
			ptOne: 'pt',
			caption:
				'Écart observé pour la même période dans la fenêtre précédente. La couverture des données et les voyages représentés peuvent différer.',
		},
		controls: {
			viewLabel: 'Vue',
			grainLabel: 'Granularité',
			latestDay: 'Dernier jour',
			thisWeek: 'Cette semaine',
			thisMonth: 'Ce mois-ci',
			dateRange: 'Plage de dates',
			clearDates: 'Effacer les dates',
			rangeStart: 'Du',
			rangeEnd: 'Au',
			activeWindow: {
				day: (date: string | null) =>
					date
						? `Bilan des retards : jour local de capture ${date}. Les comptes et les plages de service suivent les jours de service GTFS.`
						: 'Jour de capture des retards indisponible. Les autres mesures conservent leurs propres fenêtres.',
				week: 'Fenêtre : cette semaine (semaine la plus récente)',
				month: 'Fenêtre : ce mois-ci (mois le plus récent)',
				singleDay: (date: string) => `Fenêtre : ${date}`,
				range: (n: number, start: string, end: string) =>
					`Moyenne sur ${n} ${n === 1 ? 'jour' : 'jours'}, du ${start} au ${end}`,
				rangeSelection: (start: string, end: string) => `Fenêtre : du ${start} au ${end}`,
				rangePrompt: 'Fenêtre : choisissez une date de début et de fin',
			},
			toc: 'Aller à une section',
			filterPillOpen: 'Ouvrir les commandes de vue',
			filterPillClose: 'Fermer les commandes de vue',
			tocPillClose: 'Fermer la liste des sections',
		},
		history: {
			navigator: historyCopy('fr', {
				mode: 'range',
				group: 'Historique de fiabilité de la ligne',
				picker: {
					group: 'Plage de dates',
					clear: 'Revenir au portrait actuel',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
				},
			}),
			coverage: (from: string, to: string) => `Historique disponible du ${from} au ${to}.`,
			selection: (from: string, to: string) => `Plage choisie : du ${from} au ${to}.`,
			correction: {
				malformed: 'La plage invalide a été remplacée par le portrait actuel.',
				'outside-coverage': 'La plage non disponible a été remplacée par le portrait actuel.',
				gap: 'La plage traverse une lacune dans les données conservées.',
				unpublished: 'La plage non publiée a été remplacée par le portrait actuel.',
			},
			partial: 'Cette plage ne couvre qu’une partie des mesures conservées.',
			currentOnly:
				'Les habitudes, les attentes, les pires arrêts et les associations restent basés sur le portrait actuel.',
			headerCurrentOnly: routeVerdictCopy.fr.history.headerCurrentOnly,
			loading: 'Chargement de la plage conservée…',
			ready: 'Plage conservée chargée.',
			error: 'Impossible de charger cette plage conservée.',
			retry: 'Réessayer',
		},
		sections: {
			verdict: {
				label: 'Fiabilité',
				question: 'Peut-on compter sur cette ligne ?',
				terminal: { title: 'verdict', tag: 'FIABILITÉ' },
			},
			whenToRide: {
				label: 'Quand voyager',
				question: 'Quand est-ce fiable, et quand ça se gâte ?',
			},
			theWait: {
				label: "L'attente",
				question: 'Combien de temps faut-il attendre, et les bus sont-ils collés ?',
			},
			runAndFit: {
				label: 'Service et place',
				question: 'Le bus passe-t-il, et y aura-t-il de la place ?',
			},
			worstStops: { label: 'Les pires arrêts', question: 'Où le retard s’accumule-t-il ?' },
			detailShow: 'Voir le détail',
			detailHide: 'Masquer le détail',
		},
		verdict: routeVerdictCopy.fr.verdict,
	},
	en: {
		clusters: {
			punctuality: 'Punctuality',
			serviceDelivered: serviceComparisonCopy.en.section,
			crowding: 'Crowding',
			waitRegularity: 'Wait regularity',
			habits: 'Time-of-day habits',
		},
		strip: {
			snapshotLabel: 'Reliability snapshot',
			otpPct: 'On-time',
			target: 'Target',
			avgDelayMin: 'Avg delay',
			p50Min: 'Median delay',
			p90Min: '90th-percentile delay',
			headwayRegularityCov: 'Regularity (CoV)',
			cancellationRatePct: 'Cancellation rate',
			skippedStopRatePct: 'Skipped-stop rate',
			serviceCompletenessPct: serviceComparisonCopy.en.label,
			cancellationFraction: (c, total) => `${c} of ${total} trip-days canceled`,
			skippedFraction: (s, total) => `${s} of ${total} stop updates skipped`,
			serviceCompletenessFraction: serviceComparisonCopy.en.fraction,
			p50Caption: 'Estimated median of reported delays',
			p90Caption: 'Estimated 90th percentile of reported delays',
			delayDistHeading: 'Median and 90th-percentile delay',
			delayDistLabel: 'Delay, early to late (min)',
			delayDistCount: 'Observations',
			delayDistCaption:
				'Each bar’s area represents the number of observations in that delay range. Bins have different widths, so height shows density. Reference lines mark the median and 90th percentile. View: -5 to +30 min.',
			percentileNudge:
				'Median and 90th-percentile delay estimates are unavailable here. Check a week or month view.',
			severePct: 'Severe-delay share',
			severeCaption: 'Share of arrivals that ran severely late',
			weakStopsHeading: 'The stops with the most delay',
			worstNLabel: 'Stops shown',
			severeRateLabel: 'Severe-delay rate',
			worstNAll: 'All',
			weakStopNote: { severe: 'severe', avg: 'avg', samples: 'n' },
			weakStopCi: '95% CI',
			excessWaitCaption: '0 = runs on schedule (met or beat its planned frequency)',
			skippedStopCaption: "Stops the bus didn't serve",
			wilsonBandCaption:
				'Shaded band: 95% Wilson interval. Wider means less precision; repeated updates from the same trip can make it too narrow. Dashed line: the 80% target.',
			rampInNote: 'Missing feed reports can hide service gaps.',
			regularity: {
				regular: 'Regular feed gaps',
				irregular: 'Irregular feed gaps',
			},
		},
		windows: {
			trend: 'Last 30 days',
			trendByDay: 'By day',
			trendByTimeOfDay: 'By time of day',
			crowding: 'Last 30 days',
			weakStops: 'Weekly aggregate',
			habits: 'All accrued data',
			serviceSpan: (date) => (date ? `Latest service day · ${date}` : 'Latest service day'),
		},
		peak: {
			heading: 'By time of day',
			dayType: 'Weekday vs weekend',
			dayOfWeekSevere: 'Severe-delay share',
			caveat:
				'Trailing-window, observation-weighted estimate, not certified on-time; small samples vary.',
			weekday: 'Weekday',
			weekend: 'Weekend',
			strip: {
				ariaLabel: 'Severe delay by time of day',
				mean: (value) => `Approx. mean of displayed shifts: ${value}`,
			},
		},
		byDow: {
			heading: 'Crowding by day of week',
			caption:
				'How occupancy splits on each day, Monday through Sunday. A day with no telemetry says so plainly instead of fabricating a bar.',
		},
		delayByCrowding: {
			heading: 'Delay by crowding',
			bandHeader: 'Crowding band',
			typical: (p50) => `typical ${p50}`,
		},
		crosstab: {
			heading: 'By shift and day type',
			shiftHeader: 'Shift',
			dayTypeHeader: 'Day type',
			caption:
				'On-time rate (%) by time of day and day type, on a fixed 0–100% scale. A cell with fewer than 30 observations is greyed out, never a fabricated zero.',
			heatmapLabel: 'On-time rate by shift and day type',
			legend: {
				low: 'Low (0–40%)',
				mid: 'Medium (40–80%)',
				high: 'High (80–100%)',
			},
			hottest: 'Best on-time rate',
			obs: (n) => `n=${n}`,
			lowSample: 'fewer than 30 observations',
		},
		regularityTerms: {
			scheduledGap: 'Scheduled gap',
			observedGap: 'Feed-appearance gap',
			excessWait: 'Excess wait',
			spread: 'Spread (CoV)',
			clumped: 'Closely spaced appearances',
			bunchingHelp:
				'Each row compares the scheduled median gap (●) with the median gap between trips first appearing in the feed (●). The closely spaced share estimates gaps below half the median. These gaps measure neither arrivals at your stop nor your actual wait.',
		},
		serviceSpanTimeline: {
			heading: 'Trip first appearances',
			ariaLabel: (first, last) =>
				`First captured trip reports, from the earliest at ${first} to the latest at ${last}`,
			firstTrip: 'Earliest first report',
			lastTrip: 'Latest first report',
			span: (len) => `Rounded span ${len}`,
			trips: (n) => `${n} trip IDs observed`,
			firstDelay: 'First trip: delay in earliest report',
			lastDelay: 'Last trip: delay in latest report',
			caption:
				'Both endpoints mark first captured reports. Local dates and UTC offsets accompany an elapsed-hour axis; the span label rounds to whole minutes. Delay markers use the first trip’s earliest report and the last trip’s latest report, which may follow the right endpoint.',
		},
		units: { pct: '%', min: ' min' },
		priorDelta: {
			onTimeHeading: 'On-time by time of day',
			waitHeading: 'Wait by shift',
			vsPrior: {
				day: 'vs prior day',
				week: 'vs prior week',
				month: 'vs prior month',
			},
			noPrior: {
				day: 'no prior day',
				week: 'no prior week',
				month: 'no prior month',
			},
			onTimeNoun: 'on-time',
			waitNoun: 'wait',
			pts: 'pts',
			ptOne: 'pt',
			caption:
				'Observed difference for the same time period in the previous window. Feed coverage and the trips represented can differ.',
		},
		controls: {
			viewLabel: 'View',
			grainLabel: 'Granularity',
			latestDay: 'Latest day',
			thisWeek: 'This week',
			thisMonth: 'This month',
			dateRange: 'Date range',
			clearDates: 'Clear dates',
			rangeStart: 'From',
			rangeEnd: 'To',
			activeWindow: {
				day: (date: string | null) =>
					date
						? `Delay summary: local capture day ${date}. Service counts and spans follow GTFS service days.`
						: 'Delay capture day unavailable. Other measures retain their own windows.',
				week: 'Window: this week (most recent week)',
				month: 'Window: this month (most recent month)',
				singleDay: (date) => `Window: ${date}`,
				range: (n, start, end) =>
					`Average across ${n} ${n === 1 ? 'day' : 'days'}, ${start} to ${end}`,
				rangeSelection: (start, end) => `Window: ${start} to ${end}`,
				rangePrompt: 'Window: pick a start and end date',
			},
			toc: 'Jump to a section',
			filterPillOpen: 'Open view controls',
			filterPillClose: 'Close view controls',
			tocPillClose: 'Close section list',
		},
		history: {
			navigator: historyCopy('en', {
				mode: 'range',
				group: 'Line reliability history',
				picker: {
					group: 'Date range',
					clear: 'Return to current snapshot',
					anyStart: 'First date',
					anyEnd: 'Last date',
				},
			}),
			coverage: (from, to) => `History available from ${from} to ${to}.`,
			selection: (from, to) => `Selected range: ${from} to ${to}.`,
			correction: {
				malformed: 'The invalid date range was replaced with the current snapshot.',
				'outside-coverage': 'The unavailable date range was replaced with the current snapshot.',
				gap: 'The selected range crosses a gap in retained data.',
				unpublished: 'The unpublished date range was replaced with the current snapshot.',
			},
			partial: 'This range has only partial retained metric coverage.',
			currentOnly:
				'Habits, wait regularity, worst stops, and associations still use the current snapshot.',
			headerCurrentOnly: routeVerdictCopy.en.history.headerCurrentOnly,
			loading: 'Loading retained range…',
			ready: 'Retained range loaded.',
			error: 'This retained range could not be loaded.',
			retry: 'Retry',
		},
		sections: {
			verdict: {
				label: 'Reliability',
				question: 'Can you count on this line?',
				terminal: { title: 'verdict', tag: 'RELIABILITY' },
			},
			whenToRide: {
				label: 'When to ride',
				question: 'When is it good, and when does it fall apart?',
			},
			theWait: { label: 'The wait', question: 'How long will you wait, and do buses bunch?' },
			runAndFit: { label: 'Service & space', question: 'Will the bus run, and will you fit?' },
			worstStops: { label: "Where it's worst", question: 'Where does the delay pile up?' },
			detailShow: 'Show the detail',
			detailHide: 'Hide the detail',
		},
		verdict: routeVerdictCopy.en.verdict,
	},
}) satisfies Readonly<Record<Locale, { readonly verdict: VerdictCopy }>>;

export type ReliabilityCopy = (typeof reliabilityCopy)[Locale];
