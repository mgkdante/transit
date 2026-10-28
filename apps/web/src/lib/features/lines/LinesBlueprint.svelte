<script lang="ts">
	import { page } from '$app/state';
	import { BlueprintShell } from '@yesid/ui/brand';
	import {
		BlueprintBridge,
		BlueprintBusSide,
		BlueprintTrackPlan,
		BlueprintCatenary,
		BlueprintMr73Side,
		BlueprintPantographOverheadEquipment,
		BlueprintRailGaugeSection,
		BlueprintSignal,
		BlueprintSignallingCommunicationsEquipment,
		BlueprintTurnoutCrossoverPlan,
		BlueprintDetailBogie,
	} from '@yesid/ui/blueprints';
	import { getLocale } from '$lib/i18n';

	const locale = getLocale();
	const operator = $derived(page.data?.provider?.labels[locale].operator ?? 'STM');
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
			style="top:-10%;left:20%;width:55%;height:50%;--blueprint-part-ink:var(--blueprint-ink-mid);"
		/>
		<BlueprintCatenary
			class="edge-detail"
			data-blueprint-part="lines-catenary"
			style="top:-4%;left:52%;width:48%;height:48%;--blueprint-part-ink:var(--blueprint-ink-accent);"
		/>
		{#if (page.data?.providerId ?? 'stm') === 'stm'}<BlueprintMr73Side
				class="edge-detail"
				data-blueprint-part="lines-metro-car"
				style="top:-18%;left:-4%;width:58%;height:65%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
			/>{/if}
		<BlueprintBusSide
			{operator}
			class="edge-detail"
			data-blueprint-part="lines-bus"
			style="top:-2%;left:30%;width:50%;height:60%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintDetailBogie
			class="edge-detail"
			data-blueprint-part="lines-bogie"
			style="top:2%;left:2%;width:30%;height:30%;--blueprint-part-ink:var(--blueprint-ink-quiet);"
		/>
		<BlueprintSignal
			class="edge-detail"
			data-blueprint-part="lines-signal"
			style="top:0;left:8%;width:24%;height:27%;--blueprint-part-ink:var(--blueprint-ink-accent);"
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
