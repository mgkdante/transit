import { getContext, setContext } from 'svelte';

// One locale context per app, under a well-known key so a component test can provide a locale:
// `render(Component, { context: new Map([[Symbol.for('@yesid/ui/locale'), () => 'fr']]) })`.
const KEY = Symbol.for('@yesid/ui/locale');

export interface LocaleContext<Locale extends string> {
	/** Call once from the root layout; `read` closes over reactive data, so readers stay current. */
	provide(read: () => Locale): void;
	/** The provided locale, or the fallback where nothing provides one, such as a unit test. */
	get(): Locale;
}

export function createLocaleContext<Locale extends string>(fallback: Locale): LocaleContext<Locale> {
	return {
		provide: (read) => void setContext(KEY, read),
		get: () => getContext<(() => Locale) | undefined>(KEY)?.() ?? fallback,
	};
}
