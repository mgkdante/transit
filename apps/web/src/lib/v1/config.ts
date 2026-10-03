import { env } from '$env/dynamic/public';
import { DEFAULT_SITE_ORIGIN } from '$lib/site/config';

const DEFAULT_BASE = '/data/v1';

const DEFAULT_PROVIDER = 'stm';
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:\/\//i;

export function v1BaseUrl(): string {
	return normalizeV1BaseUrl(env.PUBLIC_V1_BASE);
}

export function v1Provider(url?: URL): string {
	const raw = url?.searchParams.get('provider') ?? env.PUBLIC_V1_PROVIDER ?? DEFAULT_PROVIDER;
	return /^[a-z0-9][a-z0-9_-]*$/.test(raw) ? raw : DEFAULT_PROVIDER;
}

export function resolveUrl(relativePath: string, provider = v1Provider()): string {
	return normalizeSnapshotPointer(relativePath, provider);
}

export function normalizeSnapshotPointer(value: string, provider = v1Provider()): string {
	if (
		!/^[a-z0-9][a-z0-9_-]*$/.test(provider) ||
		value.startsWith('//') ||
		value.includes('\\') ||
		[...value].some((char) => char.charCodeAt(0) <= 32)
	) {
		throw new Error('Invalid snapshot pointer');
	}
	const base = new URL(`${v1BaseUrl()}/${provider}/`, DEFAULT_SITE_ORIGIN);
	const pointer = new URL(value, value.startsWith('/data/v1/') ? DEFAULT_SITE_ORIGIN : base);
	const root = [base, new URL(`/data/v1/${provider}/`, DEFAULT_SITE_ORIGIN)].find(
		(candidate) =>
			pointer.origin === candidate.origin && pointer.pathname.startsWith(candidate.pathname),
	);
	if (
		!root ||
		pointer.username ||
		pointer.password ||
		/\\/.test(decodeURIComponent(pointer.pathname))
	) {
		throw new Error('Snapshot pointer is outside the selected provider');
	}
	return `${v1BaseUrl()}/${provider}/${pointer.pathname.slice(root.pathname.length)}${pointer.search}${pointer.hash}`;
}

export function entityUrl(
	tier: 'live' | 'static' | 'historic',
	prefixKey: string,
	id: string,
	provider = v1Provider(),
): string {
	void tier;
	const prefix = ensureTrailingSlash(trimLeadingSlash(prefixKey.trim()));
	const leaf = encodeURIComponent(id).endsWith('.json')
		? encodeURIComponent(id)
		: `${encodeURIComponent(id)}.json`;
	return resolveUrl(`${prefix}${leaf}`, provider);
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

function ensureTrailingSlash(s: string): string {
	if (s === '') return s;
	return s.endsWith('/') ? s : `${s}/`;
}
