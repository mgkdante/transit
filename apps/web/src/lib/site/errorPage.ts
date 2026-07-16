import type { Locale } from '$lib/i18n';

export interface ErrorPageLocaleCopy {
	generic: {
		label: string;
		heading: string;
		body: string;
		home: string;
	};
	notFound: {
		label: string;
		heading: string;
		description: string;
		statusNote: string;
		suggestions: readonly { label: string; href: string }[];
	};
}

export const errorPageCopy: Record<Locale, ErrorPageLocaleCopy> = {
	fr: {
		generic: {
			label: 'HORS SERVICE',
			heading: 'Une erreur est survenue',
			body: 'Quelque chose s’est mal passé en chargeant cette vue. Réessayez ou revenez à l’accueil.',
			home: 'Retour à l’accueil',
		},
		notFound: {
			label: 'ROUTE INTROUVABLE',
			heading: 'Cette station est en construction',
			description:
				'La route demandée n’existe pas ou a été redirigée. Voici quelques destinations actives :',
			statusNote: '// chemin demandé hors service',
			suggestions: [
				{ label: 'Lignes', href: '/lines' },
				{ label: 'Arrêts', href: '/stops' },
				{ label: 'Réseau', href: '/network' },
			],
		},
	},
	en: {
		generic: {
			label: 'OUT OF SERVICE',
			heading: 'Something went wrong',
			body: 'Something failed while loading this view. Try again or head back home.',
			home: 'Back to home',
		},
		notFound: {
			label: 'ROUTE NOT FOUND',
			heading: 'This station is under construction',
			description:
				"The route you requested doesn't exist or has been rerouted. Here are some active destinations:",
			statusNote: '// requested path not in service',
			suggestions: [
				{ label: 'Lines', href: '/lines' },
				{ label: 'Stops', href: '/stops' },
				{ label: 'Network', href: '/network' },
			],
		},
	},
};

export function errorDocumentHead(
	status: number,
	locale: Locale,
): {
	title: string;
	description: string;
} {
	const copy = errorPageCopy[locale];
	return status === 404
		? {
				title: `${status} · ${copy.notFound.heading}`,
				description: copy.notFound.description,
			}
		: {
				title: `${status} · ${copy.generic.heading}`,
				description: copy.generic.body,
			};
}
