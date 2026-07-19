<!--
  SectionLabel — mono uppercase label in 3 variants (Set A).
  Brand primitive: replaces scattered overline/label patterns.
  Adapted from yesid.dev SectionLabel; re-themed to transit tokens.

  Four-colour doctrine: section = quiet caption (muted); station = the yellow
  wayfinding voice (overlines/section labels); metric = quiet metric caption.
-->
<script lang="ts">
	import { cn } from '../cn/index.js';
	import type { HTMLAttributes } from 'svelte/elements';

	export type SectionLabelProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'class'> & {
		/** Label text. */
		text: string;
		/** Visual style variant. */
		variant?: 'section' | 'station' | 'metric';
		/** Text alignment. */
		align?: 'left' | 'center';
		class?: string;
	};

	let {
		text,
		variant = 'section',
		align = 'left',
		class: className,
		...restProps
	}: SectionLabelProps = $props();

	const variantClass = {
		section: 'label-section',
		station: 'label-station',
		metric: 'label-metric',
	} as const;
</script>

<span
	class={cn(variantClass[variant], align === 'center' ? 'block text-center' : '', className)}
	data-slot="section-label"
	{...restProps}>{text}</span
>

<style>
	.label-section {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow, 0.1em);
		color: var(--muted-foreground);
	}

	.label-station {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--accent-text);
	}

	.label-metric {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 2px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
</style>
