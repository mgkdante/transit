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
		openMenu: 'Ouvrir le menu',
		closeMenu: 'Fermer le menu',
		menu: 'Menu de navigation',
		theme: 'Thème sombre',
		nav: 'Navigation principale',
		language: 'Langue',
		network: 'Réseau de transport',
		defaultNetwork: 'Réseau par défaut',
		newTab: '(nouvel onglet)',
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
		openMenu: 'Open menu',
		closeMenu: 'Close menu',
		menu: 'Navigation menu',
		theme: 'Dark theme',
		nav: 'Primary navigation',
		language: 'Language',
		network: 'Transit network',
		defaultNetwork: 'Default network',
		newTab: '(opens in a new tab)',
	},
});
