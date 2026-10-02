import { defineCopy, type Locale } from '$lib/i18n/copy';

export const tripCopy = defineCopy({
	fr: {
		kicker: 'TRAJET',
		crumbHome: 'Accueil',
		heading: (id: string) => `Trajet ${id}`,
		subheading: '// PRÉDICTIONS',
		route: 'Ligne',
		viewRoute: (route: string) => `Voir la ligne ${route}`,
		verdictHeading: 'Verdict',
		lastReportedStop: 'Dernier arrêt communiqué',
		predictionCount: (n: number) =>
			n === 1 ? '1 prédiction communiquée' : `${n} prédictions communiquées`,
		status: {
			early: 'En avance',
			on_time: "À l'heure",
			late: 'En retard',
			severe: 'Très en retard',
			unknown: 'Inconnu',
		},
		early: (minutes: number) => `${Math.abs(minutes)} min en avance`,
		late: (minutes: number) => `${minutes} min en retard`,
		onTime: "À l'heure",
		reportedPredictions: 'Prédictions sur une heure',
		stopsListLabel: 'Prédictions communiquées pour ce trajet',
		viewStop: (stop: string) => `Voir l’arrêt ${stop}`,
		predictionLabel: 'Prédiction',
		predictionCaveat:
			'Les prédictions couvrent jusqu’à une heure au moment de la préparation du rapport. Elles peuvent changer.',
		viewOnMap: 'Voir sur la carte',
		viewTripOnMap: (id: string) => `Voir le trajet ${id} sur la carte`,
		standDownHeading: 'Trajet absent de ce rapport',
		standDownBody:
			'Ce rapport ne contient pas ce trajet. Son identifiant a peut-être expiré ou aucune donnée n’a été communiquée.',
		noPredictions: 'Aucune prédiction communiquée pour ce trajet dans cette fenêtre.',
		latestReport: 'Dernier rapport',
		refreshUnavailable: 'Actualisation indisponible',
		reportBehind: 'Rapport en retard',
		retainedReport:
			'Le dernier rapport reçu reste affiché. Ses prédictions peuvent ne plus être à jour.',
	},
	en: {
		kicker: 'TRIP',
		crumbHome: 'Home',
		heading: (id) => `Trip ${id}`,
		subheading: '// PREDICTIONS',
		route: 'Line',
		viewRoute: (route) => `View line ${route}`,
		verdictHeading: 'Verdict',
		lastReportedStop: 'Last reported stop',
		predictionCount: (n) => (n === 1 ? '1 prediction reported' : `${n} predictions reported`),
		status: {
			early: 'Early',
			on_time: 'On time',
			late: 'Late',
			severe: 'Very late',
			unknown: 'Unknown',
		},
		early: (minutes) => `${Math.abs(minutes)} min early`,
		late: (minutes) => `${minutes} min late`,
		onTime: 'On time',
		reportedPredictions: 'Next-hour predictions',
		stopsListLabel: 'Reported predictions for this trip',
		viewStop: (stop) => `View stop ${stop}`,
		predictionLabel: 'Prediction',
		predictionCaveat:
			'Predictions cover up to one hour when the report is prepared. They may change.',
		viewOnMap: 'View on map',
		viewTripOnMap: (id) => `View trip ${id} on map`,
		standDownHeading: 'Trip not in this report',
		standDownBody:
			'This report does not include this trip. Its identifier may have expired, or no data was reported.',
		noPredictions: 'No predictions reported for this trip in this window.',
		latestReport: 'Latest report',
		refreshUnavailable: 'Refresh unavailable',
		reportBehind: 'Report behind schedule',
		retainedReport: 'Showing the last report received. Its predictions may no longer be current.',
	},
});

export type TripDetailCopy = (typeof tripCopy)[Locale];
