<!--
  The app root: adopts the pre-paint theme, restores quiet mode and owns the Lenis lifecycle.
  Renders no element of its own.
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
		quietModeKey?: string;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { destroyLenis, initLenis } from '@yesid/motion/utils/lenis';
	import { quietMode } from '../state/quiet-mode.svelte.js';
	import { theme } from '../state/theme.svelte.js';

	let { children, smoothScroll = true, scroller, quietModeKey }: SiteRootProps = $props();

	function resolveScroller(): { wrapper: HTMLElement; content: HTMLElement } | undefined {
		if (!scroller) return undefined;
		const wrapper = document.querySelector<HTMLElement>(scroller.wrapper);
		const content = document.querySelector<HTMLElement>(scroller.content);
		if (!wrapper || !content) throw new Error(`SiteRoot scroller not found: ${scroller.wrapper} / ${scroller.content}`);
		return { wrapper, content };
	}

	onMount(() => {
		theme.init();
		quietMode.init({ storageKey: quietModeKey });
		if (!smoothScroll) return;
		initLenis(resolveScroller());
		return destroyLenis;
	});
</script>

{@render children()}
