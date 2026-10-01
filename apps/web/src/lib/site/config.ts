import { env } from '$env/dynamic/public';

export const DEFAULT_SITE_ORIGIN = 'https://transit.yesid.dev';

export interface PublicSiteConfig {
	readonly siteOrigin: string;
	readonly indexing: boolean;
	readonly providerShortName?: string;
	readonly providerCity?: string;
	readonly twitterSite?: string;
	readonly twitterCreator?: string;
	readonly author?: string;
}

export function normalizeTwitterHandle(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const handle = trimmed
		.replace(/^https?:\/\/(?:www\.)?(?:twitter|x)\.com\//i, '')
		.replace(/^@+/, '')
		.replace(/\/+$/, '')
		.trim();
	return handle ? `@${handle}` : undefined;
}

export function normalizeOptionalText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeSiteOrigin(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) return DEFAULT_SITE_ORIGIN;

	const parsed = new URL(trimmed);
	return parsed.origin;
}

export function parsePublicBoolean(value: string | undefined, defaultValue: boolean): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return defaultValue;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return defaultValue;
}

export function readPublicSiteConfig(): PublicSiteConfig {
	return {
		siteOrigin: normalizeSiteOrigin(env.PUBLIC_SITE_ORIGIN),
		indexing: parsePublicBoolean(env.PUBLIC_INDEXING, true),
		providerShortName: normalizeOptionalText(env.PUBLIC_PROVIDER_SHORT_NAME),
		providerCity: normalizeOptionalText(env.PUBLIC_PROVIDER_CITY),
		twitterSite: normalizeTwitterHandle(env.PUBLIC_TWITTER_SITE),
		twitterCreator: normalizeTwitterHandle(env.PUBLIC_TWITTER_CREATOR),
		author: normalizeOptionalText(env.PUBLIC_SITE_AUTHOR),
	};
}
