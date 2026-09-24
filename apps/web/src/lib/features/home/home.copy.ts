import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { SurfaceTarget } from '$lib/nav';

type CopyKey =
	| 'auditKicker'
	| 'auditBody'
	| 'headline'
	| 'headlineAccent'
	| 'clearFilters'
	| 'filterLabel'
	| 'filterByQuestion'
	| 'filterByKind'
	| 'tempoNow'
	| 'tempoRecord'
	| 'tempoMethod'
	| 'filterEmpty'
	| 'qWhere'
	| 'qTrust'
	| 'qPromise'
	| 'qMethod'
	| 'exploreNav';

export const homeCopy = defineCopy({
	fr: {
		auditKicker: 'Montréal · Données publiques',
		auditBody:
			'Un regard citoyen sur la santé du réseau : retards, fiabilité et limites des données publiques.',
		headline: 'Le transport à Montréal,',
		headlineAccent: 'à l’épreuve des données.',
		clearFilters: 'Effacer les filtres',
		filterLabel: 'Filtres',
		filterByQuestion: 'Par question',
		filterByKind: 'Par genre',
		tempoNow: 'En direct',
		tempoRecord: 'Le bilan',
		tempoMethod: 'La méthode',
		filterEmpty:
			'Rien ne correspond à ces filtres. Effacez-les pour retrouver toutes les destinations.',
		qWhere: 'Comment va le réseau ?',
		qTrust: 'À quelle ligne se fier ?',
		qPromise: 'Ont-ils tenu parole ?',
		qMethod: 'Derrière les chiffres',
		exploreNav: 'Tout explorer',
	},
	en: {
		auditKicker: 'Montréal · Public data',
		auditBody:
			'A citizen’s view of network health: delays, reliability, and the limits of public data.',
		headline: 'How Montréal’s',
		headlineAccent: 'transit holds up.',
		clearFilters: 'Clear filters',
		filterLabel: 'Filters',
		filterByQuestion: 'By question',
		filterByKind: 'By kind',
		tempoNow: 'Live now',
		tempoRecord: 'The record',
		tempoMethod: 'The method',
		filterEmpty: 'Nothing matches these filters. Clear them to see every destination.',
		qWhere: 'How is the network running?',
		qTrust: 'Which line can I trust?',
		qPromise: 'Did they keep their promise?',
		qMethod: 'Behind the numbers',
		exploreNav: 'Explore everything',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<CopyKey, string>>>>);

export type HomeCopy = (typeof homeCopy)[Locale];

export type HomeTempo = 'now' | 'record' | 'method';

interface HomeEntryBody {
	readonly tempo: HomeTempo;
	readonly title: Readonly<Record<Locale, string>>;
	readonly desc: Readonly<Record<Locale, string>>;
}

export type HomeEntry =
	| (HomeEntryBody & { readonly kind: 'surface'; readonly target: SurfaceTarget })
	| (HomeEntryBody & { readonly kind: 'link'; readonly href: string });

export interface HomeGroup {
	readonly key: 'where-bus' | 'trust-line' | 'promise' | 'method';
	readonly question: () => string;
	readonly entries: readonly HomeEntry[];
}

export function homeGroups(t: HomeCopy): readonly HomeGroup[] {
	return [
		{
			key: 'where-bus',
			question: () => t.qWhere,
			entries: [
				{
					kind: 'surface',
					target: { kind: 'map' },
					tempo: 'now',
					title: { fr: 'Carte du réseau', en: 'Network map' },
					desc: {
						fr: 'Consultez les positions reçues et les avis de service. Sélectionnez un marqueur pour voir ses détails.',
						en: 'Explore reported vehicle positions and service alerts. Select a marker to inspect its details.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'stop' },
					tempo: 'now',
					title: { fr: 'Arrêts', en: 'Stops' },
					desc: {
						fr: 'Les passages prévus et la fiabilité observée à chaque arrêt.',
						en: 'Predicted departures and reported reliability at each stop.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'search' },
					tempo: 'now',
					title: { fr: 'Rechercher', en: 'Search' },
					desc: {
						fr: 'Trouvez une ligne, un arrêt ou un véhicule par son nom ou son numéro.',
						en: 'Find a line, a stop or a vehicle by its name or number.',
					},
				},
			],
		},
		{
			key: 'trust-line',
			question: () => t.qTrust,
			entries: [
				{
					kind: 'surface',
					target: { kind: 'line' },
					tempo: 'record',
					title: { fr: 'Lignes', en: 'Lines' },
					desc: {
						fr: 'Une page par ligne : l’horaire, les retards, et sa tenue jour après jour.',
						en: 'One page per line: the schedule, the delays, and how it holds up day after day.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'network-health' },
					tempo: 'now',
					title: { fr: 'Santé du réseau', en: 'Network health' },
					desc: {
						fr: 'Les conditions observées sur le réseau, avec les retards et la couverture des données.',
						en: 'Reported conditions across the network, with delays and feed coverage.',
					},
				},
				{
					kind: 'link',
					href: '/hotspots',
					tempo: 'record',
					title: { fr: 'Points chauds', en: 'Hotspots' },
					desc: {
						fr: 'Les endroits où les retards s’accumulent, sur l’ensemble du réseau.',
						en: 'The places where delays pile up, mapped across the whole network.',
					},
				},
			],
		},
		{
			key: 'promise',
			question: () => t.qPromise,
			entries: [
				{
					kind: 'link',
					href: '/receipt',
					tempo: 'record',
					title: { fr: 'Reçu quotidien', en: 'Daily receipt' },
					desc: {
						fr: 'Les retards du jour et les trajets observés, comparés aux volumes prévus.',
						en: 'Daily delays and observed service counts, compared with the schedule.',
					},
				},
				{
					kind: 'link',
					href: '/repeat-offenders',
					tempo: 'record',
					title: { fr: 'Récidivistes', en: 'Repeat offenders' },
					desc: {
						fr: 'Les lignes qui accumulent les retards, jour après jour, classées au grand jour.',
						en: 'The lines that keep running late, day after day, ranked in the open.',
					},
				},
				{
					kind: 'link',
					href: '/alerts',
					tempo: 'now',
					title: { fr: 'Avis', en: 'Alerts' },
					desc: {
						fr: 'Les perturbations en vigueur en ce moment, et l’historique des précédentes.',
						en: 'Service disruptions in effect right now, plus the record of past ones.',
					},
				},
			],
		},
		{
			key: 'method',
			question: () => t.qMethod,
			entries: [
				{
					kind: 'link',
					href: '/metrics',
					tempo: 'method',
					title: { fr: 'Comment on mesure', en: 'How we measure' },
					desc: {
						fr: 'Chaque chiffre expliqué simplement : ce qu’il mesure et les limites des données.',
						en: 'Every number explained in plain words: what it measures and the limits of the data.',
					},
				},
				{
					kind: 'link',
					href: '/status',
					tempo: 'method',
					title: { fr: 'Santé des données', en: 'Data health' },
					desc: {
						fr: 'Nos données sont-elles fraîches ? Le dernier signal de chaque flux, et les trous qu’on connaît.',
						en: 'Is our data fresh? When each feed last answered, and the gaps we know about.',
					},
				},
			],
		},
	];
}

export const HOME_FILTER_COUNT_LABEL: Readonly<
	Record<Locale, { readonly singular: string; readonly plural: string }>
> = {
	en: { singular: '{count} destination', plural: '{count} destinations' },
	fr: { singular: '{count} destination', plural: '{count} destinations' },
};
