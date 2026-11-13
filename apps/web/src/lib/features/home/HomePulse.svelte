<script lang="ts">
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import type { Manifest } from '#lib/v1/schemas/index.ts';
	import HomePulseLive from './HomePulseLive.svelte';
	import { homePulseCopy } from './homePulse.copy';

	interface Props {
		readonly locale: Locale;
		readonly city: string;
		/** Absent before the data context boots; the shortcuts still render. */
		readonly manifest: Manifest | null;
	}

	let { locale, city, manifest }: Props = $props();
	const localizeHref = getLocalizeHref();
	const t = $derived(homePulseCopy[locale]);
	const shortcuts = $derived([
		{ href: routeFor({ kind: 'map' }), title: t.openMap, note: t.openMapNote },
		{ href: routeFor({ kind: 'network-health' }), title: t.openNetwork, note: t.openNetworkNote },
	]);
</script>

<section class="home-pulse" data-slot="home-pulse" aria-labelledby="home-pulse-title">
	<div class="pulse-head">
		<h2 id="home-pulse-title">{t.title.replace('{city}', city)}</h2>
		<ul class="pulse-shortcuts" data-slot="home-pulse-shortcuts">
			{#each shortcuts as shortcut (shortcut.href)}
				<li>
					<a href={localizeHref(shortcut.href, locale)}>
						<span class="pulse-shortcut-title">{shortcut.title}</span>
						<span class="pulse-shortcut-note">{shortcut.note}</span>
						<span class="pulse-shortcut-arrow" aria-hidden="true">↗</span>
					</a>
				</li>
			{/each}
		</ul>
	</div>
	{#if manifest}
		<div class="pulse-body">
			<HomePulseLive {locale} {manifest} copy={t} />
		</div>
	{/if}
</section>

<style>
	.home-pulse {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: clamp(1rem, 2.5vw, 1.75rem);
		background: color-mix(in srgb, var(--card) 60%, transparent);
		border: 1px solid var(--border-brand);
	}
	.pulse-head {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.pulse-head h2 {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	.pulse-shortcuts {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pulse-shortcuts li {
		display: flex;
		min-width: 0;
	}
	.pulse-shortcuts a {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: 100%;
		min-height: 44px;
		padding: 0.625rem 2rem 0.625rem 0.875rem;
		color: var(--foreground);
		text-decoration: none;
		background: var(--card);
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-sm);
	}
	.pulse-shortcuts a:hover {
		color: var(--accent-text);
		border-color: var(--accent-text);
	}
	.pulse-shortcuts a:focus-visible {
		outline: 2px solid var(--accent-text);
		outline-offset: 2px;
	}
	.pulse-shortcut-title {
		font-family: var(--font-heading);
		font-weight: 800;
	}
	.pulse-shortcut-note {
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.pulse-shortcut-arrow {
		position: absolute;
		top: 0.625rem;
		right: 0.75rem;
		color: var(--accent-text);
		font-family: var(--font-mono);
	}
	.pulse-body {
		display: grid;
		gap: 1.5rem;
	}
	@media (max-width: 479px) {
		.pulse-shortcut-note {
			display: none;
		}
	}
	@media (--desktop-min) {
		.pulse-head {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 2rem;
		}
		.pulse-shortcuts {
			flex: none;
			width: min(36rem, 55%);
		}
		.pulse-body {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
			gap: 2.5rem;
			align-items: start;
		}
	}
</style>
