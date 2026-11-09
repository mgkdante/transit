<script lang="ts">
	import { MetricDisplay, type MetricDisplayProps as UiProps } from '@yesid/ui/brand';
	import { AbsentValue } from '#lib/components/edge/index.ts';
	import type { AbsenceReasonKey } from '#lib/site/absence.ts';
	import type { Locale } from '#lib/i18n/index.ts';

	export interface MetricDisplayProps extends Omit<UiProps, 'absent'> {
		absentReason?: AbsenceReasonKey;
		locale?: Locale;
		absentParams?: Readonly<Record<string, string | number>>;
	}
	let { absentReason, locale, absentParams, ...rest }: MetricDisplayProps = $props();
</script>

{#snippet absent()}
	{#if absentReason && locale}
		<AbsentValue variant="inline" reason={absentReason} {locale} params={absentParams} />
	{/if}
{/snippet}
<MetricDisplay {...rest} {absent} />
