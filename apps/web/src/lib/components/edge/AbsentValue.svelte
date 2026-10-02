<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { describeAbsence, type AbsenceReasonKey } from '$lib/site/absence';
	import StateNotice from './StateNotice.svelte';

	type Variant = 'inline' | 'row' | 'block';

	export interface AbsentValueProps {
		reason: AbsenceReasonKey;
		locale: Locale;
		params?: Readonly<Record<string, string | number>>;
		variant?: Variant;
		class?: string;
	}

	let { reason, locale, params, variant = 'inline', class: className }: AbsentValueProps = $props();

	const d = $derived(describeAbsence(reason, locale, params));

	const ariaLabel = $derived(`${d.label}, ${d.why}`);
</script>

<StateNotice
	title={d.label}
	body={d.why}
	glyph="·"
	presentation={variant === 'row' ? 'row' : variant === 'block' ? 'silo' : 'pill'}
	tone="neutral"
	role={variant === 'block' ? 'status' : undefined}
	ariaLive={variant === 'block' ? 'polite' : undefined}
	{ariaLabel}
	class={className}
	data-slot="absent-value"
	data-variant={variant === 'block' ? 'block' : 'inline'}
	data-density={variant === 'inline' ? 'chip' : variant}
	data-tone={d.tone}
/>
