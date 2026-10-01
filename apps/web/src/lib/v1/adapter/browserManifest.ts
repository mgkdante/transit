import type { Manifest } from '$lib/v1/schemas/manifest';

let manifestReader: (() => Manifest | null | undefined) | null = null;

export function installBrowserAdapterManifest(reader: () => Manifest | null | undefined): void {
	manifestReader = reader;
}

export function browserAdapterManifest(): Manifest | null {
	return manifestReader?.() ?? null;
}

export function clearBrowserAdapterManifestForTests(): void {
	manifestReader = null;
}
