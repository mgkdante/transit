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
	/** Caption above the receipt body. */
	readonly receiptSection: string;
	/** TerminalChrome title bar text (the receipt "window" title). */
	readonly terminalTitle: string;
	/** TerminalChrome tag chip (a small label beside the title). */
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
}

export const copy: Record<Locale, ReceiptCopy> = {
	en: {
		kicker: 'ACCOUNTABILITY · DAILY',
		heading: 'Accountability receipt',
		subheading: '// RECEIPT',
		lede: 'One day, one receipt: the headline reliability of the service, the day it covers, and the worst of it, issued daily with nothing hidden.',
		dateSelectLabel: 'Choose a receipt day',
		controlsLabel: 'Day',
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
	},
	fr: {
		kicker: 'IMPUTABILITÉ · QUOTIDIEN',
		heading: "Reçu d'imputabilité",
		subheading: '// REÇU',
		lede: 'Un jour, un reçu : la fiabilité globale du service, la journée couverte et le pire de la journée, émis chaque jour, rien de caché.',
		dateSelectLabel: 'Choisir une journée',
		controlsLabel: 'Jour',
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
	},
};
