<script lang="ts">
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import { searchExampleQueries } from '#lib/features/search/search.copy.ts';
	import { homeSearchCopy } from './homePulse.copy';

	interface Props {
		readonly locale: Locale;
		/** Kept on the search page so a lookup never switches cities. */
		readonly provider: string | undefined;
	}

	let { locale, provider }: Props = $props();
	const localizeHref = getLocalizeHref();
	const t = $derived(homeSearchCopy[locale]);
	const action = $derived(localizeHref(routeFor({ kind: 'search' }), locale).split('?')[0]);
	// Generic fallbacks ("Line number") are hints, not queries, so only real examples become chips.
	const examples = $derived(searchExampleQueries(provider, locale) ?? []);
	function exampleHref(query: string): string {
		const fields = provider ? { q: query, provider } : { q: query };
		return `${action}?${new URLSearchParams(fields).toString()}`;
	}
</script>

<form class="home-search" data-slot="home-search" role="search" method="get" {action}>
	<label for="home-search-q">{t.label}</label>
	<div class="home-search-row">
		<input
			id="home-search-q"
			name="q"
			type="search"
			autocomplete="off"
			aria-describedby={examples.length ? 'home-search-hint' : undefined}
		/>
		{#if provider}<input type="hidden" name="provider" value={provider} />{/if}
		<button type="submit">{t.submit}</button>
	</div>
	{#if examples.length}
		<p id="home-search-hint">
			<span>{t.examplesLead}</span>
			{#each examples as example (example)}<a href={exampleHref(example)}>{example}</a>{/each}
		</p>
	{/if}
</form>

<style>
	.home-search {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: var(--measure-body);
	}
	.home-search label {
		font-family: var(--font-heading);
		font-weight: 800;
	}
	.home-search-row {
		display: flex;
		gap: 0.5rem;
	}
	.home-search input {
		flex: 1;
		min-width: 0;
		min-height: 48px;
		padding: 0 1rem;
		font: inherit;
		color: var(--foreground);
		background: var(--card);
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-sm);
	}
	.home-search input:focus-visible,
	.home-search button:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
	.home-search button {
		flex: none;
		min-height: 48px;
		padding: 0 1.25rem;
		font-family: var(--font-heading);
		font-weight: 800;
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.home-search p {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		margin: 0;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.home-search p a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.75rem;
		color: var(--foreground);
		text-decoration: none;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
	}
	.home-search p a:hover {
		color: var(--accent-text);
		border-color: var(--accent-text);
	}
	.home-search p a:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
</style>
