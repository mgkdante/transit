import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_PLAUSIBLE_DOMAIN: { public: true, schema: (input) => input ?? '' },
	PUBLIC_CF_BEACON_TOKEN: { public: true, schema: (input) => input ?? '' },
	PUBLIC_VITALS_ENABLED: { public: true, schema: (input) => input ?? '' },
	PUBLIC_V1_BASE: { public: true, schema: (input) => input ?? '' },
	PUBLIC_V1_PROVIDER: { public: true, schema: (input) => input ?? '' },
	PUBLIC_SITE_ORIGIN: { public: true, schema: (input) => input ?? '' },
	PUBLIC_INDEXING: { public: true, schema: (input) => input ?? '' },
	PUBLIC_PROVIDER_SHORT_NAME: { public: true, schema: (input) => input ?? '' },
	PUBLIC_PROVIDER_CITY: { public: true, schema: (input) => input ?? '' },
	PUBLIC_TWITTER_SITE: { public: true, schema: (input) => input ?? '' },
	PUBLIC_TWITTER_CREATOR: { public: true, schema: (input) => input ?? '' },
	PUBLIC_SITE_AUTHOR: { public: true, schema: (input) => input ?? '' },
});
