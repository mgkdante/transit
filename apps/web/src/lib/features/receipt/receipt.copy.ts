// receipt.copy.ts: co-located bilingual copy for the Accountability-receipt surface.
//
// Co-located with AccountabilityReceipt.svelte so the screen owns no inline strings.
// The receipt is a daily "service receipt": the day's headline OTP / avg delay /
// severe share, the counts of affected routes/stops/alerts/vehicles, a rider-impact
// score and the single worst route + worst stop.
//
// Shape: `Record<Locale, ReceiptCopy>` with EN + FR. The FR voice is the canonical
// product voice (mirrors the raw-FR /v1 headers); EN is the parallel translation.
// Provider-agnostic: no STM / Montréal references.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface ReceiptCopy extends SurfaceHeadCopy {
	/** Accessible group label for the date selector (the index of receipt dates). */
	readonly dateSelectLabel: string;
	/** ControlsRail overline naming the date-selector control zone. */
	readonly controlsLabel: string;
	/** Smart date-picker (single-date calendar) copy. */
	readonly datePicker: {
		/** Select label ("Receipt day"). */
		readonly label: string;
		/** Appended to a gap-day option (no receipt published for the day). */
		readonly gapReason: string;
		readonly scheduleOnlyFlag: string;
		/** Appended to an empty published shell (no data, no schedule). */
		readonly emptyReason: string;
	};
	/** Time-of-day cut (by-shift) section copy. */
	readonly timeOfDay: {
		readonly heading: string;
		/** RankedRow subtitle (what the bar measures). */
		readonly severeShare: string;
		readonly caveat: string;
	};
	/** Service-state cuts (delivered / cancelled / silent) section copy. */
	readonly stateCuts: {
		readonly heading: string;
		/** The heroed completeness metric label. */
		readonly completenessLabel: string;
		/** The "silent = scheduled but never appeared" explainer (S9 family). */
		readonly explainer: string;
		/** Ramp-in stand-down note under the completeness reading. */
		readonly standDown: string;
		/** Sub-label above the delivered/cancelled/silent share bars. */
		readonly splitLabel: string;
		readonly delivered: string;
		readonly cancelled: string;
		readonly silent: string;
	};
	/** Not-reported lines list section copy. */
	readonly notReported: {
		readonly heading: string;
		/** Per-row line-label prefix. */
		readonly rowLabel: string;
		/** id → localized "N scheduled" display. */
		readonly scheduled: (n: number) => string;
		/** id → localized link accessible name ("View line 51"). */
		readonly viewDetail: (id: string) => string;
		/** shown, total → "Showing 50 of 200" honest truncation note. */
		readonly shownOfTotal: (shown: number, total: number) => string;
		/** The 'silent = scheduled but never appeared' explainer. */
		readonly caveat: string;
	};
	/** Caption above the receipt body. */
	readonly receiptSection: string;
	/** TerminalPanel title bar text (the receipt "window" title). */
	readonly terminalTitle: string;
	/** TerminalPanel tag chip (a small label beside the title). */
	readonly terminalTag: string;
	/** Footer label for the day the receipt covers. */
	readonly issuedLabel: string;
	/** The headline metric labels. */
	readonly metrics: {
		readonly onTime: string;
		readonly avgDelay: string;
		readonly severe: string;
		readonly riderImpact: string;
	};
	/** Section caption above the affected-counts row. */
	readonly countsSection: string;
	/** The affected-count labels. */
	readonly counts: {
		readonly routes: string;
		readonly stops: string;
		readonly alerts: string;
		readonly vehicles: string;
	};
	/** Section caption above the worst-of-day callouts. */
	readonly worstSection: string;
	/** Worst-route / worst-stop row labels + their delta phrasing. */
	readonly worst: {
		readonly routeLabel: string;
		readonly stopLabel: string;
		/** Prefix read before a route's OTP delta (e.g. "On-time vs network"). */
		readonly routeDeltaLabel: string;
		/** Prefix read before a stop's average delay. */
		readonly stopDelayLabel: string;
	};
	/** Honest caveat under the receipt: what this measure is and is not. */
	readonly caveat: string;
	/** Empty / no-data strings. */
	readonly noData: string;
	/** Shown when the index carries no published receipt dates at all. */
	readonly emptyIndex: string;
	/** Shown when the chosen date resolves to a 404 (no receipt for that day). */
	readonly emptyReceipt: string;
	/** Units appended to formatted values. */
	readonly units: {
		readonly pct: string;
		readonly min: string;
		readonly pts: string;
	};
	/**
	 * §C5.11 day-verdict sentence on the headline — templated ONLY from numbers already
	 * present on the receipt (worst line + affected share + completeness). NO fabricated
	 * baseline: when the S13 completeness cuts stand down (ramp-in), the verdict says
	 * exactly that. The `worst` clause is omitted when no worst line is served.
	 */
	readonly dayVerdict: {
		/** Accessible name for the verdict line. */
		readonly label: string;
		/** Lead reading of the day's on-time %. */
		readonly otp: (otpPct: string) => string;
		/** Worst-line clause (name + on-time points lost). */
		readonly worst: (name: string, deltaPts: string) => string;
		/** Affected-lines clause (count of lines touched). */
		readonly affected: (lines: string) => string;
		/** Completeness clause when the service-state cut is live. */
		readonly completeness: (pct: string) => string;
		/** Honest stand-down clause when the completeness cut is absent (ramp-in). */
		readonly completenessStandDown: string;
		/** Whole-verdict stand-down when the receipt carries no readable headline. */
		readonly none: string;
	};
}

