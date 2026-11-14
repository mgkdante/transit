<script lang="ts">
	import { navPillCopy } from '#lib/i18n/messages.ts';
	import { Button } from '@yesid/ui/button';
	import { cn } from '#lib/utils/index.ts';
	import { dataRefresh } from '#lib/stores/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	const refreshing = $derived(dataRefresh.refreshing);

	const label = $derived(
		refreshing
			? navPillCopy[locale].refreshing
			: dataRefresh.error
				? navPillCopy[locale].refreshFailed
				: navPillCopy[locale].refresh,
	);

	function onClick(): void {
		void dataRefresh.run();
	}
</script>

<div class={cn('refresh-control', className)} data-slot="refresh-control">
	<Button
		type="button"
		variant="ghost"
		size="icon-tap"
		aria-label={label}
		title={label}
		onclick={onClick}
		disabled={refreshing}
		data-refreshing={refreshing}
		data-refresh-failed={dataRefresh.error != null}
	>
		<svg
			data-motion={refreshing ? 'refresh-busy' : undefined}
			class="refresh-icon"
			class:spin={refreshing}
			class:failed={dataRefresh.error != null}
			viewBox="0 0 20 20"
			width="16"
			height="16"
			aria-hidden="true"
			fill="none"
		>
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
	</Button>
	{#if dataRefresh.error}
		<span role="status" class="sr-only">{navPillCopy[locale].refreshFailed}</span>
	{/if}
</div>

<style>
	.refresh-control {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.refresh-icon.spin {
		animation: refresh-spin 0.8s linear infinite;
		transform-origin: center;
	}
	.refresh-icon.failed {
		color: var(--dataviz-status-late);
	}
	@keyframes refresh-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.refresh-icon.spin {
			animation: none;
		}
	}
</style>
