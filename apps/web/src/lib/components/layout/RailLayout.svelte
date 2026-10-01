<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface RailLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		rail?: Snippet;
		content?: Snippet;
		railLabel?: string;
		class?: string;
	}

	let { rail, content, railLabel, class: className, ...restProps }: RailLayoutProps = $props();
</script>

<div class={cn('rail-layout', className)} data-slot="rail-layout" {...restProps}>
	<aside class="rail-layout__rail" data-slot="rail-layout-rail" aria-label={railLabel}>
		<div class="rail-layout__rail-sticky">
			{@render rail?.()}
		</div>
	</aside>

	<div class="rail-layout__content" data-slot="rail-layout-content">
		{@render content?.()}
	</div>
</div>

<style>
	.rail-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		min-width: 0;
		overflow-x: clip;
	}

	.rail-layout__rail,
	.rail-layout__content {
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.rail-layout {
			grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}

		.rail-layout__rail {
			grid-column: 1;
		}

		.rail-layout__content {
			grid-column: 2;
		}

		.rail-layout__rail-sticky {
			position: sticky;
			top: var(--chrome-offset);
		}
	}
</style>
