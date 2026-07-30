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
			data-blueprint-layer="hero"
			data-blueprint-part="stops-plan"
			style="position:absolute;top:-12.5%;left:0;width:28%;height:75%;"
		/>
	{/snippet}

	{#snippet details()}
		<BlueprintGlassShelter
			class="edge-detail"
			data-blueprint-part="stops-glass-shelter"
			style="top:-18%;left:22%;width:58%;height:65%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
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
			style="top:-4%;left:50%;width:50%;height:46%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintBusSide
			class="edge-detail"
			data-blueprint-part="stops-bus"
			style="top:0;left:50%;width:50%;height:44%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="stops-signal"
			style="top:0;left:38%;width:24%;height:30%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		<BlueprintMetroPlatformCirculationPlan
			class="edge-detail"
			data-blueprint-part="stops-metro-platform-circulation-plan"
			style="top:2%;left:24%;width:52%;height:42%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
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
			style="top:0;left:70%;width:30%;height:20%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
	{/snippet}
</BlueprintShell>
