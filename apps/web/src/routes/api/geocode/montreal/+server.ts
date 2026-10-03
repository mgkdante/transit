import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const params = new URLSearchParams(url.searchParams);
	params.set('provider', 'stm');
	redirect(307, `/api/geocode?${params}`);
};
