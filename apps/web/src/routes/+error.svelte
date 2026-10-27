<script lang="ts">
	import { page } from '$app/stores';
	import { ErrorPage } from '@yesid/ui/layout';
	import { getLocalizeHref, pathLocale, type Locale } from '$lib/i18n';
	import { errorDocumentHead, errorPageCopy } from '$lib/site/errorPage';

	const localizeHref = getLocalizeHref();

	const locale = $derived<Locale>(pathLocale($page.url?.pathname ?? '/'));
	const status = $derived($page.status);
	const is404 = $derived(status === 404);

	const copy = $derived(errorPageCopy[locale]);
	const view = $derived(
		is404
			? {
					label: copy.notFound.label,
					heading: copy.notFound.heading,
					body: copy.notFound.description,
					statusNote: copy.notFound.statusNote,
					signLabel: 'STATION',
					suggestions: copy.notFound.suggestions.map((suggestion) => ({
						...suggestion,
						href: localizeHref(suggestion.href, locale),
					})),
				}
			: {
					label: copy.generic.label,
					heading: copy.generic.heading,
					body: copy.generic.body,
					detail: $page.error?.message,
					suggestions: [{ href: localizeHref('/', locale), label: copy.generic.home }],
				},
	);
	const documentHead = $derived(errorDocumentHead(status, locale));
</script>

<svelte:head>
	<title>{documentHead.title} · Transit</title>
	{#if is404}
		<meta name="robots" content="noindex,nofollow" />
	{/if}
</svelte:head>

<ErrorPage {status} suggestionsLabel={copy.suggestionsLabel} {...view} />
