<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import type { SurfaceTarget } from '#lib/nav/index.ts';
	import TransitEntityRow from './TransitEntityRow.svelte';
	interface EntityRowBaseProps {
		glyph?: string;
		swatch?: string | null;
		tag?: string;
		title: string;
		subtitle?: string;
		meta?: string;
		metaSlot?: import('svelte').Snippet;
		routes?: string[];
		class?: string;
	}

	export interface EntityRowLinkProps extends EntityRowBaseProps {
		target: SurfaceTarget;
		locale: Locale;
		onSelect?: never;
		ariaLabel?: never;
	}

	export interface EntityRowChoiceProps extends EntityRowBaseProps {
		target?: never;
		locale?: never;
		onSelect: () => void;
		ariaLabel: string;
	}

	export type EntityRowProps = EntityRowLinkProps | EntityRowChoiceProps;

	let props: EntityRowProps = $props();
</script>

<TransitEntityRow {...props} />
