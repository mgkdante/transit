import { defineCopy } from '$lib/i18n/copy';

export const navPillCopy = defineCopy({
	fr: {
		searchCollectionNotice:
			'Vos recherches sont envoyées à notre serveur et au service Géo.ca du gouvernement du Canada.',
		searchScopeLabel: 'Afficher',
		searchScopeAll: 'Tout',
		searchScopeRoutes: 'Lignes',
		searchScopeStops: 'Arrêts',
		searchScopeVehicles: 'Bus',
		searchModeLabel: 'Mode',
		searchScopeCount: (label: string, n: number) => `${label} (${n})`,
	},
	en: {
		searchCollectionNotice:
			'Your searches are sent to our server and the Government of Canada Geo.ca service.',
		searchScopeLabel: 'Show',
		searchScopeAll: 'All',
		searchScopeRoutes: 'Lines',
		searchScopeStops: 'Stops',
		searchScopeVehicles: 'Buses',
		searchModeLabel: 'Mode',
		searchScopeCount: (label: string, n: number) => `${label} (${n})`,
	},
});
