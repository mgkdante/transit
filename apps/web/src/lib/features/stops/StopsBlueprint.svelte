<!-- Station-led layered SVG composition for the Stops listing header. -->
<script lang="ts">
	import { BlueprintShell } from '@yesid/ui/brand';
	import BlueprintGlassShelter from '$lib/components/svg/stops/BlueprintGlassShelter.svelte';
	import BlueprintAccessibleBusCurbSection from '$lib/components/svg/stops/BlueprintAccessibleBusCurbSection.svelte';
	import BlueprintHeatedGlassShelterSection from '$lib/components/svg/stops/BlueprintHeatedGlassShelterSection.svelte';
	import BlueprintMetroPlatformCirculationPlan from '$lib/components/svg/stops/BlueprintMetroPlatformCirculationPlan.svelte';
	import BlueprintPassengerInformationEquipment from '$lib/components/svg/stops/BlueprintPassengerInformationEquipment.svelte';
	import BlueprintSimpleShelter from '$lib/components/svg/stops/BlueprintSimpleShelter.svelte';
	import BlueprintStopPlan from '$lib/components/svg/stops/BlueprintStopPlan.svelte';
	import BlueprintStopPost from '$lib/components/svg/stops/BlueprintStopPost.svelte';
	import BlueprintBusSide from '$lib/components/svg/transit/BlueprintBusSide.svelte';
	import BlueprintSignal from '$lib/components/svg/transit/BlueprintSignal.svelte';
	import BlueprintStationSection from '$lib/components/svg/transit/BlueprintStationSection.svelte';
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
			style="top:-3%;left:2%;width:32%;height:70%;opacity:0.25;"
		/>
		<BlueprintSimpleShelter
			class="edge-detail"
			data-blueprint-part="stops-simple-shelter"
			style="bottom:-5%;left:25%;width:30%;height:58%;opacity:0.22;"
		/>
		<BlueprintStopPost
			class="edge-detail"
			data-blueprint-part="stops-post"
			style="top:1%;right:5%;width:11%;height:82%;opacity:0.28;"
		/>
		<BlueprintStationSection
			class="edge-detail"
			data-blueprint-part="stops-station-section"
			style="bottom:-5%;right:14%;width:31%;height:60%;opacity:0.22;"
		/>
		<BlueprintBusSide
			class="edge-detail"
			data-blueprint-part="stops-bus"
			style="top:24%;left:44%;width:39%;height:52%;opacity:0.23;"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="stops-signal"
			style="bottom:-10%;left:11%;width:8%;height:58%;opacity:0.24;"
		/>
		<BlueprintMetroPlatformCirculationPlan
			class="edge-detail"
			data-blueprint-part="stops-metro-platform-circulation-plan"
			style="top:-14%;left:24%;width:48%;height:56%;opacity:0.2;"
		/>
		<BlueprintHeatedGlassShelterSection
			class="edge-detail"
			data-blueprint-part="stops-heated-glass-shelter-section"
			style="bottom:-18%;left:-5%;width:28%;height:70%;opacity:0.21;"
		/>
		<BlueprintAccessibleBusCurbSection
			class="edge-detail"
			data-blueprint-part="stops-accessible-bus-curb-section"
			style="bottom:-18%;right:-4%;width:38%;height:72%;opacity:0.22;"
		/>
		<BlueprintPassengerInformationEquipment
			class="edge-detail"
			data-blueprint-part="stops-passenger-information-equipment"
			style="top:-16%;right:17%;width:24%;height:76%;opacity:0.22;"
		/>
	{/snippet}
</BlueprintShell>
