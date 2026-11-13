<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import { homeSearchCopy } from './homePulse.copy';

	interface Props {
		readonly locale: Locale;
	}

	let { locale }: Props = $props();
	const localizeHref = getLocalizeHref();
	const t = $derived(homeSearchCopy[locale]);
</script>

<!-- The search itself lives in the header and on the search page; the home page only leads there. -->
<p class="home-search" data-slot="home-search">
	<a href={localizeHref(routeFor({ kind: 'search' }), locale)}>
		<SearchIcon class="home-search-icon" size={18} strokeWidth={1.8} aria-hidden="true" />
		<span class="home-search-label">{t.label}</span>
		<span class="home-search-arrow" aria-hidden="true">→</span>
	</a>
</p>

<style>
	.home-search {
		display: flex;
		margin: 0;
	}
	.home-search a {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 48px;
		padding: 0.625rem 1rem;
		color: var(--foreground);
		text-decoration: none;
		background: var(--card);
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-sm);
	}
	.home-search a:hover {
		color: var(--accent-text);
		border-color: var(--accent-text);
	}
	.home-search a:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
	.home-search a :global(.home-search-icon) {
		flex: none;
		color: var(--accent-text);
	}
	.home-search-label {
		flex: 1;
		min-width: 0;
		font-family: var(--font-heading);
		font-weight: 800;
	}
	.home-search-arrow {
		flex: none;
		color: var(--accent-text);
		font-family: var(--font-mono);
	}
	/* A button, not a field: from tablet width up it is as wide as its label. */
	@media (min-width: 640px) {
		.home-search a {
			width: auto;
		}
	}
</style>
