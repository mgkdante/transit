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
		<BlueprintStopPlan class="h-full w-full" />
	{/snippet}

	{#snippet details()}
		<BlueprintGlassShelter class="edge-detail" style="top:-18%;left:-4%;width:58%;height:65%;" />
		<BlueprintSimpleShelter class="edge-detail" style="top:-10%;left:20%;width:55%;height:50%;" />
		<BlueprintStopPost class="edge-detail" style="top:-2%;left:76%;width:24%;height:48%;" />
		<BlueprintStationSection class="edge-detail" style="top:-4%;left:30%;width:50%;height:60%;" />
		<BlueprintBusSide {operator} class="edge-detail" style="top:0;left:50%;width:50%;height:44%;" />
		<BlueprintSignal class="edge-detail" style="top:0;left:8%;width:24%;height:30%;" />
		<BlueprintMetroPlatformCirculationPlan
			class="edge-detail"
			style="top:2%;left:42%;width:52%;height:42%;"
		/>
		<BlueprintHeatedGlassShelterSection
			class="edge-detail"
			style="top:5%;left:0;width:34%;height:27%;"
		/>
		<BlueprintAccessibleBusCurbSection
			class="edge-detail"
			style="top:20%;left:64%;width:36%;height:24%;"
		/>
		<BlueprintPassengerInformationEquipment
			class="edge-detail"
			style="top:0;left:48%;width:30%;height:20%;"
		/>
	{/snippet}
</BlueprintShell>
