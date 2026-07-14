// network-reliability.copy.ts — co-located bilingual copy for the Network-health surface.
//
// Moved here from ../network.copy.ts during the S9A re-seat (the surface tree now lives under
// network/reliability/). Domain-intrinsic component vocabulary (status/occupancy band labels,
// the LIVE chip, edge-state copy) already lives inside the spine + dataviz primitives; this
// file only carries the surface-level prose + metric/section captions.
//
// Shape: `Record<Locale, {...}>` with EN + FR. The FR voice is the canonical product voice
// (mirrors the raw-FR /v1 headers); EN is the parallel translation.

import type { Locale } from '$lib/i18n';
import type { HistoryNavigatorLabels, SurfaceHeadCopy } from '$lib/components/surface';
import type { HistoryCorrection } from '$lib/v1/history';
import type { VerdictCopy } from '$lib/v1/verdict';

export interface NetworkReliabilityCopy extends SurfaceHeadCopy {
	/** D3: the TerminalPanel framing the LIVE control-room band. */
	readonly liveTerminal: {
		/** Mono terminal-window title (e.g. "control-room"). */
		readonly title: string;
		/** Small tag chip beside the title (e.g. "LIVE"). */
		readonly tag: string;
		/** Footer readout label for the live snapshot source. */
		readonly footerLabel: string;
		/** Footer readout value (the honest source note). */
		readonly footerValue: string;
	};
	/** Region heading above the LIVE half of the surface. */
	readonly liveRegion: string;
	/** Region heading above the HISTORIC half of the surface. */
	readonly historicRegion: string;
	/** Bilingual group label for the historic ControlsRail (grain + window + series). */
	readonly viewControlsLabel: string;
	/**
	 * P5.4: the map-style GLASS LEFT RAIL (SurfaceRail) copy — the View overline, the
	 * region ToC label, and the mobile pill's open/close a11y names. Rendered in BOTH
	 * the desktop glass panel + the mobile sheet.
	 */
	readonly rail: {
		/** ToC "jump to" nav label + its aria-label. */
		readonly toc: string;
		/** aria-label for the mobile pill's open control. */
		readonly pillOpen: string;
		/** aria-label for the mobile sheet's dismiss control. */
		readonly pillClose: string;
	};
	/** Section caption above the live metric grid. */
	readonly liveSection: string;
	/** Section caption above the trend chart. */
	readonly trendSection: string;
	/** Section caption above the cancellation-rate trend. */
	readonly cancelSection: string;
	/** Section caption above the per-day crowding-mix small multiple. */
	readonly occupancyTrendSection: string;
	/** Section caption above the network "by time of day" readout. */
	readonly shiftSection: string;
	/** Section caption above the weekday-vs-weekend readout. */
	readonly dayTypeSection: string;
	/** Section caption above the status-mix bar. */
	readonly statusSection: string;
	/** Section caption above the occupancy-mix bar. */
	readonly occupancySection: string;
	/** Section caption above the delay-distribution histogram. */
	readonly delayHistogramSection: string;
	/** Section caption above the non-responding-by-route ranked list. */
	readonly nonRespondingSection: string;
	/**
	 * Service-completeness tile (S9B · GC2 service_completeness_rate). A schedule-aware
	 * delivered/scheduled share, distinct from the RT-observed cancellation rate. Honest-absent
	 * (ramp-in) until the GC2 scheduled-universe data accrues across the retained window.
	 */
	readonly completeness: {
		/** Section caption above the tile. */
		readonly section: string;
		/** Metric label (the latest-bucket completeness reading). */
		readonly metric: string;
		/** The always-visible plain-language explainer (silent = scheduled but never appeared). */
		readonly explainer: string;
		/** Ramp-in stand-down note shown under a null latest ("no data yet, accruing"). */
		readonly standDown: string;
	};
	/** Metric labels for the headline grid. */
	readonly metrics: {
		readonly onTime: string;
		readonly vehicles: string;
		readonly notReporting: string;
		readonly coverage: string;
		readonly delayP50: string;
		readonly delayP90: string;
	};
	/** Worker-cycle feed-staleness chip (distinct from snapshot-publish age). */
	readonly feedAge: {
		/** Leading label for the chip (e.g. "FEED"). */
		readonly label: string;
		/** Accessible prefix read before the formatted age. */
		readonly a11yPrefix: string;
	};
	/** The dedicated vehicles-reporting / coverage row (S9C: its own labelled row). */
	readonly reporting: {
		/** Section heading (e.g. "Reporting & coverage"). */
		readonly heading: string;
		/**
		 * The GLOBAL-SIGNAL caveat (the S5 "vehicle updated_utc is uniform" finding):
		 * per-vehicle silence is a network-wide feed signal, so `non_responding` counts
		 * scheduled trips with no live vehicle (a per-line silent-trip tally, NOT
		 * identifiable buses), and coverage is the fleet-known-status share — it cannot
		 * flag one specific vehicle as silent.
		 */
		readonly caveat: string;
	};
	/** A11y / legend labels for the two distribution bars. */
	readonly statusBarLabel: string;
	readonly occupancyBarLabel: string;
	/** Trend-chart series labels + accessible summary. */
	readonly trend: {
		readonly onTimeLabel: string;
		readonly retardLabel: string;
		/** The two retard-series choices for the toggle. */
		readonly retardP90: string;
		readonly retardAvg: string;
		readonly retardAvgLabel: string;
		/** Accessible group label for the retard-series toggle. */
		readonly retardToggleLabel: string;
		readonly summary: string;
		/** Accessible title when the selected retained range has delay but no OTP readings. */
		readonly delayOnlySummary: string;
		/** Accessible title when the selected retained range has OTP but no delay readings. */
		readonly onTimeOnlySummary: string;
		/** Accessible summary of the vehicles-in-service context sparkline. */
		readonly vehiclesSpark: string;
		/** Caption shown under the vehicles context sparkline. */
		readonly vehiclesContext: string;
	};
	/** Cancellation-rate trend labels. */
	readonly cancel: {
		/** Headline metric label (latest day's value). */
		readonly metric: string;
		/** Trend series + axis label. */
		readonly seriesLabel: string;
		/** Accessible chart summary. */
		readonly summary: string;
	};
	/** Per-day crowding small-multiple labels. */
	readonly occupancyTrend: {
		/** Accessible summary of the whole small-multiple. */
		readonly summary: string;
	};
	/** Network "by time of day" + weekday/weekend readouts (shared shift vocab). */
	readonly shift: {
		/** Accessible summary of the time-of-day ranked list. */
		readonly shiftSummary: string;
		/** Accessible summary of the weekday/weekend ranked list. */
		readonly dayTypeSummary: string;
		/** Per-row caption — what the headline value + magnitude bar encode. */
		readonly rowCaption: string;
		/** Subtitle prefix for the average-delay reading. */
		readonly avgLabel: string;
		/** Subtitle prefix for the severe-delay-share reading. */
		readonly severeLabel: string;
		/**
		 * Honest caveat: these grains are a real on-time/known OTP over the trailing
		 * window — a punctuality proxy, not certified OTP — so small samples vary.
		 */
		readonly caveat: string;
	};
	/** Delay-distribution histogram (8 fixed signed-minute buckets). */
	readonly delayHistogram: {
		/** Accessible chart title. */
		readonly summary: string;
		/** Honest caption: same basis as the p50/p90 headline numbers. */
		readonly caption: string;
		/** Localized x-axis title (the delay axis). */
		readonly xLabel: string;
		/** Localized y-axis title (the count axis). */
		readonly yLabel: string;
	};
	/** Non-responding (silent) scheduled trips, ranked per route. */
	readonly nonResponding: {
		/** Accessible summary of the ranked list (role=list). */
		readonly summary: string;
		/** Honest caption framing what a silent trip is (metro excluded). */
		readonly caption: string;
		/** Per-row subtitle prefix (e.g. "Line"). */
		readonly rowLabel: string;
		/** Accessible name for each row's deep link (e.g. "View line 51"). */
		readonly viewDetail: (route: string) => string;
		/** Pluralized unit suffix for a trip count ("1 trip" / "2 trips"). */
		readonly tripsUnit: (count: number) => string;
	};
	/** Trend grain selector (day / week / month) labels. */
	readonly grain: {
		/** Accessible group label for the grain selector. */
		readonly label: string;
		/** Segment labels. */
		readonly day: string;
		readonly week: string;
		readonly month: string;
	};
	/** Window selector (7/30/90-day) labels. */
	readonly window: {
		/** Accessible group label for the window selector. */
		readonly label: string;
		/** Segment labels, keyed by day count. */
		readonly d7: string;
		readonly d30: string;
		readonly d90: string;
	};
	/** Retained-history controls, corrections, and metric-scope honesty. */
	readonly history: {
		readonly navigator: HistoryNavigatorLabels;
		readonly coverage: (from: string, to: string) => string;
		readonly selection: (from: string, to: string) => string;
		readonly correction: Record<HistoryCorrection['reason'], string>;
		readonly partial: string;
		readonly noData: string;
		readonly currentOnly: string;
		readonly dailyOnly: string;
	};
	/** Shown in place of a metric value when the contract reports null. */
	readonly noData: string;
	/** Units appended to formatted values (kept out of the .svelte). */
	readonly units: {
		readonly pct: string;
		readonly min: string;
	};
	/**
	 * §0 network verdict band (§C5.7) — the plain-language at-a-glance answer between the
	 * LIVE and HISTORIC regions, rendered through the SHARED VerdictBanner + selectVerdict.
	 * The live tier carries no OTP trip-day denominator, so the sentence reads WITHOUT a
	 * Wilson hedge (the honest pre-republish path) — never a fabricated confidence.
	 */
	readonly verdict: VerdictCopy;
	/** The network verdict band's Δ-vs-prior chip (§C6 #3) — latest vs prior trend day. */
	readonly verdictDelta: {
		/** Accessible name for the verdict band section. */
		readonly label: string;
		/** The chip text builder: signed points vs the prior day (e.g. "+3 pts vs prior day"). */
		readonly chip: (signedPts: string) => string;
		/** a11y prefix for the chip. */
		readonly a11y: string;
	};
}

