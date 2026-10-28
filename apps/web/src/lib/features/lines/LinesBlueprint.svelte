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
		<BlueprintBridge class="h-full w-full" />
	{/snippet}

	{#snippet details()}
		<BlueprintTrackPlan class="edge-detail" style="top:-10%;left:20%;width:55%;height:50%;" />
		<BlueprintCatenary class="edge-detail" style="top:-4%;left:52%;width:48%;height:48%;" />
		{#if (page.data?.providerId ?? 'stm') === 'stm'}<BlueprintMr73Side
				class="edge-detail"
				style="top:-18%;left:-4%;width:58%;height:65%;"
			/>{/if}
		<BlueprintBusSide
			{operator}
			class="edge-detail"
			style="top:-2%;left:30%;width:50%;height:60%;"
		/>
		<BlueprintDetailBogie class="edge-detail" style="top:2%;left:2%;width:30%;height:30%;" />
		<BlueprintSignal class="edge-detail" style="top:0;left:8%;width:24%;height:27%;" />
		<BlueprintTurnoutCrossoverPlan
			class="edge-detail"
			style="top:0;left:24%;width:52%;height:44%;"
		/>
		<BlueprintRailGaugeSection class="edge-detail" style="top:36%;left:0;width:34%;height:24%;" />
		<BlueprintPantographOverheadEquipment
			class="edge-detail"
			style="top:4%;left:54%;width:46%;height:42%;"
		/>
		<BlueprintSignallingCommunicationsEquipment
			class="edge-detail"
			style="top:20%;left:64%;width:36%;height:20%;"
		/>
	{/snippet}
</BlueprintShell>
