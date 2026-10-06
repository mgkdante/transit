import { defineCopy } from '$lib/i18n/copy';

export const alertUnavailableCopy = defineCopy({
	fr: {
		title: 'Avis de service indisponibles',
		body: (operator: string) =>
			`Aucun flux d’avis de ${operator} n’est connecté ici. Cela ne signifie pas qu’il n’y a aucune perturbation.`,
		link: 'Consulter les avis officiels',
	},
	en: {
		title: 'Service alerts unavailable',
		body: (operator: string) =>
			`No ${operator} alert feed is connected here. This does not mean there are no disruptions.`,
		link: 'Check official service alerts',
	},
});
