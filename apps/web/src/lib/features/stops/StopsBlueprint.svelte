<script lang="ts">
	import { BlueprintShell } from '@yesid/ui/brand';
	import {
		BlueprintGlassShelter,
		BlueprintAccessibleBusCurbSection,
		BlueprintHeatedGlassShelterSection,
		BlueprintMetroPlatformCirculationPlan,
		BlueprintPassengerInformationEquipment,
		BlueprintSimpleShelter,
		BlueprintStopPlan,
		BlueprintStopPost,
		BlueprintBusSide,
		BlueprintSignal,
		BlueprintStationSection,
	} from '@yesid/ui/blueprints';
	import { getLocale } from '$lib/i18n';
	import { page } from '$app/state';

	const locale = getLocale();
	const operator = $derived(page.data?.provider?.labels[locale].operator ?? 'STM');
</script>

<BlueprintShell
	labels={['SEC-STOPS / STATIONS', 'DWG: STOP-PLATFORM-SECTION', 'SCALE NTS | REV.A']}
>
	{#snippet hero()}
		<BlueprintStopPlan
			class="h-full w-full"
			data-blueprint-layer="hero"
			data-blueprint-part="stops-plan"
		/>
	{/snippet}

	{#snippet details()}
		<BlueprintGlassShelter
			class="edge-detail"
			data-blueprint-part="stops-glass-shelter"
			style="top:-18%;left:-4%;width:58%;height:65%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintSimpleShelter
			class="edge-detail"
			data-blueprint-part="stops-simple-shelter"
			style="top:-10%;left:20%;width:55%;height:50%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
		<BlueprintStopPost
			class="edge-detail"
			data-blueprint-part="stops-post"
			style="top:-2%;left:76%;width:24%;height:48%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		<BlueprintStationSection
			class="edge-detail"
			data-blueprint-part="stops-station-section"
			style="top:-4%;left:30%;width:50%;height:60%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintBusSide
			{operator}
			class="edge-detail"
			data-blueprint-part="stops-bus"
			style="top:0;left:50%;width:50%;height:44%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="stops-signal"
			style="top:0;left:8%;width:24%;height:30%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		<BlueprintMetroPlatformCirculationPlan
			class="edge-detail"
			data-blueprint-part="stops-metro-platform-circulation-plan"
			style="top:2%;left:42%;width:52%;height:42%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintHeatedGlassShelterSection
			class="edge-detail"
			data-blueprint-part="stops-heated-glass-shelter-section"
			style="top:5%;left:0;width:34%;height:27%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintAccessibleBusCurbSection
			class="edge-detail"
			data-blueprint-part="stops-accessible-bus-curb-section"
			style="top:20%;left:64%;width:36%;height:24%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
		<BlueprintPassengerInformationEquipment
			class="edge-detail"
			data-blueprint-part="stops-passenger-information-equipment"
			style="top:0;left:48%;width:30%;height:20%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
	{/snippet}
</BlueprintShell>
