<!--
  SurfaceNavList — the shared SURFACE_NAV link list for the chrome.

  Maps the single `SURFACE_NAV` manifest to localized, active-aware link rows so
  the TopBar mobile menu (and any future compact nav) renders one consistent list
  instead of hand-rolling its own `{#each SURFACE_NAV}`. Each row shows the
  primary label + the secondary description; the active surface is marked with
  `aria-current="page"`.

  Pure presentation: routing + active detection come from the shared
  `$lib/content/nav` manifest (delocalize the path before passing `currentPath`).
  The wrapping landmark (`<nav>` / aria-label) belongs to the caller.
-->
<script lang="ts">
	import { type Locale, localizeHref } from '$lib/i18n';
	import { SURFACE_NAV, isSurfaceActive } from '$lib/content/nav';

	interface SurfaceNavListProps {
		/** Active UI locale. */
		locale: Locale;
		/** DELOCALIZED current path (e.g. `/route/1`) for active detection. */
		currentPath: string;
		/** Class applied to each rendered link row. */
		linkClass: string;
	}

	let { locale, currentPath, linkClass }: SurfaceNavListProps = $props();

	const items = $derived(
		SURFACE_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale),
			label: item.label[locale],
			description: item.description[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);
</script>

{#each items as item (item.key)}
	<a href={item.href} class={linkClass} aria-current={item.active ? 'page' : undefined}>
		<span>{item.label}</span>
		<small>{item.description}</small>
	</a>
{/each}
