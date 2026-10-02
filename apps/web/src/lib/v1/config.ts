import { env } from '$env/dynamic/public';
import { DEFAULT_SITE_ORIGIN } from '$lib/site/config';

const DEFAULT_BASE = '/data/v1';

const DEFAULT_PROVIDER = 'stm';
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:\/\//i;

export function v1BaseUrl(): string {
	return normalizeV1BaseUrl(env.PUBLIC_V1_BASE);
}

export function v1Provider(): string {
	const raw = (env.PUBLIC_V1_PROVIDER ?? DEFAULT_PROVIDER).trim();
	return trimSlashes(raw || DEFAULT_PROVIDER);
}

export function resolveUrl(relativePath: string): string {
	const raw = relativePath.trim();
	if (ABSOLUTE_URL.test(raw)) return normalizeSnapshotPointer(raw);
	const rel = trimLeadingSlash(raw);
	return `${v1BaseUrl()}/${v1Provider()}/${rel}`;
}

export function normalizeSnapshotPointer(value: string): string {
	const raw = value.trim();
	if (!ABSOLUTE_URL.test(raw)) return raw;

	let pointer: URL;
	try {
		pointer = new URL(raw);
	} catch {
		return raw;
	}

	const provider = v1Provider();
	const canonicalRoot = `/data/v1/${provider}`;
	if (
		pointer.origin !== DEFAULT_SITE_ORIGIN ||
		(pointer.pathname !== canonicalRoot && !pointer.pathname.startsWith(`${canonicalRoot}/`))
	) {
		return raw;
	}

	const suffix = pointer.pathname.slice(canonicalRoot.length);
	return `${v1BaseUrl()}/${provider}${suffix}${pointer.search}${pointer.hash}`;
}

export function entityUrl(
	tier: 'live' | 'static' | 'historic',
	prefixKey: string,
	id: string,
): string {
	void tier;
	const prefix = ensureTrailingSlash(trimLeadingSlash(prefixKey.trim()));
	const leaf = encodeURIComponent(id).endsWith('.json')
		? encodeURIComponent(id)
		: `${encodeURIComponent(id)}.json`;
	return resolveUrl(`${prefix}${leaf}`);
}

function stripTrailingSlash(s: string): string {
	return s.endsWith('/') ? s.slice(0, -1) : s;
}

export function normalizeV1BaseUrl(value: string | null | undefined): string {
	const raw = (value ?? DEFAULT_BASE).trim() || DEFAULT_BASE;
	const withoutTrailingSlash = stripTrailingSlash(raw);
	if (ABSOLUTE_URL.test(withoutTrailingSlash)) return withoutTrailingSlash;
	if (withoutTrailingSlash.startsWith('/')) return withoutTrailingSlash;
	return `/${withoutTrailingSlash}`;
}

function trimLeadingSlash(s: string): string {
	return s.startsWith('/') ? s.replace(/^\/+/, '') : s;
}

function trimSlashes(s: string): string {
	return s.replace(/^\/+/, '').replace(/\/+$/, '');
}

function ensureTrailingSlash(s: string): string {
	if (s === '') return s;
	return s.endsWith('/') ? s : `${s}/`;
}
