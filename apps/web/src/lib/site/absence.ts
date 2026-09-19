// Provider-independent absence vocabulary; service-window reasons retain their original owner.

import type { Locale } from '$lib/i18n';
import type { AbsenceReasonKey as ServiceWindowReasonKey } from './serviceWindow';

export type { AbsenceReasonKey as ServiceWindowReasonKey } from './serviceWindow';
export type { AbsenceReason, AbsenceSignals } from './serviceWindow';
export { inferAbsenceReason } from './serviceWindow';

/** Field absence is distinct from the service-window reason for a whole block. */
export type ValueAbsenceKey =
	| 'not-reported'
	| 'not-reporting'
	| 'not-in-schedule'
	| 'no-prediction'
	| 'end-of-route'
	| 'inferred'
	| 'no-observations'
	| 'histogram-not-published'
	| 'not-published'
	| 'no-retained-dates'
	| 'no-gap-inventory'
	| 'no-declared-gaps'
	| 'no-metric-inventory'
	| 'no-retained-data';

/** Service-window and field-level reasons share one presentation vocabulary. */
export type AbsenceReasonKey = ServiceWindowReasonKey | ValueAbsenceKey;

/** Narrow on `known`; a measured zero remains a present value. */
export type Maybe<T> =
	| { readonly known: true; readonly value: T }
	| {
			readonly known: false;
			readonly reason: AbsenceReasonKey;
			readonly params?: Readonly<Record<string, string | number>>;
	  };

/** Wrap a present value. */
export function known<T>(value: T): Maybe<T> {
	return { known: true, value };
}

/** Mark a value absent with a typed reason + optional copy params. */
export function absent<T>(
	reason: AbsenceReasonKey,
	params?: Readonly<Record<string, string | number>>,
): Maybe<T> {
	return params ? { known: false, reason, params } : { known: false, reason };
}

/** Localized copy uses {first}/{age} parameters supplied by the caller, never invented values. */
type ReasonCopy = { readonly short: string; readonly why: string };

export const ABSENCE_COPY: Record<Locale, Record<AbsenceReasonKey, ReasonCopy>> = {
	en: {
		// service-window keys (block-level)
		'metro-no-realtime': { short: 'No live data', why: 'live positions are not published here' },
		'closed-opens-at': { short: 'Closed', why: 'service is closed, opens at {first}' },
		'overnight-opens-at': { short: 'No service', why: 'no service at this hour, opens at {first}' },
		'before-open': { short: 'Not started', why: 'service has not started yet, opens at {first}' },
		'scheduled-silent': { short: 'No signal', why: 'scheduled, but nothing is reporting live' },
		'last-seen': { short: 'No recent position', why: 'last seen {age}' },
		// value-absence keys (per-field)
		'not-reported': { short: 'Unknown', why: 'not reported in the live feed' },
		'not-reporting': { short: 'Stale', why: 'this vehicle is not reporting' },
		'not-in-schedule': { short: 'Unknown', why: 'not in the schedule' },
		'no-prediction': { short: 'No estimate', why: 'no prediction available' },
		'end-of-route': { short: 'End of line', why: 'no next stop, the trip has ended' },
		inferred: { short: 'Estimated', why: 'estimated, not published directly' },
		'no-observations': { short: 'No data', why: 'not enough readings yet' },
		'histogram-not-published': {
			short: 'No histogram',
			why: 'the selected view does not publish a delay histogram',
		},
		'not-published': {
			short: 'Not published',
			why: 'this family is not listed in the retained history index',
		},
		'no-retained-dates': {
			short: 'No retained dates',
			why: 'the history index reports no published date range',
		},
		'no-gap-inventory': {
			short: 'No gap inventory',
			why: 'the history index does not publish gap details',
		},
		'no-declared-gaps': {
			short: 'No declared gaps',
			why: 'the history index reports no known gaps',
		},
		'no-metric-inventory': {
			short: 'No metric inventory',
			why: 'the history index does not publish per-metric coverage',
		},
		'no-retained-data': {
			short: 'No retained data',
			why: 'no data is retained for this range',
		},
	},
	fr: {
		// service-window keys (block-level)
		'metro-no-realtime': {
			short: 'Aucune donnée en direct',
			why: 'les positions en direct ne sont pas publiées ici',
		},
		'closed-opens-at': { short: 'Fermé', why: 'service terminé, reprise à {first}' },
		'overnight-opens-at': {
			short: 'Aucun service',
			why: 'aucun service à cette heure, reprise à {first}',
		},
		'before-open': { short: 'Pas commencé', why: 'service pas encore commencé, début à {first}' },
		'scheduled-silent': {
			short: 'Aucun signal',
			why: 'prévu à l’horaire, mais rien ne se signale',
		},
		'last-seen': { short: 'Aucune position récente', why: 'dernière position {age}' },
		// value-absence keys (per-field)
		'not-reported': { short: 'Inconnu', why: 'non signalé dans le flux en direct' },
		'not-reporting': { short: 'Obsolète', why: 'ce véhicule ne se signale pas' },
		'not-in-schedule': { short: 'Inconnu', why: 'absent de l’horaire' },
		'no-prediction': { short: 'Aucune estimation', why: 'aucune prévision disponible' },
		'end-of-route': { short: 'Terminus', why: 'aucun arrêt suivant, le trajet est terminé' },
		inferred: { short: 'Estimé', why: 'estimé, non publié directement' },
		'no-observations': { short: 'Aucune donnée', why: 'pas assez de mesures' },
		'histogram-not-published': {
			short: 'Aucun histogramme',
			why: 'la vue sélectionnée ne publie pas d’histogramme des retards',
		},
		'not-published': {
			short: 'Non publiée',
			why: 'cette famille n’apparaît pas dans l’index de l’historique conservé',
		},
		'no-retained-dates': {
			short: 'Aucune date conservée',
			why: 'l’index historique ne signale aucune plage de dates publiée',
		},
		'no-gap-inventory': {
			short: 'Aucun inventaire',
			why: 'l’index historique ne publie pas le détail des lacunes',
		},
		'no-declared-gaps': {
			short: 'Aucune lacune déclarée',
			why: 'l’index historique ne signale aucune lacune connue',
		},
		'no-metric-inventory': {
			short: 'Aucun détail métrique',
			why: 'l’index historique ne publie pas la couverture par métrique',
		},
		'no-retained-data': {
			short: 'Aucune donnée conservée',
			why: 'aucune donnée n’est conservée pour cette plage',
		},
	},
};

