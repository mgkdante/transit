// absence.ts — the ONE shared unknown-data layer (LOGIC).
//
// PURE, provider-agnostic business layer for HONEST ABSENCE across the whole app.
// Zero Svelte, zero markup, zero styling, zero clock, zero fetch, zero DOM. It is
// the single brain S6..S15 surfaces reuse so the same missing-data logic applies
// everywhere cleanly, with the VISUAL layer (AbsentValue.svelte) strictly separate.
//
// It EXTENDS serviceWindow.ts (the block-level absence inference) instead of
// forking it:
//   - the service-window reason keys (metro-no-realtime, closed-opens-at,
//     overnight-opens-at, before-open, scheduled-silent, last-seen) are RE-EXPORTED,
//     never re-declared;
//   - NEW per-FIELD value-absence keys (not-reported, not-reporting, not-in-schedule,
//     no-prediction, end-of-route, inferred) cover a single missing value in a row
//     rather than a whole block standing down.
//
// Three pieces:
//   AbsenceReasonKey   — the unified key union (window keys + value-absence keys).
//   Maybe<T>           — a value-or-absence discriminated type + known()/absent().
//   describeAbsence()  — a pure resolver: key + locale + params -> { label, why, tone }.
//
// HONESTY: copy is provider-agnostic DATA (no STM/STO/OC/STS literal), bilingual
// EN+FR, and never uses an em dash (a middle dot or comma instead).

import type { Locale } from '$lib/i18n';
import type { AbsenceReasonKey as ServiceWindowReasonKey } from './serviceWindow';

// Re-export the serviceWindow keys + the structured reason so consumers have ONE
// import home for the absence vocabulary (do NOT fork the union).
export type { AbsenceReasonKey as ServiceWindowReasonKey } from './serviceWindow';
export type { AbsenceReason, AbsenceSignals } from './serviceWindow';
export { inferAbsenceReason } from './serviceWindow';

/**
 * NEW per-FIELD value-absence keys (one missing value in a row, not a whole block):
 *   not-reported    — the live feed omitted this field for an otherwise-present row.
 *   not-reporting   — the entity itself is stale (e.g. a GPS-stale vehicle).
 *   not-in-schedule — absent from the static index (e.g. an unresolved stop/route name).
 *   no-prediction   — no ETA/delay was predicted for this item.
 *   end-of-route    — no next item because the trip ended.
 *   inferred        — value synthesized (computed/estimated), not published as-is.
 *   no-observations — a historic/aggregate metric had too few readings to report.
 */
export type ValueAbsenceKey =
	| 'not-reported'
	| 'not-reporting'
	| 'not-in-schedule'
	| 'no-prediction'
	| 'end-of-route'
	| 'inferred'
	| 'no-observations';

/**
 * The canonical, unified absence vocabulary: every service-window reason key plus
 * every per-field value-absence key. One union the whole app branches on.
 */
export type AbsenceReasonKey = ServiceWindowReasonKey | ValueAbsenceKey;

/**
 * A value that is either KNOWN (carry the value) or ABSENT (carry the typed reason
 * + optional copy params). The discriminant is `known`, so consumers narrow with
 * `if (m.known)` and never null-check or invent a placeholder.
 */
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

/**
 * Bilingual, PROVIDER-AGNOSTIC reason copy as DATA. Two strings per key:
 *   short — a terse in-row label (e.g. "Unknown").
 *   why   — the honest one-clause reason (e.g. "not reported in the live feed").
 * No em dash anywhere (middle dot / comma). No provider literal. EN is the source
 * voice; FR mirrors it one-for-one.
 *
 * The opens-at / last-seen variants leave a `{first}` / `{age}` placeholder for
 * describeAbsence to interpolate from params, so the copy never fabricates a value.
 */
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

/**
 * PURE resolver: map a reason key (+ locale + optional copy params) to the
 * render-ready { label, why, tone }. The single place copy is selected — the
 * visual layer never branches on a key. Unknown keys fall back to the generic
 * "not reported" copy so a caller can never render a raw key.
 */
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

/**
 * Thin per-field inferrer: pick the right value-absence key from a stale flag.
 * A stale entity is "not-reporting" (it exists but has gone quiet); a present
 * entity with a missing field is "not-reported" (the feed simply omitted it).
 * Pure + tiny by design; richer field rules belong in the calling surface.
 */
export function fieldAbsenceReason(signals: { stale?: boolean }): ValueAbsenceKey {
	return signals.stale ? 'not-reporting' : 'not-reported';
}

/**
 * Bilingual, PROVIDER-AGNOSTIC labelled fallback for a NAME we could not resolve
 * from the static index. We keep the stable identifier (so the row is still
 * actionable) and SAY the name is unavailable, instead of leaking a bare id that
 * reads as a name. Two patterns:
 *   stop  → "Stop {id} (name unavailable)" / "Arrêt {id} (nom indisponible)"
 *   route → "Route {id}" / "Ligne {id}" (the id IS the rider-facing route number,
 *           so no "unavailable" qualifier is needed, just an explicit kind prefix).
 *
 * This lives in the absence LOGIC layer (not a surface copy file) so every surface
 * shares the same honest wording. No em dash (a parenthetical, never a dash).
 */
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
