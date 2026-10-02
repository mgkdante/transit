import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => {
	const localePrefix = params.lang ? `/${params.lang}` : '';
	redirect(301, `${localePrefix}/lines/${encodeURIComponent(params.id)}${url.search}`);
};

export const HEAD: RequestHandler = GET;
