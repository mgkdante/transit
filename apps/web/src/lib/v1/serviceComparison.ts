import { defineCopy } from '$lib/i18n/copy';

export const serviceComparisonCopy = defineCopy({
	en: {
		section: 'Service counts',
		label: 'Observed / scheduled trips',
		explanation:
			'Non-cancelled trip-days reported in the feed divided by the scheduled count, capped at 100%. Trips are not matched by identity; added service can mask missing scheduled trips.',
		tip: 'Non-cancelled observed trip-days ÷ scheduled trip-days, capped at 100%.',
		split: 'Counts relative to the schedule',
		observed: 'Observed, not cancelled',
		cancelled: 'Reported cancelled',
		shortfall: 'Count shortfall',
		unavailable: 'This comparison needs observed trip counts and a non-zero scheduled count.',
		fraction: (observed: string, scheduled: string, shortfall: string | null) =>
			`${observed} observed non-cancelled trip-days / ${scheduled} scheduled${shortfall == null ? '' : ` · ${shortfall} count shortfall`}. Trip identities are not matched.`,
	},
	fr: {
		section: 'Décomptes de service',
		label: 'Trajets observés / prévus',
		explanation:
			'Les jours-trajets non annulés signalés dans le flux divisés par le nombre prévu, avec un plafond de 100 %. Les trajets ne sont pas rapprochés par identifiant; le service ajouté peut masquer des trajets prévus manquants.',
		tip: 'Jours-trajets observés non annulés ÷ jours-trajets prévus, avec un plafond de 100 %.',
		split: 'Décomptes rapportés à l’horaire',
		observed: 'Observés, non annulés',
		cancelled: 'Annulations signalées',
		shortfall: 'Écart de décompte',
		unavailable:
			'Ce rapport nécessite des décomptes observés et un nombre de trajets prévus supérieur à zéro.',
		fraction: (observed: string, scheduled: string, shortfall: string | null) =>
			`${observed} jours-trajets observés non annulés / ${scheduled} prévus${shortfall == null ? '' : ` · écart de décompte : ${shortfall}`}. Aucun rapprochement par identifiant.`,
	},
});
