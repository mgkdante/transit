import type { Manifest } from '$lib/v1/schemas/manifest';

let manifestReader: (() => Manifest | null | undefined) | null = null;

/** Install the reactive manifest already accepted by the root browser context. */
export function installBrowserAdapterManifest(reader: () => Manifest | null | undefined): void {
	manifestReader = reader;
}

/** Return the current boot manifest, or null before browser context installation. */
export function browserAdapterManifest(): Manifest | null {
	return manifestReader?.() ?? null;
}

export function clearBrowserAdapterManifestForTests(): void {
	manifestReader = null;
}