export const networkReliabilityCopy: Record<Locale, NetworkReliabilityCopy> = {
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Network health',
		lede: 'Live network-wide on-time performance, crowding and feed freshness, measured from the /v1 contract. We never invent data: a missing signal shows as “no data”, not a fabricated zero.',
		liveTerminal: {
			title: 'control-room',
			tag: 'LIVE',
			footerLabel: 'SOURCE',
			footerValue: '/v1 live snapshot',
		},
		liveRegion: 'Live now',
		historicRegion: 'Historic trend',
		viewControlsLabel: 'View',
		rail: {
			toc: 'Jump to a section',
			pillOpen: 'Open view controls',
			pillClose: 'Close view controls',
		},
		liveSection: 'Live now',
		trendSection: 'Daily trend',
		cancelSection: 'Cancellations',
		occupancyTrendSection: 'Crowding by day',
		shiftSection: 'By time of day',
		dayTypeSection: 'Weekday vs weekend',
		statusSection: 'Status mix',
		occupancySection: 'Crowding',
		delayHistogramSection: 'Delay distribution',
		nonRespondingSection: 'Silent trips by line',
		completeness: {
			section: 'Service delivered',
			metric: 'Scheduled service delivered',
			explainer:
				'Completeness is the share of scheduled trips the network actually ran. A silent trip is scheduled but never appears in the live feed, it is counted as not delivered.',
			standDown: 'No data yet, this reading accrues once scheduled-service coverage is published.',
		},
		metrics: {
			onTime: 'On-time',
			vehicles: 'Vehicles in service',
			notReporting: 'Not reporting',
			coverage: 'Coverage',
			delayP50: 'Median delay',
			delayP90: 'Slowest 10%',
		},
		feedAge: { label: 'FEED', a11yPrefix: 'Worker feed updated' },
		reporting: {
			heading: 'Reporting & coverage',
			caveat:
				'Coverage is the share of the fleet whose live status is known. “Not reporting” counts scheduled trips currently running with no live vehicle: a per-line silent-trip tally, not identifiable buses. Every vehicle shares one feed timestamp, so we can never single out one silent bus. Metro is excluded.',
		},
		statusBarLabel: 'Network status mix',
		occupancyBarLabel: 'Network crowding mix',
		trend: {
			onTimeLabel: 'On-time %',
			retardLabel: 'Slowest 10% (min)',
			retardP90: 'Slowest 10%',
			retardAvg: 'Average',
			retardAvgLabel: 'Average delay (min)',
			retardToggleLabel: 'Delay series',
			summary: 'Daily on-time % and the chosen delay series over the recent network trend.',
			delayOnlySummary: 'Chosen daily delay series over the selected network history.',
			onTimeOnlySummary: 'Daily on-time percentage over the selected network history.',
			vehiclesSpark: 'Vehicles in service, recent days',
			vehiclesContext: 'Vehicles reporting each day',
		},
		cancel: {
			metric: 'Canceled (latest day)',
			seriesLabel: '% canceled trip-days',
			summary: 'Daily share of canceled trip-days across the network.',
		},
		occupancyTrend: {
			summary: 'Crowding band mix per day across the recent network trend.',
		},
		shift: {
			shiftSummary: 'Network on-time performance ranked by time of day, worst punctuality first.',
			dayTypeSummary:
				'Network on-time performance for weekdays versus weekends, worst punctuality first.',
			rowCaption: 'On-time %, with average delay and severe-delay share',
			avgLabel: 'avg delay',
			severeLabel: 'severe',
			caveat:
				'A real on-time over known share across the network, measured over the trailing window. It is a punctuality proxy, not certified on-time performance, and small samples vary.',
		},
		delayHistogram: {
			summary: 'Distribution of trip-average delays across the network, earliest to latest.',
			caption:
				'How trip-average delays are spread right now, in signed minutes. Same basis as the median and slowest-10% numbers above: negative is ahead of schedule, positive is behind.',
			xLabel: 'Delay (min)',
			yLabel: 'Trips',
		},
		nonResponding: {
			summary: 'Lines with scheduled trips currently running with no live vehicle, most first.',
			caption:
				'Scheduled trips currently running with no live vehicle, by line. A silent trip has no vehicle to track, so this counts trips per line, not vehicles. Metro is excluded.',
			rowLabel: 'Line',
			viewDetail: (route) => `View line ${route}`,
			tripsUnit: (count) => (count === 1 ? 'trip' : 'trips'),
		},
		grain: { label: 'Trend grain', day: 'Day', week: 'Week', month: 'Month' },
		window: { label: 'Trend window', d7: '7d', d30: '30d', d90: '90d' },
		history: {
			navigator: {
				group: 'Retained history',
				picker: {
					group: 'Retained history range',
					start: 'From',
					end: 'To',
					clear: 'Return to current snapshot',
					anyStart: 'Earliest',
					anyEnd: 'Latest',
				},
				previous: 'Previous range',
				next: 'Next range',
			},
			coverage: (from, to) => `Retained coverage: ${from} to ${to}`,
			selection: (from, to) => `Selected range: ${from} to ${to}`,
			correction: {
				malformed: 'The invalid date range was replaced with the current snapshot.',
				'outside-coverage': 'The unavailable date range was replaced with the current snapshot.',
				gap: 'The range inside a retained-data gap was replaced with the current snapshot.',
				unpublished: 'The unpublished date range was replaced with the current snapshot.',
			},
			partial: 'Coverage is partial for this range. Missing dates and metrics remain no data.',
			noData: 'No data is retained for this range.',
			currentOnly: 'Time-of-day and weekday views remain from the current snapshot.',
			dailyOnly:
				'Slowest-10% delay and vehicles are exact daily readings; they are not pooled into week or month.',
		},
		noData: 'no data',
		units: { pct: '%', min: ' min' },
		verdict: {
			windowPhrase: {
				day: 'right now',
				week: 'right now',
				month: 'right now',
				range: 'right now',
			},
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`The network is running reliably ${window}, about ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`The network is running unevenly ${window}, about ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`The network is running poorly ${window}, only ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`About ${otp}% of trips on time ${window} (95% sure between ${lo} and ${hi}%, n=${n}).`,
			tooFew: (window, n) => `Still measuring ${window}, only ${n} trips tracked so far.`,
			absent: 'Still measuring the network. No live on-time reading yet.',
			hedgeSimple: (otp) => ` (${otp}%)`,
			hedgeCI: (otp, lo, hi) => ` (${otp}%, 95% sure between ${lo} and ${hi}%)`,
		},
		verdictDelta: {
			label: 'Network verdict',
			chip: (signedPts) => `${signedPts} vs prior day`,
			a11y: 'Change versus the prior day:',
		},
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Santé du réseau',
		lede: 'Ponctualité, achalandage et fraîcheur du flux à l’échelle du réseau, mesurés à partir du contrat /v1. On n’invente jamais de données : un signal absent s’affiche « aucune donnée », jamais un zéro fabriqué.',
		liveTerminal: {
			title: 'salle-de-contrôle',
			tag: 'EN DIRECT',
			footerLabel: 'SOURCE',
			footerValue: 'instantané /v1 en direct',
		},
		liveRegion: 'En direct',
		historicRegion: 'Tendance historique',
		viewControlsLabel: 'Vue',
		rail: {
			toc: 'Aller à une section',
			pillOpen: 'Ouvrir les commandes de vue',
			pillClose: 'Fermer les commandes de vue',
		},
		liveSection: 'En direct',
		trendSection: 'Tendance quotidienne',
		cancelSection: 'Annulations',
		occupancyTrendSection: 'Achalandage par jour',
		shiftSection: 'Par moment de la journée',
		dayTypeSection: 'Semaine et fin de semaine',
		statusSection: 'Répartition des statuts',
		occupancySection: 'Achalandage',
		delayHistogramSection: 'Répartition des retards',
		nonRespondingSection: 'Voyages silencieux par ligne',
		completeness: {
			section: 'Service livré',
			metric: 'Service planifié livré',
			explainer:
				'La complétude est la part des voyages planifiés que le réseau a réellement effectués. Un voyage silencieux est planifié mais n’apparaît jamais dans le flux en direct : il compte comme non livré.',
			standDown:
				'Aucune donnée pour l’instant. Cette mesure s’accumule une fois la couverture du service planifié publiée.',
		},
		metrics: {
			onTime: 'À l’heure',
			vehicles: 'Véhicules en service',
			notReporting: 'Sans signal',
			coverage: 'Couverture',
			delayP50: 'Retard médian',
			delayP90: '10 % les plus lents',
		},
		feedAge: { label: 'FLUX', a11yPrefix: 'Flux du travailleur mis à jour' },
		reporting: {
			heading: 'Signalement et couverture',
			caveat:
				'La couverture est la part de la flotte dont le statut en direct est connu. « Sans signal » compte les voyages planifiés qui circulent actuellement sans véhicule en direct : un décompte de voyages silencieux par ligne, pas des véhicules identifiables. Chaque véhicule partage un seul horodatage de flux, on ne peut donc jamais isoler un véhicule silencieux précis. Le métro est exclu.',
		},
		statusBarLabel: 'Répartition des statuts du réseau',
		occupancyBarLabel: 'Répartition de l’achalandage du réseau',
		trend: {
			onTimeLabel: 'Ponctualité %',
			retardLabel: '10 % les plus lents (min)',
			retardP90: '10 % les plus lents',
			retardAvg: 'Moyen',
			retardAvgLabel: 'Retard moyen (min)',
			retardToggleLabel: 'Série de retard',
			summary:
				'Ponctualité quotidienne et la série de retard choisie sur la tendance récente du réseau.',
			delayOnlySummary:
				'Série quotidienne de retard choisie sur l’historique sélectionné du réseau.',
			onTimeOnlySummary: 'Ponctualité quotidienne sur l’historique sélectionné du réseau.',
			vehiclesSpark: 'Véhicules en service, jours récents',
			vehiclesContext: 'Véhicules signalés chaque jour',
		},
		cancel: {
			metric: 'Annulé (dernier jour)',
			seriesLabel: '% de jours-voyages annulés',
			summary: 'Part quotidienne des jours-voyages annulés à l’échelle du réseau.',
		},
		occupancyTrend: {
			summary: 'Répartition des bandes d’achalandage par jour sur la tendance récente du réseau.',
		},
		shift: {
			shiftSummary:
				'Ponctualité du réseau classée par moment de la journée, la pire ponctualité d’abord.',
			dayTypeSummary:
				'Ponctualité du réseau en semaine et en fin de semaine, la pire ponctualité d’abord.',
			rowCaption: 'Ponctualité %, avec le retard moyen et la part de retards sévères',
			avgLabel: 'retard moyen',
			severeLabel: 'sévère',
			caveat:
				'Une part réelle à l’heure sur connus à l’échelle du réseau, mesurée sur la fenêtre glissante. C’est une estimation de ponctualité, pas une ponctualité certifiée, et les petits échantillons varient.',
		},
		delayHistogram: {
			summary:
				'Répartition des retards moyens par voyage à l’échelle du réseau, du plus tôt au plus tard.',
			caption:
				'La répartition actuelle des retards moyens par voyage, en minutes signées. Même base que le retard médian et les 10 % les plus lents ci-dessus : négatif signifie en avance, positif signifie en retard.',
			xLabel: 'Retard (min)',
			yLabel: 'Voyages',
		},
		nonResponding: {
			summary:
				'Lignes dont des voyages planifiés circulent sans véhicule en direct, les plus nombreuses d’abord.',
			caption:
				'Voyages planifiés qui circulent actuellement sans véhicule en direct, par ligne. Un voyage silencieux n’a aucun véhicule à suivre : on compte donc les voyages par ligne, pas les véhicules. Le métro est exclu.',
			rowLabel: 'Ligne',
			viewDetail: (route) => `Voir la ligne ${route}`,
			tripsUnit: (count) => (count <= 1 ? 'voyage' : 'voyages'),
		},
		grain: { label: 'Granularité de tendance', day: 'Jour', week: 'Semaine', month: 'Mois' },
		window: { label: 'Fenêtre de tendance', d7: '7 j', d30: '30 j', d90: '90 j' },
		history: {
			navigator: {
				group: 'Historique conservé',
				picker: {
					group: 'Plage de l’historique conservé',
					start: 'Du',
					end: 'Au',
					clear: 'Revenir à l’instantané actuel',
					anyStart: 'Au plus tôt',
					anyEnd: 'Au plus tard',
				},
				previous: 'Plage précédente',
				next: 'Plage suivante',
			},
			coverage: (from, to) => `Couverture conservée : du ${from} au ${to}`,
			selection: (from, to) => `Plage choisie : du ${from} au ${to}`,
			correction: {
				malformed: 'La plage de dates invalide a été remplacée par l’instantané actuel.',
				'outside-coverage':
					'La plage de dates non disponible a été remplacée par l’instantané actuel.',
				gap: 'La plage dans une lacune des données a été remplacée par l’instantané actuel.',
				unpublished: 'La plage non publiée a été remplacée par l’instantané actuel.',
			},
			partial:
				'La couverture est partielle pour cette plage. Les dates et mesures absentes restent sans données.',
			noData: 'Aucune donnée n’est conservée pour cette plage.',
			currentOnly:
				'Les vues par moment de la journée et par type de jour restent celles de l’instantané actuel.',
			dailyOnly:
				'Le retard des 10 % les plus lents et les véhicules sont des lectures quotidiennes exactes; ils ne sont pas regroupés par semaine ou par mois.',
		},
		noData: 'aucune donnée',
		units: { pct: '%', min: ' min' },
		verdict: {
			windowPhrase: {
				day: 'en ce moment',
				week: 'en ce moment',
				month: 'en ce moment',
				range: 'en ce moment',
			},
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`Le réseau est fiable ${window}, environ ${onTen} trajets sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`Le réseau est inégal ${window}, environ ${onTen} trajets sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`Le réseau est peu fiable ${window}, seulement ${onTen} trajets sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Environ ${otp} % des trajets à l’heure ${window} (sûr à 95 % entre ${lo} et ${hi} %, n=${n}).`,
			tooFew: (window, n) => `Mesure en cours ${window}, seulement ${n} trajets suivis jusqu’ici.`,
			absent: 'Mesure du réseau en cours. Pas encore de ponctualité en direct.',
			hedgeSimple: (otp) => ` (${otp} %)`,
			hedgeCI: (otp, lo, hi) => ` (${otp} %, sûr à 95 % entre ${lo} et ${hi} %)`,
		},
		verdictDelta: {
			label: 'Verdict du réseau',
			chip: (signedPts) => `${signedPts} vs la veille`,
			a11y: 'Variation par rapport à la veille :',
		},
	},
};
