import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { SurfaceTarget } from '$lib/nav';

type CopyKey =
	| 'enter'
	| 'filterLabel'
	| 'filterByQuestion'
	| 'filterByKind'
	| 'tempoNow'
	| 'tempoRecord'
	| 'tempoMethod'
	| 'filterOpen'
	| 'filterClose'
	| 'filterEmpty'
	| 'qWhere'
	| 'qWhereScope'
	| 'qTrust'
	| 'qTrustScope'
	| 'qPromise'
	| 'qPromiseScope'
	| 'qMethod'
	| 'qMethodScope'
	| 'exploreNav';

export const homeCopy = defineCopy({
	fr: {
		enter: 'Ouvrir',
		filterLabel: 'Filtres',
		filterByQuestion: 'Par question',
		filterByKind: 'Par genre',
		tempoNow: 'En direct',
		tempoRecord: 'Le bilan',
		tempoMethod: 'La méthode',
		filterOpen: 'Ouvrir les filtres',
		filterClose: 'Fermer les filtres',
		filterEmpty:
			'Rien ne correspond à ces filtres. Effacez-les pour retrouver toutes les destinations.',
		qWhere: 'Où est mon bus ?',
		qWhereScope: 'Le voir bouger, savoir quand il passe, trouver le vôtre.',
		qTrust: 'À quelle ligne se fier ?',
		qTrustScope: 'Comparer la performance réelle des lignes et du réseau.',
		qPromise: 'Ont-ils tenu parole ?',
		qPromiseScope: 'Le bilan du jour, les récidivistes et les perturbations.',
		qMethod: 'Derrière les chiffres',
		qMethodScope: 'Comment on mesure, et à quel point les données sont fraîches.',
		exploreNav: 'Tout explorer',
	},
	en: {
		enter: 'Open',
		filterLabel: 'Filters',
		filterByQuestion: 'By question',
		filterByKind: 'By kind',
		tempoNow: 'Live now',
		tempoRecord: 'The record',
		tempoMethod: 'The method',
		filterOpen: 'Open the filters',
		filterClose: 'Close the filters',
		filterEmpty: 'Nothing matches these filters. Clear them to see every destination.',
		qWhere: 'Where’s my bus?',
		qWhereScope: 'See it moving, know when it comes, find yours.',
		qTrust: 'Which line can I trust?',
		qTrustScope: 'Compare how lines and the whole network actually perform.',
		qPromise: 'Did they keep their promise?',
		qPromiseScope: 'The daily verdict, the repeat offenders, the disruptions.',
		qMethod: 'Behind the numbers',
		qMethodScope: 'How we measure, and how fresh the data is.',
		exploreNav: 'Explore everything',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<CopyKey, string>>>>);

export type HomeCopy = (typeof homeCopy)[Locale];

export type HomeTempo = 'now' | 'record' | 'method';

interface HomeEntryBody {
	readonly glyph: string;
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
	readonly scope: () => string;
	readonly entries: readonly HomeEntry[];
}

export function homeGroups(t: HomeCopy): readonly HomeGroup[] {
	return [
		{
			key: 'where-bus',
			question: () => t.qWhere,
			scope: () => t.qWhereScope,
			entries: [
				{
					kind: 'surface',
					target: { kind: 'map' },
					glyph: '✦',
					tempo: 'now',
					title: { fr: 'Carte en direct', en: 'Live map' },
					desc: {
						fr: 'Chaque bus sur la carte, en mouvement en temps réel. Touchez-en un pour le suivre.',
						en: 'Every bus on the map, moving in real time. Tap one to follow it.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'stop' },
					glyph: '■',
					tempo: 'now',
					title: { fr: 'Arrêts', en: 'Stops' },
					desc: {
						fr: 'Les prochains passages à votre arrêt, et sa fiabilité habituelle.',
						en: 'The next departures at your stop, and how reliable it usually is.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'search' },
					glyph: '⌕',
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
			scope: () => t.qTrustScope,
			entries: [
				{
					kind: 'surface',
					target: { kind: 'line' },
					glyph: '═',
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
					glyph: '◎',
					tempo: 'now',
					title: { fr: 'Santé du réseau', en: 'Network health' },
					desc: {
						fr: 'Tout le réseau d’un coup d’œil : la part qui roule à l’heure en ce moment.',
						en: 'The whole network at a glance: how much of it is running on time right now.',
					},
				},
				{
					kind: 'link',
					href: '/hotspots',
					glyph: '▲',
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
			scope: () => t.qPromiseScope,
			entries: [
				{
					kind: 'link',
					href: '/receipt',
					glyph: '🜨',
					tempo: 'record',
					title: { fr: 'Reçu quotidien', en: 'Daily receipt' },
					desc: {
						fr: 'Le bilan du jour, chiffre par chiffre : ce qui était promis, ce qui est vraiment passé.',
						en: 'The day in numbers, line by line: what was promised, what actually showed up.',
					},
				},
				{
					kind: 'link',
					href: '/repeat-offenders',
					glyph: '↻',
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
					glyph: '⚠',
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
			scope: () => t.qMethodScope,
			entries: [
				{
					kind: 'link',
					href: '/metrics',
					glyph: '∑',
					tempo: 'method',
					title: { fr: 'Comment on mesure', en: 'How we measure' },
					desc: {
						fr: 'Chaque chiffre défini en mots simples : ce qu’il compte, et ce qu’il rate honnêtement.',
						en: 'Every number defined in plain words: what it counts, and what it honestly misses.',
					},
				},
				{
					kind: 'link',
					href: '/status',
					glyph: '♥',
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
