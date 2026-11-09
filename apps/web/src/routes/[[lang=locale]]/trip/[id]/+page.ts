import type { PageLoad } from './$types';
import { pathLocale } from '#lib/i18n/index.ts';

export const load: PageLoad = ({ params, url }) => {
	return {
		id: params.id,
		lang: pathLocale(url.pathname),
	};
};
