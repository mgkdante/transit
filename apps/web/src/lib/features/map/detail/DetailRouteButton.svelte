<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
	import { Button } from '@yesid/ui/button';

	interface Props {
		label: string;
		ariaLabel: string;
		focusKey?: string;
		onclick: () => void;
	}

	let { label, ariaLabel, focusKey, onclick }: Props = $props();
</script>

<!-- The one "open this line" control in the detail panel: a route tag with a 44 px target. -->
<Button
	variant="ghost"
	size="sm"
	type="button"
	class="detail-route-button"
	data-detail-focus-key={focusKey}
	aria-label={ariaLabel}
	{onclick}><Badge variant="tag" size="xs" class="detail-route-tag">{label}</Badge></Button
>

<style>
	:global(.detail-route-button) {
		min-block-size: var(--size-tap-min);
		min-inline-size: var(--size-tap-min);
		height: auto;
		justify-content: flex-start;
		padding: 0;
		border: 0;
		background: transparent;
	}
	:global(.detail-route-button:hover) {
		background: transparent;
	}
	:global(.detail-route-button .detail-route-tag) {
		font-family: var(--font-mono);
		white-space: nowrap;
		transition:
			border-color var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-out);
	}
	:global(.detail-route-button:hover .detail-route-tag) {
		border-color: var(--primary);
		color: var(--foreground);
	}
	:global(.detail-route-button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.detail-route-button .detail-route-tag) {
			transition: none;
		}
	}
</style>
