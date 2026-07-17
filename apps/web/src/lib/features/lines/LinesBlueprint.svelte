<!-- Full-header layered SVG composition, source-aligned with yesid.dev/blog. -->
<script lang="ts">
	import { BlueprintShell } from '@yesid/ui/brand';
	import BlueprintBridge from '$lib/components/svg/transit/BlueprintBridge.svelte';
	import BlueprintBusSide from '$lib/components/svg/transit/BlueprintBusSide.svelte';
	import BlueprintTrackPlan from '$lib/components/svg/transit/BlueprintTrackPlan.svelte';
	import BlueprintCatenary from '$lib/components/svg/transit/BlueprintCatenary.svelte';
	import BlueprintMr73Side from '$lib/components/svg/transit/BlueprintMr73Side.svelte';
	import BlueprintPantographOverheadEquipment from '$lib/components/svg/transit/BlueprintPantographOverheadEquipment.svelte';
	import BlueprintRailGaugeSection from '$lib/components/svg/transit/BlueprintRailGaugeSection.svelte';
	import BlueprintSignal from '$lib/components/svg/transit/BlueprintSignal.svelte';
	import BlueprintSignallingCommunicationsEquipment from '$lib/components/svg/transit/BlueprintSignallingCommunicationsEquipment.svelte';
	import BlueprintTurnoutCrossoverPlan from '$lib/components/svg/transit/BlueprintTurnoutCrossoverPlan.svelte';
	import BlueprintDetailBogie from '$lib/components/svg/detail/BlueprintDetailBogie.svelte';
</script>

<BlueprintShell labels={['SEC-LINES / NETWORK', 'DWG: TRANSIT-LINE-ELEV', 'SCALE NTS | REV.A']}>
	{#snippet hero()}
		<BlueprintBridge
			class="h-full w-full"
			data-blueprint-layer="hero"
			data-blueprint-part="lines-bridge"
		/>
	{/snippet}

	{#snippet details()}
		<BlueprintTrackPlan
			class="edge-detail"
			data-blueprint-part="lines-track-plan"
			style="top:-4%;left:-3%;width:43%;height:58%;opacity:0.24;"
		/>
		<BlueprintCatenary
			class="edge-detail"
			data-blueprint-part="lines-catenary"
			style="top:2%;right:-4%;width:48%;height:45%;opacity:0.24;"
		/>
		<BlueprintMr73Side
			class="edge-detail"
			data-blueprint-part="lines-metro-car"
			style="bottom:-13%;left:20%;width:51%;height:62%;opacity:0.22;"
		/>
		<BlueprintBusSide
			class="edge-detail"
			data-blueprint-part="lines-bus"
			style="bottom:-10%;right:-7%;width:35%;height:50%;opacity:0.23;"
		/>
		<BlueprintDetailBogie
			class="edge-detail"
			data-blueprint-part="lines-bogie"
			style="top:27%;left:3%;width:19%;height:48%;opacity:0.22;"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="lines-signal"
			style="bottom:-4%;right:19%;width:9%;height:61%;opacity:0.28;"
		/>
		<BlueprintTurnoutCrossoverPlan
			class="edge-detail"
			data-blueprint-part="lines-turnout-crossover-plan"
			style="top:-13%;left:30%;width:45%;height:55%;opacity:0.2;"
		/>
		<BlueprintRailGaugeSection
			class="edge-detail"
			data-blueprint-part="lines-rail-sleeper-gauge-power-section"
			style="bottom:-18%;left:-6%;width:28%;height:70%;opacity:0.22;"
		/>
		<BlueprintPantographOverheadEquipment
			class="edge-detail"
			data-blueprint-part="lines-pantograph-overhead-equipment"
			style="top:-15%;right:16%;width:28%;height:68%;opacity:0.22;"
		/>
		<BlueprintSignallingCommunicationsEquipment
			class="edge-detail"
			data-blueprint-part="lines-signalling-communications-equipment"
			style="bottom:-18%;right:-3%;width:29%;height:70%;opacity:0.21;"
		/>
	{/snippet}
</BlueprintShell>
