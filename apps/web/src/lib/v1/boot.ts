import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import type { Locale } from '$lib/i18n';
import { DEFAULT_LOCALE } from '$lib/i18n';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { Manifest } from '$lib/v1/schemas/manifest';
import { getLabels } from '$lib/v1/repositories/labels';
import { getManifest } from '$lib/v1/repositories/manifest';
import { installBrowserAdapterManifest } from '$lib/v1/adapter/browserManifest';

export interface V1Context {
	readonly manifest: Manifest;
	readonly labels: Record<string, string>;
	readonly lang: Locale;
}

const RESOLVABLE_NAMESPACES = [
	'metric.',
	'status.',
	'severity.',
	'occupancy.',
	'methodology.',
] as const;

const KEY = Symbol.for('transit.v1.context');

export async function loadManifest(ctx?: AdapterCtx): Promise<Manifest> {
	return getManifest(ctx);
}

export async function bootV1(lang: Locale = DEFAULT_LOCALE, ctx?: AdapterCtx): Promise<V1Context> {
	const manifest = await loadManifest(ctx);
	const langLabels = await getLabels(lang, { ...ctx, manifest }).catch(
		() => ({}) as Record<string, string>,
	);
	const labels: Record<string, string> = langLabels;
	return { manifest, labels, lang };
}

export function resolveLabel(code: string, labels: Record<string, string>): string {
	if (!code) return code;
	const resolvable = RESOLVABLE_NAMESPACES.some((ns) => code.startsWith(ns));
	if (!resolvable) return code;
	const text = labels[code];
	return text !== undefined && text !== '' ? text : code;
}

export function setV1Context(reader: () => V1Context | undefined): void {
	setContext(KEY, reader);
	if (browser) installBrowserAdapterManifest(() => reader()?.manifest);
}

export function getV1Context(): V1Context {
	const reader = getContext<(() => V1Context | undefined) | undefined>(KEY);
	const context = reader?.();
	if (!context) {
		throw new Error(
			'[v1] getV1Context() called before setV1Context(), boot the v1 context in the root layout first.',
		);
	}
	return context;
}
