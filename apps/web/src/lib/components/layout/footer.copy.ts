import { defineCopy } from '$lib/i18n/copy';

export const footerCopy = defineCopy({
	fr: {
		navAria: 'Pied de page',
		statusPrefix: 'SYSTÈME',
		liveLabel: 'En direct',
		providerFallback: 'l’agence de transport',
		tagline: (agencyName: string) => `Analytique citoyenne pour ${agencyName}`,
		disclaimer: (agencyName: string) => `Site non officiel, sans affiliation avec ${agencyName}.`,
		// NavPill's inline AUDIT copy converges here in PR-3.
		auditLabel: 'Vérification',
	},
	en: {
		navAria: 'Footer',
		statusPrefix: 'SYSTEM',
		liveLabel: 'Live',
		providerFallback: 'the transit agency',
		tagline: (agencyName: string) => `Citizen analytics for ${agencyName}`,
		disclaimer: (agencyName: string) => `Unofficial website, not affiliated with ${agencyName}.`,
		auditLabel: 'Audit',
	},
});
