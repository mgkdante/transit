<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { ArticleHeader } from '@yesid/ui/layout';
	import { readableName } from '#lib/components/surface/readableName.ts';
	let props: ComponentProps<typeof ArticleHeader> = $props();
	const meta = $derived(
		props.meta?.filter((entry) => (typeof entry === 'string' ? entry : entry.text).trim()),
	);
	function headline(node: HTMLElement, title: string) {
		// The aria-hidden watermark intentionally bleeds past its drawing frame.
		node
			.querySelector('.header__decoration-layer[aria-hidden="true"]')
			?.setAttribute('data-allow-clip', '');
		const heading = node.querySelector('h1');
		if (!heading) return;
		heading.classList.add('readable-name');
		heading.title = title;
		const action = readableName(heading);
		return {
			update(nextTitle: string) {
				heading.title = nextTitle;
				delete heading.dataset.expanded;
			},
			destroy: action.destroy,
		};
	}
</script>

<div class="transit-article-header" use:headline={props.title}>
	<ArticleHeader {...props} {meta} />
</div>
