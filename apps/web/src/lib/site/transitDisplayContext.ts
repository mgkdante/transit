import { getContext, setContext } from 'svelte';
import { getLocale } from '#lib/i18n/index.ts';
import { routeNameFallback } from './absence';
import { createLineDirectory, type LineDirectory } from './lineDirectory';

const KEY = Symbol.for('transit.line-directory');
export function setLineDirectory(reader: () => LineDirectory): void {
	setContext(KEY, reader);
}

/** Optional so reusable detail rows can also render outside a booted page. */
export function transitDisplay() {
	const locale = getLocale();
	const reader = getContext<(() => LineDirectory) | undefined>(KEY);
	const fallback = createLineDirectory(null, { line: (id) => routeNameFallback(id, locale) });
	const directory = () => reader?.() ?? fallback;
	return {
		get directory() {
			return directory();
		},
		line: (id: string) => directory().number(id),
		lineName: (id: string, name?: string | null) => directory().name(id, name),
	};
}