export const copy: Record<Locale, ReceiptCopy> = {
	en: {
		kicker: 'ACCOUNTABILITY · DAILY',
		heading: 'Accountability receipt',
		subheading: '// RECEIPT',
		lede: 'One day, one receipt: the headline reliability of the service, the day it covers, and the worst of it, issued daily with nothing hidden.',
		dateSelectLabel: 'Choose a receipt day',
		controlsLabel: 'Day',
		datePicker: {
			label: 'Receipt day',
			gapReason: 'no receipt',
			scheduleOnlyFlag: 'schedule only',
			emptyReason: 'empty day',
		},
		timeOfDay: {
			heading: 'By time of day',
			severeShare: 'Severe-delay share',
			caveat:
				'Severe-delay share by time of day, worst first. A trailing-window punctuality proxy, not certified performance; small samples vary.',
		},
		stateCuts: {
			heading: 'Service delivered',
			completenessLabel: 'Scheduled service delivered',
			explainer:
				'Completeness is the share of scheduled trips the network actually ran. A silent trip is scheduled but never appears in the live feed; it is counted as not delivered.',
			standDown: 'No data yet; this reading accrues once scheduled-service coverage is published.',
			splitLabel: 'Scheduled trips, by outcome',
			delivered: 'Delivered',
			cancelled: 'Cancelled',
			silent: 'Silent',
		},
		notReported: {
			heading: 'Scheduled but never appeared',
			rowLabel: 'Line',
			scheduled: (n) => `${n} scheduled`,
			viewDetail: (id) => `View line ${id}`,
			shownOfTotal: (shown, total) => `Showing ${shown} of ${total}`,
			caveat:
				'Lines that were scheduled today yet never appeared in the live feed, silent, not explicitly cancelled. This list is per line, not identifiable buses.',
		},
		receiptSection: 'The receipt',
		terminalTitle: 'service-receipt',
		terminalTag: 'DAILY',
		issuedLabel: 'For',
		metrics: {
			onTime: 'On-time',
			avgDelay: 'Average delay',
			severe: 'Severe delays',
			riderImpact: 'Rider impact',
		},
		countsSection: 'Affected on the day',
		counts: {
			routes: 'Lines',
			stops: 'Stops',
			alerts: 'Alerts',
			vehicles: 'Vehicles',
		},
		worstSection: 'Worst of the day',
		worst: {
			routeLabel: 'Worst line',
			stopLabel: 'Worst stop',
			routeDeltaLabel: 'On-time vs network',
			stopDelayLabel: 'Average delay',
		},
		caveat:
			'A daily summary of observed reliability, not a certified service report. Counts cover entities with a reading on the day; a blank figure means no data, never zero.',
		noData: 'no data',
		emptyIndex: 'No receipts have been published yet. Check back once the daily build runs.',
		emptyReceipt: 'No receipt was published for this day.',
		units: {
			pct: '%',
			min: ' min',
			pts: ' pts',
		},
		dayVerdict: {
			label: 'Day verdict',
			otp: (otpPct) => `The network ran on time ${otpPct} of the time that day`,
			worst: (name, deltaPts) => `worst line ${name} (${deltaPts} lost)`,
			affected: (lines) => `${lines} lines affected`,
			completeness: (pct) => `service delivered at ${pct}`,
			completenessStandDown: 'service completeness not yet available',
			none: 'No overall reading for this day.',
		},
	},
	fr: {
		kicker: 'IMPUTABILITÉ · QUOTIDIEN',
		heading: "Reçu d'imputabilité",
		subheading: '// REÇU',
		lede: 'Un jour, un reçu : la fiabilité globale du service, la journée couverte et le pire de la journée, émis chaque jour, rien de caché.',
		dateSelectLabel: 'Choisir une journée',
		controlsLabel: 'Jour',
		datePicker: {
			label: 'Journée du reçu',
			gapReason: 'aucun reçu',
			scheduleOnlyFlag: 'horaire seulement',
			emptyReason: 'journée vide',
		},
		timeOfDay: {
			heading: 'Par moment de la journée',
			severeShare: 'Part de retards sévères',
			caveat:
				'Part de retards sévères par moment de la journée, du pire au meilleur. Un indicateur de ponctualité sur fenêtre glissante, pas une performance certifiée; les petits échantillons varient.',
		},
		stateCuts: {
			heading: 'Service livré',
			completenessLabel: 'Service planifié livré',
			explainer:
				'La complétude est la part des voyages planifiés que le réseau a réellement effectués. Un voyage silencieux est planifié mais n’apparaît jamais dans le flux en direct : il compte comme non livré.',
			standDown:
				'Aucune donnée pour l’instant. Cette mesure s’accumule une fois la couverture du service planifié publiée.',
			splitLabel: 'Voyages planifiés, par issue',
			delivered: 'Livrés',
			cancelled: 'Annulés',
			silent: 'Silencieux',
		},
		notReported: {
			heading: 'Planifiés mais jamais apparus',
			rowLabel: 'Ligne',
			scheduled: (n) => `${n} planifiés`,
			viewDetail: (id) => `Voir la ligne ${id}`,
			shownOfTotal: (shown, total) => `Affichage de ${shown} sur ${total}`,
			caveat:
				'Des lignes planifiées aujourd’hui mais jamais apparues dans le flux en direct, silencieuses, pas explicitement annulées. Cette liste porte sur les lignes, pas des véhicules identifiables.',
		},
		receiptSection: 'Le reçu',
		terminalTitle: 'recu-de-service',
		terminalTag: 'QUOTIDIEN',
		issuedLabel: 'Pour le',
		metrics: {
			onTime: 'À l’heure',
			avgDelay: 'Retard moyen',
			severe: 'Retards sévères',
			riderImpact: 'Impact sur la clientèle',
		},
		countsSection: 'Touchés dans la journée',
		counts: {
			routes: 'Lignes',
			stops: 'Arrêts',
			alerts: 'Avis',
			vehicles: 'Véhicules',
		},
		worstSection: 'Le pire de la journée',
		worst: {
			routeLabel: 'Pire ligne',
			stopLabel: 'Pire arrêt',
			routeDeltaLabel: 'Ponctualité c. réseau',
			stopDelayLabel: 'Retard moyen',
		},
		caveat:
			'Un résumé quotidien de la fiabilité observée, et non un rapport de service certifié. Les décomptes portent sur les entités ayant une mesure ce jour-là; une valeur vide signifie aucune donnée, jamais zéro.',
		noData: 'aucune donnée',
		emptyIndex:
			'Aucun reçu n’a encore été publié. Revenez une fois la production quotidienne effectuée.',
		emptyReceipt: 'Aucun reçu n’a été publié pour cette journée.',
		units: {
			pct: '%',
			min: ' min',
			pts: ' pts',
		},
		dayVerdict: {
			label: 'Verdict du jour',
			otp: (otpPct) => `Le réseau a été à l’heure ${otpPct} ce jour-là`,
			worst: (name, deltaPts) => `pire ligne ${name} (${deltaPts} pts perdus)`,
			affected: (lines) => `${lines} lignes touchées`,
			completeness: (pct) => `service assuré à ${pct}`,
			completenessStandDown: 'complétude du service pas encore disponible',
			none: 'Aucune lecture d’ensemble pour ce jour.',
		},
	},
};
