// v1 boot, load the snapshot root once, hand surfaces a ready V1Context.
//
// Boot order (fail-soft on the label leg):
//   1. loadManifest()     , fetch the snapshot manifest (the file pointers +
//                            base FR label table + dataset version).
//   2. labels/{lang}.json , fetch the per-language label refinement and merge
//                            it ON TOP of the manifest's base table.
//   3. ready              , return { manifest, labels, lang } as the V1Context.
//
// The context is provided once (root layout) and read everywhere via
// getV1Context(); resolveLabel(code, labels) turns a namespaced code into human
// text, falling back to the raw code.

import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import type { Locale } from '$lib/i18n';
import { DEFAULT_LOCALE } from '$lib/i18n';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { Manifest } from '$lib/v1/schemas';
import { getLabels, getManifest } from '$lib/v1/repositories';
import { installBrowserAdapterManifest } from '$lib/v1/adapter/browserManifest';

/**
 * The resolved snapshot context every surface reads. Built once at boot and
 * shared via Svelte context; never re-fetched per render.
 */
export interface V1Context {
	/** The snapshot manifest (file pointers, dataset version, freshness anchors). */
	readonly manifest: Manifest;
	/** Merged code -> text dictionary for `lang` (manifest base + labels/{lang}). */
	readonly labels: Record<string, string>;
	/** The active UI language this context was built for. */
	readonly lang: Locale;
}

/** Label namespaces resolveLabel() is allowed to translate. */
const RESOLVABLE_NAMESPACES = [
	'metric.',
	'status.',
	'severity.',
	'occupancy.',
	'methodology.',
] as const;

const KEY = Symbol.for('transit.v1.context');

/** Fetch the snapshot manifest (boot step 1). */
export async function loadManifest(ctx?: AdapterCtx): Promise<Manifest> {
	return getManifest(ctx);
}

/**
 * Build the ready V1Context for a language.
 *
 * Fetches the manifest then the per-language labels file, merging the language
 * refinement over the manifest's base `labels` table. The labels leg is
 * fail-soft: a missing/never-published labels file degrades to the manifest
 * base (and ultimately to raw-code fallback in resolveLabel), never an error.
 *
 * `ctx` carries the SSR `fetch` (event.fetch). It MUST be passed from a
 * SvelteKit `load` under SSR, the snapshot base is a same-origin relative path
 * and the Worker's global `fetch` rejects relative URLs, so an unthreaded boot
 * fails the manifest leg and degrades the whole app to the v1-error edge state.
 */
export async function bootV1(lang: Locale = DEFAULT_LOCALE, ctx?: AdapterCtx): Promise<V1Context> {
	const manifest = await loadManifest(ctx);
	// Labels are an enhancement, not a hard dependency, a missing/never-published
	// labels file degrades to the manifest base (resolveLabel then falls back to
	// raw codes), never an error.
	const langLabels = await getLabels(lang, { ...ctx, manifest }).catch(
		() => ({}) as Record<string, string>,
	);
	const labels: Record<string, string> = { ...manifest.labels, ...langLabels };
	return { manifest, labels, lang };
}

/**
 * Resolve a namespaced label code to human text.
 *
 * Only codes in an allowed namespace (metric./status./severity./occupancy./
 * methodology.) are looked up; anything else (e.g. a raw id, or alert
 * `header_key`/`header_text` FR text) is returned verbatim. Unknown codes in a
 * valid namespace fall back to the code itself, never empty, never a throw.
 */
export function resolveLabel(code: string, labels: Record<string, string>): string {
	if (!code) return code;
	const resolvable = RESOLVABLE_NAMESPACES.some((ns) => code.startsWith(ns));
	if (!resolvable) return code;
	const text = labels[code];
	return text !== undefined && text !== '' ? text : code;
}

/**
 * Provide the V1Context to descendants. Call once from the root layout.
 * Takes a READER (getter), symmetric with setLocaleContext, so the context
 * stays reactive across EN/FR swaps and re-boots without the root remounting,
 * and callers never capture a stale initial value.
 */
export function setV1Context(reader: () => V1Context | undefined): void {
	setContext(KEY, reader);
	if (browser) installBrowserAdapterManifest(() => reader()?.manifest);
}

/**
 * Read the active V1Context. Throws if called without a provider, boot must run
 * before any surface mounts, so a missing context is a wiring bug, not a state.
 */
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
