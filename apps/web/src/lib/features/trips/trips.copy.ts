// trips.copy.ts — co-located bilingual copy for the Trip detail surface (slice-9.4).
//
// The standalone /trip/[id] screen owns its non-intrinsic, user-facing strings
// here so the .svelte stays markup-only. FR is the canonical product voice; EN
// mirrors it. Provider-agnostic: no agency/city literals. Em-dash-free per repo
// doctrine. A trip is an EPHEMERAL live entity (ids rotate), so the copy frames
// every ETA as a LIVE PREDICTION with an honest delay basis, never a guarantee.

import type { Locale } from '$lib/i18n';

export interface TripDetailCopy {
	/** Station-voice overline above the trip heading. */
	readonly kicker: string;
	/** Breadcrumb "Home" root label (the trip trail is built inline — trip has no
	 *  index route, and stays out of the SEO BreadcrumbList since it is noindex). */
	readonly crumbHome: string;
	/** Heading prefix for the trip id (e.g. "Trip 12345"). */
	readonly heading: (id: string) => string;
	/** Mono subheading under the heading. */
	readonly subheading: string;
	/** Short lede describing what this surface shows. */
	readonly lede: string;
	/** Section label above the route link. */
	readonly route: string;
	/** Accessible label for the route link. */
	readonly viewRoute: (route: string) => string;
	/** Shown when the trip carries no route reference. */
	readonly noRoute: string;
	/** Section label above the status / delay readout. */
	readonly statusHeading: string;
	/** Status-band labels keyed by the v1 StatusCode. */
	readonly status: {
		readonly early: string;
		readonly on_time: string;
		readonly late: string;
		readonly severe: string;
		readonly unknown: string;
	};
	/** Trip-level delay readout caption. */
	readonly delayLabel: string;
	/** Delay vocabulary reused on the trip + each stop. */
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	/** Honest unknown: the feed omitted a delay value (never rendered as 0). */
	readonly noDelay: string;
	/** Section label above the remaining-stop ETA list. */
	readonly remainingStops: string;
	/** Accessible label for the remaining-stop list. */
	readonly stopsListLabel: string;
	/** Accessible label for a single stop link. */
	readonly viewStop: (stop: string) => string;
	/** ETA framing: this is a live prediction, not a guarantee. */
	readonly predictionLabel: string;
	/** Honest caveat under the stop list: live predictions drift. */
	readonly predictionCaveat: string;
	/** Map drilldown. */
	readonly viewOnMap: string;
	readonly viewTripOnMap: (id: string) => string;
	/** Stand-down copy when the trip is not currently broadcasting. */
	readonly standDownHeading: string;
	readonly standDownBody: string;
	/** Stand-down copy when the trip is live but has no remaining stops. */
	readonly noRemainingStops: string;
}

export const tripCopy: Record<Locale, TripDetailCopy> = {
	fr: {
		kicker: 'TRAJET',
		crumbHome: 'Accueil',
		heading: (id) => `Trajet ${id}`,
		subheading: '// EN DIRECT',
		lede: 'Prédiction en direct pour ce trajet: ligne, statut, retard et prochains arrêts. Mesuré depuis le contrat ouvert /v1, jamais inventé.',
		route: 'Ligne',
		viewRoute: (route) => `Voir la ligne ${route}`,
		noRoute: 'Ligne non communiquée',
		statusHeading: 'Statut',
		status: {
			early: 'En avance',
			on_time: "À l'heure",
			late: 'En retard',
			severe: 'Très en retard',
			unknown: 'Inconnu',
		},
		delayLabel: 'Retard',
		early: (minutes) => `${Math.abs(minutes)} min en avance`,
		late: (minutes) => `${minutes} min en retard`,
		onTime: "À l'heure",
		noDelay: 'Aucune donnée',
		remainingStops: 'Prochains arrêts',
		stopsListLabel: 'Prochains arrêts de ce trajet',
		viewStop: (stop) => `Voir l’arrêt ${stop}`,
		predictionLabel: 'Prédiction en direct',
		predictionCaveat:
			'Les prédictions sont calculées en direct à partir de la position du véhicule et peuvent varier; elles ne sont pas garanties.',
		viewOnMap: 'Voir sur la carte',
		viewTripOnMap: (id) => `Voir le trajet ${id} sur la carte`,
		standDownHeading: 'Trajet hors diffusion',
		standDownBody:
			"Ce trajet n'est pas diffusé en direct pour le moment. Les identifiants de trajet changent fréquemment.",
		noRemainingStops: 'Aucun arrêt restant communiqué pour ce trajet pour le moment.',
	},
	en: {
		kicker: 'TRIP',
		crumbHome: 'Home',
		heading: (id) => `Trip ${id}`,
		subheading: '// LIVE',
		lede: 'Live prediction for this trip: line, status, delay and remaining stops. Measured from the open /v1 data contract, never invented.',
		route: 'Line',
		viewRoute: (route) => `View line ${route}`,
		noRoute: 'No line reported',
		statusHeading: 'Status',
		status: {
			early: 'Early',
			on_time: 'On time',
			late: 'Late',
			severe: 'Very late',
			unknown: 'Unknown',
		},
		delayLabel: 'Delay',
		early: (minutes) => `${Math.abs(minutes)} min early`,
		late: (minutes) => `${minutes} min late`,
		onTime: 'On time',
		noDelay: 'No data',
		remainingStops: 'Remaining stops',
		stopsListLabel: 'Remaining stops on this trip',
		viewStop: (stop) => `View stop ${stop}`,
		predictionLabel: 'Live prediction',
		predictionCaveat:
			'Predictions are computed live from the vehicle position and can drift; they are not guaranteed.',
		viewOnMap: 'View on map',
		viewTripOnMap: (id) => `View trip ${id} on map`,
		standDownHeading: 'Trip not broadcasting',
		standDownBody: 'This trip is not currently broadcasting. Trip identifiers rotate frequently.',
		noRemainingStops: 'No remaining stops reported for this trip right now.',
	},
};
