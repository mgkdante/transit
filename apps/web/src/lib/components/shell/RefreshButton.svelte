<!--
  RefreshButton — the chrome "refresh data" control + freshness readout.

  Drives the global `dataRefresh` coordinator: one press re-runs EVERY data
  source on the page (load fns via invalidateAll → re-boots the /v1 context;
  createResource surfaces + the live store via the refresh epoch). It is also the
  persistent RECOVERY affordance: when /v1 is unreachable the page tree is
  replaced by the error edge state but this control stays in the chrome, so a
  press re-boots the contract and brings the surfaces back.

  The icon spins while a refresh is in flight (disabled to prevent double-fire);
  a compact "updated <relative>" readout ticks every second on wide screens and
  is always carried in the button's title + aria-label. Extracted as its own
  control (like ThemeToggle / LangSwitch) so TopBar stays a composition.

  DOCTRINE: --primary is interactive-only — it lights the control on hover/focus,
  never as a data mark. Tokens only.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { cn, formatRelativeSeconds } from '$lib/utils';
	import { dataRefresh, sharedClock } from '$lib/stores';
	import type { Locale } from '$lib/i18n';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	const refreshing = $derived(dataRefresh.refreshing);

	// Anchor the readout to page-load data if no snapshot timestamp has landed yet.
	onMount(() => dataRefresh.seedNow());

	// Tick off the ONE shared clock instead of a private interval, so the chrome
	// "updated <relative>" chip advances in lockstep with every other relative-time
	// label on the page (the live freshness badge, etc.). subscribe() keeps the
	// single shared interval alive while this control is mounted; the cleanup
	// disposes it. SSR-safe (subscribe no-ops without a browser).
	$effect(() => sharedClock.subscribe());

	// The freshness age is DERIVED in the shared coordinator off sharedClock +
	// the single dataGeneratedUtc (with the lastRefreshedMs fallback) — read it
	// straight through so the chrome can never drift from the data it describes.
	const ageSeconds = $derived(dataRefresh.ageSeconds);
	const relative = $derived(ageSeconds != null ? formatRelativeSeconds(ageSeconds, locale) : null);

	const updatedWord = $derived(locale === 'fr' ? 'à jour' : 'updated');
	// Title/aria carry the full intent + freshness; the visible chip (lg+) is terse.
	const label = $derived(
		refreshing
			? locale === 'fr'
				? 'Actualisation…'
				: 'Refreshing…'
			: (locale === 'fr' ? 'Actualiser les données' : 'Refresh data') +
					(relative ? ` · ${updatedWord} ${relative}` : ''),
	);

	function onClick(): void {
		void dataRefresh.run();
	}
</script>

<div class={cn('refresh-control', className)} data-slot="refresh-control">
	{#if relative}
		<span class="refresh-readout hidden lg:inline" data-slot="refresh-readout" aria-hidden="true">
			{updatedWord}
			{relative}
		</span>
	{/if}
	<button
		type="button"
		class="refresh-btn tap-press"
		aria-label={label}
		title={label}
		onclick={onClick}
		disabled={refreshing}
		data-refreshing={refreshing}
	>
		<svg
			class="refresh-icon"
			class:spin={refreshing}
			viewBox="0 0 20 20"
			width="16"
			height="16"
			aria-hidden="true"
			fill="none"
		>
			<!-- Two circular sync arrows. -->
			<path
				d="M16.5 5.5A7 7 0 0 0 4 7.2M3.5 14.5A7 7 0 0 0 16 12.8"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
			<path
				d="M16.8 3v2.6h-2.6M3.2 17v-2.6h2.6"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
</div>

<style>
	.refresh-control {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.refresh-readout {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.refresh-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.25rem;
		width: 2.25rem;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--secondary-foreground);
		border-radius: var(--radius-lg);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.refresh-btn:hover {
		color: var(--primary);
		background: var(--muted);
	}
	.refresh-btn:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.refresh-btn:disabled {
		cursor: default;
		color: var(--muted-foreground);
	}

	.refresh-icon.spin {
		animation: refresh-spin 0.8s linear infinite;
		transform-origin: center;
	}
	@keyframes refresh-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.refresh-btn {
			transition: none;
		}
		.refresh-icon.spin {
			animation: none;
		}
	}
</style>
