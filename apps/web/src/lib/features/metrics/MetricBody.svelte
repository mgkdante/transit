<script module lang="ts">
	import type { MetricKey } from './metrics.content';

	export type MetricSqlHtml = Readonly<Record<MetricKey, string>>;
</script>

<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { TypedInformationCard } from '$lib/components/shared';
	import type { MetricEntry } from './metrics.content';
	import { metricsCopy } from './metrics.copy';
	import EasterProse from './EasterProse.svelte';

	let {
		entry,
		locale,
		sqlHtml,
	}: {
		entry: MetricEntry;
		locale: Locale;
		sqlHtml?: string;
	} = $props();
	const t = $derived(metricsCopy[locale]);
</script>

<div class="metric__static-information" data-slot="metric-static-information">
	<TypedInformationCard kind="definition" label={t.sections.definition}>
		<EasterProse text={entry.definition[locale]} class="metric__prose" />
	</TypedInformationCard>

	<TypedInformationCard kind="math" label={t.sections.math}>
		<p class="metric__prose metric__prose--mono">{entry.math[locale]}</p>
	</TypedInformationCard>

	<TypedInformationCard
		kind="sql"
		label={t.sections.sql}
		code={entry.sql}
		codeHtml={sqlHtml}
		codeAriaLabel={`${t.sqlAria}: ${entry.sciName}`}
	/>

	<div class="metric__paired-information">
		<TypedInformationCard kind="not-really" label={t.sections.notReally}>
			<EasterProse text={entry.notReally[locale]} class="metric__prose metric__not" />
		</TypedInformationCard>

		<TypedInformationCard kind="caveat" label={t.sections.caveats}>
			<ul class="metric__caveats">
				{#each entry.caveats[locale] as caveat, i (i)}
					<li>{caveat}</li>
				{/each}
			</ul>
		</TypedInformationCard>
	</div>
</div>

<style>
	.metric__static-information {
		display: contents;
	}

	.metric__paired-information {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

	.metric__prose {
		margin: 0;
		color: var(--foreground);
	}

	.metric__prose,
	.metric__caveats {
		font-size: inherit;
		line-height: inherit;
	}

	.metric__caveats {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding-inline-start: 1.1rem;
	}
</style>
