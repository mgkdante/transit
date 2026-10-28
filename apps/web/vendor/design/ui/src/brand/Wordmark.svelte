<!--
  The brand wordmark: a name and an accent dot. Hover runs the `wordmarkHover` letter effects;
  `autoPlay` plays one on mount.
-->
<script lang="ts" module>
	import type { HTMLAnchorAttributes } from 'svelte/elements';

	export interface WordmarkProps extends Omit<HTMLAnchorAttributes, 'children'> {
		href: string;
		text?: string;
		/** Opens in a new tab with `rel="noopener noreferrer"`. */
		external?: boolean;
		/** `false` drops the hover effects. */
		animate?: boolean;
		autoPlay?: boolean;
	}
</script>

<script lang="ts">
	import { wordmarkHover } from '@yesid/motion/actions';
	import { cn } from '../cn/index.js';

	let {
		href,
		text = 'yesid',
		external = false,
		animate = true,
		autoPlay = false,
		class: className,
		...rest
	}: WordmarkProps = $props();

	function hover(node: HTMLAnchorElement) {
		if (!animate) return;
		return wordmarkHover(node.querySelector<HTMLElement>('[data-slot="wordmark-letters"]')!, {
			dotEl: node.querySelector<HTMLElement>('[data-slot="wordmark-dot"]')!,
			autoPlay,
		});
	}
</script>

<a
	{href}
	target={external ? '_blank' : undefined}
	rel={external ? 'noopener noreferrer' : undefined}
	class={cn('wordmark inline-flex items-center font-heading font-bold text-foreground', className)}
	data-slot="wordmark"
	use:hover
	{...rest}
>
	<span data-slot="wordmark-letters">{text}</span><span data-slot="wordmark-dot" class="text-primary">.</span>
</a>

<style>
	.wordmark {
		white-space: nowrap;
		flex-shrink: 0;
		border-radius: var(--radius-sm);
	}
	.wordmark:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