/**
 * The resolved, render-ready absence description. `tone` is a SEMANTIC token
 * string (not a colour) the visual layer maps to a class/var — always "unknown"
 * here: an honest absence is calm + neutral, never an error or a warning.
 */
export interface AbsenceDescription {
	readonly label: string;
	readonly why: string;
	readonly tone: 'unknown';
}

/** Interpolate `{name}` placeholders in a copy string from params (missing → left as-is). */
function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	);
}

/** Unknown keys fall back to not-reported copy rather than exposing an internal key. */
export function describeAbsence(
	reason: AbsenceReasonKey,
	locale: Locale,
	params?: Readonly<Record<string, string | number>>,
): AbsenceDescription {
	const table = ABSENCE_COPY[locale] ?? ABSENCE_COPY.en;
	const copy = table[reason] ?? table['not-reported'];
	return {
		label: copy.short,
		why: interpolate(copy.why, params),
		tone: 'unknown',
	};
}

/** Canonical terse form for string-only chart, SVG, aria, and control consumers. */
export function absenceShort(reason: AbsenceReasonKey, locale: Locale): string {
	return describeAbsence(reason, locale).label;
}

/** Canonical complete text form for string-only consumers that cannot render the chassis. */
export function absenceSentence(
	reason: AbsenceReasonKey,
	locale: Locale,
	params?: Readonly<Record<string, string | number>>,
): string {
	const description = describeAbsence(reason, locale, params);
	return `${description.label} · ${description.why}`;
}

/** A stale entity is not-reporting; a missing field on a present entity is not-reported. */
export function fieldAbsenceReason(signals: { stale?: boolean }): ValueAbsenceKey {
	return signals.stale ? 'not-reporting' : 'not-reported';
}

/** Preserve actionable IDs: unknown stops disclose their missing name; routes use their public number. */
const NAME_FALLBACK_COPY: Record<Locale, { stop: string; route: string }> = {
	en: { stop: 'Stop {id} (name unavailable)', route: 'Route {id}' },
	fr: { stop: 'Arrêt {id} (nom indisponible)', route: 'Ligne {id}' },
};

/** Labelled fallback for an unresolved STOP name (keeps the id, says it is unavailable). */
export function stopNameFallback(id: string, locale: Locale): string {
	return interpolate((NAME_FALLBACK_COPY[locale] ?? NAME_FALLBACK_COPY.en).stop, { id });
}

/** Labelled fallback for an unresolved ROUTE long name (explicit "Route {id}"). */
export function routeNameFallback(id: string, locale: Locale): string {
	return interpolate((NAME_FALLBACK_COPY[locale] ?? NAME_FALLBACK_COPY.en).route, { id });
}
