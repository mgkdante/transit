<script lang="ts">
	import SwitchRow from '#lib/components/shared/SwitchRow.svelte';
	import { Button } from '@yesid/ui/button';
	import WavesIcon from '@lucide/svelte/icons/waves';
	import { motionMode } from '#lib/stores/index.ts';
	import { getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import type { MapCopy } from './map.copy';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

	const localizeHref = getLocalizeHref();

	interface Props {
		locale: Locale;
		copy: MapCopy;
		collapsed?: boolean;
	}

	let { locale, copy: t, collapsed = false }: Props = $props();

	const hintId = $props.id();
	const smooth = $derived(motionMode.isSmooth && !$prefersReducedMotion);
	const explainHref = $derived(`${localizeHref('/metrics', locale)}#live-positions`);
</script>

<div class="map-motion" data-testid="map-motion" data-collapsed={collapsed}>
	{#if collapsed}
		<span class="map-motion-badge" aria-hidden="true">
			<WavesIcon size={13} strokeWidth={2.35} />
		</span>
		<SwitchRow
			type="button"
			class="map-motion-round"
			checked={smooth}
			disabled={$prefersReducedMotion}
			title={$prefersReducedMotion ? t.motion.unavailable : undefined}
			aria-label={t.motion.toSmooth}
			data-testid="map-motion-switch"
			onclick={() => motionMode.toggle()}
		></SwitchRow>
		{#if $prefersReducedMotion}<span class="map-motion-hint">{t.motion.unavailable}</span>{/if}
	{:else}
		<div class="map-motion-heading">
			<h2 class="map-motion-label"><WavesIcon size={14} aria-hidden="true" />{t.motion.label}</h2>
			<SwitchRow
				type="button"
				class="map-motion-switch"
				aria-describedby={hintId}
				checked={smooth}
				disabled={$prefersReducedMotion}
				data-testid="map-motion-switch"
				onclick={() => motionMode.toggle()}
			>
				<span class="map-motion-state">{t.motion.setting}</span>
			</SwitchRow>
		</div>
		<div class="map-motion-caption">
			<span id={hintId} class="map-motion-hint"
				>{$prefersReducedMotion
					? t.motion.unavailable
					: smooth
						? t.motion.hintSmooth
						: t.motion.hintRaw}</span
			>
			<Button variant="ghost" size="sm" class="map-motion-explain" href={explainHref}
				>{t.motion.explain}</Button
			>
		</div>
	{/if}
</div>

<style>
	:global(.map-motion) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
		width: 100%;
		min-width: 0;

		justify-self: start;
	}
	:global(.map-motion-heading),
	:global(.map-motion-caption) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	:global(.map-motion-caption) {
		flex-direction: column;
		align-items: flex-start;
	}
	:global(.map-motion[data-collapsed='true']) {
		gap: 0.375rem;
		justify-items: center;
	}
	:global(.map-motion-heading) {
		flex-wrap: wrap;
	}
	:global(.map-motion-label) {
		flex: none;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		margin: 0;
		min-height: 44px;
		color: var(--foreground);
	}
	:global(.map-motion-badge) {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 32%, transparent);
		border-radius: var(--radius-sm);
	}
	:global(.map-motion-badge svg) {
		width: 0.82rem;
		height: 0.82rem;
	}
	:global(.map-motion-switch) {
		display: inline-flex;
		justify-self: start;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	:global(.map-motion-switch:hover),
	:global(.map-motion-switch:focus-visible) {
		border-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
	}
	:global(.map-motion-switch[aria-checked='true']) {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 50%, var(--border) 50%);
		background: transparent;
	}

	:global(.map-motion-state) {
		white-space: nowrap;
	}
	:global(.map-motion-hint) {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
		white-space: normal;
	}
	:global(.map-motion-explain) {
		display: inline-flex;
		min-width: 44px;
		flex: none;
		justify-content: flex-start;
		align-items: center;
		justify-self: start;
		min-height: 44px;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--primary);
		text-decoration: none;
		transition: opacity var(--duration-fast) var(--ease-default);
	}
	:global(.map-motion-explain:hover),
	:global(.map-motion-explain:focus-visible) {
		text-decoration: underline;
	}
	:global(.map-motion-explain:focus-visible) {
		border-radius: var(--radius-sm);
	}

	:global(.map-motion-round) {
		display: inline-grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border-subtle);
		border-radius: 50%;
		color: var(--muted-foreground);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	:global(.map-motion-round:hover),
	:global(.map-motion-round:focus-visible) {
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
	}
	:global(.map-motion-round[aria-checked='true']) {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.map-motion-switch),
		:global(.map-motion-round),
		:global(.map-motion-explain) {
			transition: none;
		}
	}
	:global(.map-motion-switch:focus-visible),
	:global(.map-motion-explain:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	:global(.map-motion-heading) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	:global(.map-motion-switch) {
		justify-self: stretch;
		justify-content: space-between;
	}
	:global(.map-motion-state) {
		white-space: nowrap;
		text-align: left;
	}
</style>
