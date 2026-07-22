// trips.copy.ts — co-located bilingual copy for the Trip detail surface (slice-9.4).
//
// The standalone /trip/[id] screen owns its non-intrinsic, user-facing strings
// here so the .svelte stays markup-only. FR is the canonical product voice; EN
// mirrors it. Provider-agnostic: no agency/city literals. Em-dash-free per repo
// doctrine. A trip is an EPHEMERAL live entity (ids rotate), so the copy frames
// every ETA as a LIVE PREDICTION with an honest delay basis, never a guarantee.

import { defineCopy, type Locale } from '$lib/i18n/copy';

export const tripCopy = defineCopy({
	fr: {
		kicker: 'TRAJET',
		crumbHome: 'Accueil',
		heading: (id: string) => `Trajet ${id}`,
		subheading: '// EN DIRECT',
		lede: 'Prédiction en direct pour ce trajet: ligne, statut, retard et prochains arrêts. Mesuré depuis le contrat ouvert /v1, jamais inventé.',
		route: 'Ligne',
		viewRoute: (route: string) => `Voir la ligne ${route}`,
		noRoute: 'Ligne non communiquée',
		verdictHeading: 'Verdict',
		destinationHeading: 'Destination',
		stopsRemaining: (n: number) => (n === 1 ? '1 arrêt restant' : `${n} arrêts restants`),
		statusHeading: 'Statut',
		status: {
			early: 'En avance',
			on_time: "À l'heure",
			late: 'En retard',
			severe: 'Très en retard',
			unknown: 'Inconnu',
		},
		delayLabel: 'Retard',
		early: (minutes: number) => `${Math.abs(minutes)} min en avance`,
		late: (minutes: number) => `${minutes} min en retard`,
		onTime: "À l'heure",
		noDelay: 'Aucune donnée',
		remainingStops: 'Prochains arrêts',
		stopsListLabel: 'Prochains arrêts de ce trajet',
		viewStop: (stop: string) => `Voir l’arrêt ${stop}`,
		predictionLabel: 'Prédiction en direct',
		predictionCaveat:
			'Les prédictions sont calculées en direct à partir de la position du véhicule et peuvent varier; elles ne sont pas garanties.',
		viewOnMap: 'Voir sur la carte',
		viewTripOnMap: (id: string) => `Voir le trajet ${id} sur la carte`,
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
		verdictHeading: 'Verdict',
		destinationHeading: 'Destination',
		stopsRemaining: (n) => (n === 1 ? '1 stop remaining' : `${n} stops remaining`),
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
});

export type TripDetailCopy = (typeof tripCopy)[Locale];
