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
			data-blueprint-layer="hero"
			data-blueprint-part="lines-bridge"
			style="position:absolute;top:-12.5%;left:0;width:28%;height:75%;"
		/>
	{/snippet}

	{#snippet details()}
		<BlueprintTrackPlan
			class="edge-detail"
			data-blueprint-part="lines-track-plan"
			style="top:-10%;left:20%;width:55%;height:50%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
		<BlueprintCatenary
			class="edge-detail"
			data-blueprint-part="lines-catenary"
			style="top:-4%;left:52%;width:48%;height:48%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		<BlueprintMr73Side
			class="edge-detail"
			data-blueprint-part="lines-metro-car"
			style="top:-18%;left:22%;width:58%;height:65%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintBusSide
			class="edge-detail"
			data-blueprint-part="lines-bus"
			style="top:-2%;left:50%;width:50%;height:46%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintDetailBogie
			class="edge-detail"
			data-blueprint-part="lines-bogie"
			style="top:2%;left:2%;width:30%;height:30%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="lines-signal"
			style="top:0;left:38%;width:24%;height:27%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		<BlueprintTurnoutCrossoverPlan
			class="edge-detail"
			data-blueprint-part="lines-turnout-crossover-plan"
			style="top:0;left:24%;width:52%;height:44%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintRailGaugeSection
			class="edge-detail"
			data-blueprint-part="lines-rail-sleeper-gauge-power-section"
			style="top:36%;left:0;width:34%;height:24%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintPantographOverheadEquipment
			class="edge-detail"
			data-blueprint-part="lines-pantograph-overhead-equipment"
			style="top:4%;left:54%;width:46%;height:42%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
		<BlueprintSignallingCommunicationsEquipment
			class="edge-detail"
			data-blueprint-part="lines-signalling-communications-equipment"
			style="top:20%;left:64%;width:36%;height:20%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
	{/snippet}
</BlueprintShell>
