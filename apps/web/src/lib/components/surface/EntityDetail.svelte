<!--
  EntityDetail — the tabbed detail scaffold for an entity surface.

  Extracts the shared shell the route/[id] + stop/[id] pages hand-rolled today
  (a station-voice kicker + caller header, then a line-variant TabsList over
  TabsContent panes). Callers pass the tab definitions, the active key (bindable)
  and a `pane` snippet keyed by tab; the header snippet renders the SectionHeading
  (line) or StopLabel (stop) — surface-specific, so the caller owns it.

  Tokens, no hex. Matches the `.surface` / `.surface-head` / `.surface-pane`
  styles the two shells share.
-->
<script lang="ts" generics="K extends string">
	import type { Snippet } from 'svelte';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';

	interface EntityDetailProps {
		/** Mono station-voice overline (e.g. "LIGNE", "ARRÊT"). */
		kicker: string;
		/** Surface-specific heading (SectionHeading for lines, StopLabel for stops). */
		header: Snippet;
		/** Tab definitions — stable key + already-localized label. */
		tabs: readonly { key: K; label: string }[];
		/** The active tab key (two-way bindable). */
		active: K;
		/** Renders the pane body for a given tab key. */
		pane: Snippet<[K]>;
		/** Optional extra classes on the surface root. */
		class?: string;
	}

	let {
		kicker,
		header,
		tabs,
		active = $bindable(),
		pane,
		class: className,
	}: EntityDetailProps = $props();
</script>

<Surface width="wide" as="div" class={className} data-slot="entity-detail">
	<div class="surface-head">
		<SectionLabel text={kicker} variant="station" />
		{@render header()}
	</div>

	<Separator variant="hazard" />

	<Tabs bind:value={active}>
		<TabsList variant="line" class="w-full justify-start">
			{#each tabs as t (t.key)}
				<TabsTrigger value={t.key}>{t.label}</TabsTrigger>
			{/each}
		</TabsList>

		{#each tabs as t (t.key)}
			<TabsContent value={t.key} class="surface-pane">{@render pane(t.key)}</TabsContent>
		{/each}
	</Tabs>
</Surface>

<style>
	.surface-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	:global(.surface-pane) {
		padding-top: 1.25rem;
	}
</style>
