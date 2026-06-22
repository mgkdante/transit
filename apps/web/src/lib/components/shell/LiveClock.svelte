<!--
  LiveClock — the live wall-clock, ticking once per second, rendered in
  America/Toronto (the transit display-time rule) via the shared time util.
  Decorative signage (aria-hidden); the datetime attribute carries the machine
  value.

  Ticks off the ONE sharedClock (no private setInterval): every relative-time
  readout in the chrome advances on the same interval, so this clock can never
  drift a fraction of a second from the freshness stamps beside it. Subscribing
  keeps that single interval alive while the clock is on screen; SSR renders a
  static frame (subscribe no-ops without a browser).
-->
<script lang="ts">
	import { cn, formatClock } from '$lib/utils';
	import { sharedClock } from '$lib/stores';
	import type { Locale } from '$lib/i18n';

	interface Props {
		locale: Locale;
		class?: string;
	}

	let { locale, class: className }: Props = $props();

	// Keep the shared tick alive while the clock is mounted; read `now` reactively.
	$effect(() => sharedClock.subscribe());

	const now = $derived(new Date(sharedClock.now));
	const clock = $derived(formatClock(now, locale));
</script>

<time
	class={cn('font-mono text-small tabular-nums text-secondary-foreground', className)}
	datetime={now.toISOString()}
	aria-hidden="true"
	data-slot="live-clock">{clock}</time
>
