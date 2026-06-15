<!--
  LiveClock — the live wall-clock, ticking once per second, rendered in
  America/Toronto (the transit display-time rule) via the shared time util.
  Decorative signage (aria-hidden); the datetime attribute carries the machine
  value. Browser-only ticking (SSR renders a single static frame, no interval).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { cn, formatClock } from '$lib/utils';
	import type { Locale } from '$lib/i18n';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	let now = $state(new Date());
	onMount(() => {
		if (!browser) return;
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});

	const clock = $derived(formatClock(now, locale));
</script>

<time
	class={cn('font-mono text-small tabular-nums text-secondary-foreground', className)}
	datetime={now.toISOString()}
	aria-hidden="true"
	data-slot="live-clock">{clock}</time
>
