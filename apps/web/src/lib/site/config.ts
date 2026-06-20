import { env } from '$env/dynamic/public';

export const DEFAULT_SITE_ORIGIN = 'https://transit.yesid.dev';

export interface PublicSiteConfig {
	readonly siteOrigin: string;
	readonly indexing: boolean;
	/**
	 * Provider copy identity for SSR (the manifest is client-booted on Cloudflare,
	 * so it is absent at SSR — these env values keep the crawler-visible <title>/
	 * description provider-specific). Each deploy sets its own; undefined falls back
	 * to generic, provider-neutral copy. Mirror of manifest.short_name / .city.
	 */
	readonly providerShortName?: string;
	readonly providerCity?: string;
}

/** Trim a public env string to a value, or undefined when empty/unset. */
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
	};
}
