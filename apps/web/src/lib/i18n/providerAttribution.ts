import { defineCopy, type Locale } from './copy';

export const providerAttributionCopy = defineCopy({
	fr: {
		stm: 'Contient des données de la Société de transport de Montréal mises à disposition selon la licence CC BY 4.0.',
		octranspo:
			"Contient de l'information visée par la Licence du gouvernement ouvert – Ville d'Ottawa.",
	},
	en: {
		stm: 'Contains STM data made available under CC BY 4.0.',
		octranspo: 'Contains information licensed under the Open Government Licence – City of Ottawa.',
	},
});

export function providerAttribution(provider: string, published: string, locale: Locale): string {
	if (locale === 'fr' && Object.hasOwn(providerAttributionCopy.fr, provider)) {
		return providerAttributionCopy.fr[provider as keyof typeof providerAttributionCopy.fr];
	}
	return published;
}
