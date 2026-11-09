<script lang="ts">
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
		<button
			type="button"
			class="map-motion-round"
			role="switch"
			aria-checked={smooth}
			disabled={$prefersReducedMotion}
			title={$prefersReducedMotion ? t.motion.unavailable : undefined}
			aria-label={t.motion.toSmooth}
			data-testid="map-motion-switch"
			onclick={() => motionMode.toggle()}
		></button>
		{#if $prefersReducedMotion}<span class="map-motion-hint">{t.motion.unavailable}</span>{/if}
	{:else}
		<div class="map-motion-heading">
			<h2 class="map-motion-label"><WavesIcon size={14} aria-hidden="true" />{t.motion.label}</h2>
			<button
				type="button"
				class="map-motion-switch"
				aria-describedby={hintId}
				role="switch"
				aria-checked={smooth}
				disabled={$prefersReducedMotion}
				data-testid="map-motion-switch"
				onclick={() => motionMode.toggle()}
			>
				<span class="map-motion-track" aria-hidden="true"
					><span class="map-motion-thumb"></span></span
				>
				<span class="map-motion-state">{t.motion.setting}</span>
			</button>
		</div>
		<div class="map-motion-caption">
			<span id={hintId} class="map-motion-hint"
				>{$prefersReducedMotion
					? t.motion.unavailable
					: smooth
						? t.motion.hintSmooth
						: t.motion.hintRaw}</span
			>
			<a class="map-motion-explain" href={explainHref}>{t.motion.explain}</a>
		</div>
	{/if}
</div>

<style>
	.map-motion {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
		width: 100%;
		min-width: 0;

		justify-self: start;
	}
	.map-motion-heading,
	.map-motion-caption {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}
	.map-motion-caption {
		flex-direction: column;
		align-items: flex-start;
	}
	.map-motion[data-collapsed='true'] {
		gap: 0.375rem;
		justify-items: center;
	}
	.map-motion-heading {
		flex-wrap: wrap;
	}
	.map-motion-label {
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
	.map-motion-badge {
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
	.map-motion-badge :global(svg) {
		width: 0.82rem;
		height: 0.82rem;
	}
	.map-motion-switch {
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
	.map-motion-switch:hover,
	.map-motion-switch:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
	}
	.map-motion-switch[aria-checked='true'] {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 50%, var(--border) 50%);
		background: transparent;
	}
	.map-motion-track {
		position: relative;
		flex: none;
		width: 1.85rem;
		height: 1.05rem;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--border) 70%, transparent);
		transition: background-color var(--duration-fast) var(--ease-default);
	}
	.map-motion-switch[aria-checked='true'] .map-motion-track {
		background: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.map-motion-thumb {
		position: absolute;
		top: 50%;
		left: 0.125rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--card);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 30%, transparent);
		transform: translate(0, -50%);
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.map-motion-switch[aria-checked='true'] .map-motion-thumb {
		transform: translate(0.8rem, -50%);
	}
	.map-motion-state {
		white-space: nowrap;
	}
	.map-motion-hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
		white-space: normal;
	}
	.map-motion-explain {
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
	.map-motion-explain:hover,
	.map-motion-explain:focus-visible {
		text-decoration: underline;
	}
	.map-motion-explain:focus-visible {
		border-radius: var(--radius-sm);
	}

	.map-motion-round {
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
	.map-motion-round:hover,
	.map-motion-round:focus-visible {
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
	}
	.map-motion-round[aria-checked='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.map-motion-track,
		.map-motion-thumb,
		.map-motion-switch,
		.map-motion-round,
		.map-motion-explain {
			transition: none;
		}
	}
	.map-motion-switch:focus-visible,
	.map-motion-explain:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.map-motion-track {
		order: 1;
	}
	.map-motion-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.map-motion-switch {
		justify-self: stretch;
		justify-content: space-between;
	}
	.map-motion-state {
		white-space: nowrap;
		text-align: left;
	}
</style>
