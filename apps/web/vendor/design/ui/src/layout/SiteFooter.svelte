<!--
  Site footer: hazard strip, a brand block with tagline, one labelled navigation per link group,
  and a status row with a live lamp and today's date. `data-in-view` reports whether the footer
  is on screen, for chrome that should step aside.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface SiteFooterLink {
		href: string;
		label: string;
		ariaLabel?: string;
		/** Opens in a new tab with `rel="noopener noreferrer"`. */
		external?: boolean;
		/** Adds `rel="me"`: the page links to its owner's own profile. */
		me?: boolean;
	}

	export interface SiteFooterGroup {
		label: string;
		/** Accessible name of the group's navigation; defaults to `label`. */
		navLabel?: string;
		testId?: string;
		links: readonly SiteFooterLink[];
		/** Rendered after the links, inside the group. */
		after?: Snippet;
	}

	export interface SiteFooterProps {
		brand: Snippet;
		tagline: string;
		groups: readonly SiteFooterGroup[];
		/** Start of the status row, such as an address or attribution. */
		statusStart?: Snippet;
		statusPrefix: string;
		/** Screen-reader text for the live lamp. */
		liveLabel: string;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { FooterGroup, FooterLink } from '../primitives/footer/index.js';
	import StatusDot from '../brand/StatusDot.svelte';

	let { brand, tagline, groups, statusStart, statusPrefix, liveLabel }: SiteFooterProps = $props();

	const now = new Date();
	const systemDate = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

	let footer: HTMLElement;
	let inView = $state(false);
	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting));
		observer.observe(footer);
		return () => observer.disconnect();
	});
</script>

<footer
	bind:this={footer}
	data-in-view={inView}
	data-testid="footer"
	data-slot="footer"
	class="relative z-[var(--z-content)] bg-[var(--muted)]"
	style="--footer-groups: {groups.length};"
>
	<div class="footer-gradient-sep" aria-hidden="true"></div>
	<div
		class="grid w-full grid-cols-1 gap-10 px-6 pb-8 pt-10 sm:grid-cols-2 sm:px-10 sm:pt-12 lg:grid-cols-[1.5fr_repeat(var(--footer-groups),minmax(0,1fr))] lg:gap-8 lg:px-16 lg:pt-14"
	>
		<div class="flex flex-col items-start">
			{@render brand()}
			<span class="mt-2 font-mono text-xs text-[var(--muted-foreground)]">{tagline}</span>
		</div>
		{#each groups as group (group.label)}
			<nav aria-label={group.navLabel ?? group.label} data-testid={group.testId}>
				<FooterGroup label={group.label}>
					{#each group.links as link (link.href)}
						{#if link.external}
							<FooterLink
								href={link.href}
								target="_blank"
								rel={link.me ? 'me noopener noreferrer' : 'noopener noreferrer'}
								aria-label={link.ariaLabel}>{link.label}</FooterLink
							>
						{:else}
							<FooterLink href={link.href} aria-label={link.ariaLabel}>{link.label}</FooterLink>
						{/if}
					{/each}
					{@render group.after?.()}
				</FooterGroup>
			</nav>
		{/each}
	</div>
	<div
		class="footer-status-border flex w-full flex-col items-center gap-2 px-6 py-4 font-mono text-caption text-[var(--muted-foreground)] sm:flex-row sm:justify-between sm:px-10 lg:px-16"
	>
		{@render statusStart?.()}
		<span class="flex items-center gap-1.5 text-[var(--accent-text)]">
			<StatusDot color="orange" pulse label={liveLabel} />
			{statusPrefix}
			{systemDate}
		</span>
	</div>
</footer>

<style>
	footer {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	.footer-gradient-sep {
		height: 3px;
		background: repeating-linear-gradient(
			-45deg,
			var(--hazard-a) 0px,
			var(--hazard-a) 6px,
			var(--hazard-b) 6px,
			var(--hazard-b) 12px
		);
	}

	.footer-status-border {
		border-top: 2px solid var(--border-rule-accent);
	}

	@media (prefers-reduced-motion: reduce) {
		footer :global([data-slot='footer-link']) {
			transition: none;
		}
	}
</style>
