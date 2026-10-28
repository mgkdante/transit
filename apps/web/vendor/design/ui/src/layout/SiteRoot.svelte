<!--
  The app root: adopts the pre-paint theme, restores quiet mode, keeps <html lang> on the page's
  language and owns the Lenis lifecycle. Renders no element of its own.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	/** Selectors for an element scroller, resolved on mount. Omit to scroll the window. */
	export interface SiteRootScroller {
		readonly wrapper: string;
		readonly content: string;
	}

	export interface SiteRootProps {
		children: Snippet;
		smoothScroll?: boolean;
		scroller?: SiteRootScroller;
		/** The page's language. The server fills `<html lang>`; this keeps it current after client navigation. */
		lang?: string;
		/** @deprecated since v0.22.0 (removal no earlier than v0.24.0). Use the standard `quiet-mode` key. */
		quietModeKey?: string;
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { destroyLenis, initLenis } from '@yesid/motion/utils/lenis';
	import { quietMode } from '../state/quiet-mode.svelte.js';
	import { theme } from '../state/theme.svelte.js';

	let { children, smoothScroll = true, scroller, lang, quietModeKey }: SiteRootProps = $props();

	// Before the children render, so sections hydrate in the quiet mode the boot script painted.
	quietMode.init({ storageKey: untrack(() => quietModeKey) });

	$effect(() => {
		if (lang) document.documentElement.lang = lang;
	});

	function resolveScroller(): { wrapper: HTMLElement; content: HTMLElement } | undefined {
		if (!scroller) return undefined;
		const wrapper = document.querySelector<HTMLElement>(scroller.wrapper);
		const content = document.querySelector<HTMLElement>(scroller.content);
		if (!wrapper || !content) throw new Error(`SiteRoot scroller not found: ${scroller.wrapper} / ${scroller.content}`);
		return { wrapper, content };
	}

	onMount(() => {
		theme.init();
		if (!smoothScroll) return;
		initLenis(resolveScroller());
		return destroyLenis;
	});
</script>

{@render children()}
