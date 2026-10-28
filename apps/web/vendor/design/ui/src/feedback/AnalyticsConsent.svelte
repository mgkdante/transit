<!--
  The analytics consent rail, fixed above the bottom edge. It shows while the consent policy asks
  for a prompt and `canShow` allows it, or whenever preferences are open; then it marks the current
  choice pressed and takes focus on each preferences request. The product passes the store, its
  controls, the copy and the privacy link; a settings button elsewhere calls `store.openPreferences()`.
-->
<script lang="ts" module>
	import type { AnalyticsConsentStore } from '@yesid/analytics/consent';
	import type { AnalyticsControlsInput } from '@yesid/analytics/policy';

	export interface AnalyticsConsentCopy {
		title: string;
		description: string;
		accept: string;
		decline: string;
		/** Heading while preferences are open. */
		settings: string;
		privacy: string;
	}

	export interface AnalyticsConsentProps {
		store: AnalyticsConsentStore;
		controls?: AnalyticsControlsInput;
		copy: AnalyticsConsentCopy;
		privacyHref: string;
		/** Holds the first prompt back, for example until an intro finishes. */
		canShow?: boolean;
		id?: string;
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { getAnalyticsPolicy } from '@yesid/analytics/policy';
	import { Button } from '../primitives/button/index.js';

	const uid = $props.id();
	let {
		store,
		controls = {},
		copy,
		privacyHref,
		canShow = true,
		id = `analytics-consent-${uid}`,
	}: AnalyticsConsentProps = $props();

	const focusRequests = $derived(store.preferencesFocusRequests);
	const policy = $derived(getAnalyticsPolicy(controls, $store));
	const preferencesMode = $derived($store.preferencesOpen);
	const shouldShow = $derived(policy.showPrompt && (canShow || preferencesMode));
	const acceptActive = $derived(preferencesMode && $store.choice === 'granted');
	const declineActive = $derived(preferencesMode && $store.choice === 'denied');
	const titleId = $derived(`${id}-title`);
	const descriptionId = $derived(`${id}-description`);
	let railElement = $state<HTMLElement | null>(null);

	$effect(() => {
		const request = $focusRequests;
		const target = railElement;
		if (!preferencesMode || !shouldShow || !target) return;

		void tick().then(() => {
			if (railElement !== target || !preferencesMode || $focusRequests !== request) return;
			const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'auto'
				: 'smooth';
			target.scrollIntoView?.({ behavior, block: 'nearest' });
			target.focus({ preventScroll: true });
		});
	});

	onMount(() => store.init());
</script>

{#if shouldShow}
	<section
		bind:this={railElement}
		{id}
		tabindex="-1"
		aria-labelledby={titleId}
		aria-describedby={descriptionId}
		class="analytics-consent fixed inset-x-4 mx-auto sm:inset-x-6"
		data-slot="analytics-consent"
	>
		<div class="consent-layout">
			<div class="consent-copy">
				<h2 id={titleId} class="sr-only">{preferencesMode ? copy.settings : copy.title}</h2>
				<div class="consent-disclosure">
					<p id={descriptionId} class="consent-description">{copy.description}</p>{' '}
					<a href={privacyHref} class="consent-privacy">{copy.privacy}</a>
				</div>
			</div>

			<div class="consent-actions" role="group" aria-labelledby={titleId}>
				<Button
					variant="ghost"
					size="cta-sm"
					class="consent-choice min-h-11 min-w-0 w-full px-3 leading-tight whitespace-normal sm:w-auto sm:px-5 sm:whitespace-nowrap"
					aria-pressed={preferencesMode ? declineActive : undefined}
					onclick={() => store.deny()}
				>
					{copy.decline}
				</Button>
				<Button
					variant="default"
					size="cta-sm"
					class="consent-choice min-h-11 min-w-0 w-full px-3 leading-tight whitespace-normal hover:translate-y-0 hover:shadow-none sm:w-auto sm:px-5 sm:whitespace-nowrap"
					aria-pressed={preferencesMode ? acceptActive : undefined}
					onclick={() => store.grant()}
				>
					{copy.accept}
				</Button>
			</div>
		</div>
	</section>
{/if}

<style>
	.analytics-consent {
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		z-index: calc(var(--z-sheet) + 1);
		max-width: var(--container-wide);
		background: color-mix(in srgb, var(--surface-2) 96%, transparent);
		border: 0;
		border-radius: var(--radius-lg);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
		backdrop-filter: blur(18px) saturate(115%);
		-webkit-backdrop-filter: blur(18px) saturate(115%);
		animation: analytics-consent-in var(--duration-fast) var(--ease-out) both;
	}

	.consent-layout {
		display: grid;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
	}

	.consent-copy {
		min-width: 0;
	}

	.consent-disclosure {
		color: var(--secondary-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}

	.consent-description {
		display: inline;
		margin: 0;
	}

	.consent-privacy {
		color: var(--foreground);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, var(--primary) 70%, transparent);
		text-underline-offset: 0.2em;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-out);
	}

	.consent-privacy:hover,
	.consent-privacy:focus-visible {
		color: var(--primary);
	}

	.consent-actions {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		width: 100%;
		min-width: 0;
		justify-content: end;
		align-items: stretch;
		gap: 0.5rem;
	}

	.consent-actions :global(.consent-choice[aria-pressed='true']) {
		border-color: var(--border-brand-active);
		box-shadow: inset 0 0 0 1px var(--border-brand-active);
	}

	@media (min-width: 48rem) {
		.consent-layout {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: 1.25rem;
		}

		.consent-actions {
			grid-template-columns: max-content max-content;
			width: auto;
			align-items: center;
		}
	}

	@keyframes analytics-consent-in {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.analytics-consent {
			animation: none;
		}
	}
</style>
