<script lang="ts">
	import { cn } from '$lib/utils';
	import { dataRefresh } from '$lib/stores';
	import type { Locale } from '$lib/i18n';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	const refreshing = $derived(dataRefresh.refreshing);

	const label = $derived(
		refreshing
			? locale === 'fr'
				? 'Actualisation…'
				: 'Refreshing…'
			: locale === 'fr'
				? 'Actualiser les données'
				: 'Refresh data',
	);

	function onClick(): void {
		void dataRefresh.run();
	}
</script>

<div class={cn('refresh-control', className)} data-slot="refresh-control">
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
	.refresh-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.75rem;
		width: 2.75rem;
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
