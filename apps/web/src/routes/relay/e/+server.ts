// Plausible events arrive here from Transit's own address, so blockers of plausible.io don't drop
// them. The relay forwards each one to Plausible once, with the visitor's IP and user agent.

import * as env from '$app/env/public';
import { relayAnalyticsEvent } from '@yesid/analytics/relay';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = ({ request, getClientAddress }) => {
	// Previews and local builds measure nothing, so they have nothing to relay.
	if (!env.PUBLIC_PLAUSIBLE_DOMAIN) return new Response(null, { status: 404 });
	return relayAnalyticsEvent(request, {
		domain: env.PUBLIC_PLAUSIBLE_DOMAIN,
		clientAddress: getClientAddress(),
	});
};
