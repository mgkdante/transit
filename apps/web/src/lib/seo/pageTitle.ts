import { getContext, onMount, setContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';

type Title = () => string | null;
const key = Symbol('transit.page-title');

export function setPageTitleContext() {
	return setContext(key, writable<Title | null>(null));
}

export function usePageTitle(title: Title): void {
	const context = getContext<Writable<Title | null> | undefined>(key);
	onMount(() => {
		context?.set(title);
		return () => context?.update((current) => (current === title ? null : current));
	});
}

export function resolvePageTitle(
	error: string | null | undefined,
	client: string | null | undefined,
	server: string | null | undefined,
	path: string,
): string {
	return [error, client, server].find((title) => title?.trim()) ?? path;
}
