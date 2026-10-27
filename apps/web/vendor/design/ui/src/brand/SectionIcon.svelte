<script lang="ts">
	export type SectionIconName =
		| 'toc'
		| 'image'
		| 'eye'
		| 'layers'
		| 'chart'
		| 'grid'
		| 'list'
		| 'arrow'
		| 'briefcase'
		| 'github';

	let {
		name,
		class: className = 'h-4 w-4 shrink-0 text-primary',
	}: { name: SectionIconName; class?: string } = $props();
</script>

{#if name === 'toc'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		aria-hidden="true"
		data-testid="section-toc-icon"
	>
		<path d="M6 5h10" />
		<path d="M6 10h10" />
		<path d="M6 15h10" />
		<circle cx="3.5" cy="5" r="1" fill="currentColor" stroke="none" />
		<circle cx="3.5" cy="10" r="1" fill="currentColor" stroke="none" />
		<circle cx="3.5" cy="15" r="1" fill="currentColor" stroke="none" />
	</svg>
{:else if name === 'image'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
		aria-hidden="true"
		data-testid="section-image-icon"
	>
		<rect x="3" y="4" width="14" height="12" rx="2" />
		<circle cx="7.5" cy="8" r="1.3" />
		<path d="M5 14l3.2-3.2a1 1 0 011.4 0L12 13.2l1.2-1.2a1 1 0 011.4 0L16 13.4" />
	</svg>
{:else if name === 'eye'}
	<svg
		class={className}
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		aria-hidden="true"
		data-testid="section-eye-icon"
	>
		<circle cx="8" cy="8" r="2.5" />
		<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
	</svg>
{:else if name === 'layers'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linejoin="round"
		aria-hidden="true"
		data-testid="section-layers-icon"
	>
		<path d="M10 2.5l7.5 3.75L10 10 2.5 6.25 10 2.5z" />
		<path d="M2.5 10L10 13.75 17.5 10" />
		<path d="M2.5 13.75L10 17.5l7.5-3.75" />
	</svg>
{:else if name === 'chart'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
		data-testid="section-chart-icon"
	>
		<path d="M3 11h3v6H3v-6zm5.5-5h3v11h-3V6zM14 8h3v9h-3V8z" />
	</svg>
{:else if name === 'grid'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
		data-testid="section-grid-icon"
	>
		<path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 0h6v6h-6v-6z" />
	</svg>
{:else if name === 'list'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
		data-testid="section-list-icon"
	>
		<path
			d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z"
		/>
	</svg>
{:else if name === 'arrow'}
	<svg
		class={className}
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		aria-hidden="true"
		data-testid="section-arrow-icon"
	>
		<path d="M6 3h7v7M13 3L3 13" />
	</svg>
{:else if name === 'briefcase'}
	<svg
		class={className}
		viewBox="0 0 20 20"
		fill="currentColor"
		aria-hidden="true"
		data-testid="section-briefcase-icon"
	>
		<path
			d="M7 4a2 2 0 012-2h2a2 2 0 012 2v1h3a2 2 0 012 2v3H1V7a2 2 0 012-2h3V4zm2 1h2V4H9v1zM1 11h18v4a2 2 0 01-2 2H3a2 2 0 01-2-2v-4z"
		/>
	</svg>
{:else if name === 'github'}
	<svg
		class={className}
		viewBox="0 0 16 16"
		fill="currentColor"
		aria-hidden="true"
		data-testid="section-github-icon"
	>
		<path
			d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
		/>
	</svg>
{/if}
