<!--
  MetricsBlueprint — the /metrics article-header blueprint art (P5-R R3).

  The yesid BlogBlueprint composition grammar on transit's own subject: the
  Bridge elevation is the hero drawing (the big measured structure — this page
  measures the network), with track plan / catenary / bogie / station-section /
  signal edge details at drafting opacities. BlueprintShell owns crosshairs,
  reference labels, the light-mode visibility ladder and the aria-hidden
  decoration contract. Drafting labels speak the drawing-title voice on this
  page's actual subject: the measurement methodology.
-->
<script lang="ts">
	import BlueprintShell from '$lib/components/brand/BlueprintShell.svelte';
	import BlueprintBridge from '$lib/components/svg/transit/BlueprintBridge.svelte';
	import BlueprintTrackPlan from '$lib/components/svg/transit/BlueprintTrackPlan.svelte';
	import BlueprintCatenary from '$lib/components/svg/transit/BlueprintCatenary.svelte';
	import BlueprintSignal from '$lib/components/svg/transit/BlueprintSignal.svelte';
	import BlueprintStationSection from '$lib/components/svg/transit/BlueprintStationSection.svelte';
	import BlueprintDetailBogie from '$lib/components/svg/detail/BlueprintDetailBogie.svelte';
</script>

<BlueprintShell labels={['SEC-MES / MÉTHODE', 'DWG: MESURE-RÉSEAU-ELEV', 'SCALE NTS | REV.A']}>
	{#snippet hero()}
		<BlueprintBridge class="h-full w-full" />
	{/snippet}

	{#snippet details()}
		<BlueprintTrackPlan
			class="edge-detail"
			style="top:2%;left:0;width:45%;height:50%;opacity:0.18;"
		/>
		<BlueprintCatenary
			class="edge-detail"
			style="top:0;right:0;width:48%;height:42%;opacity:0.16;"
		/>
		<BlueprintDetailBogie
			class="edge-detail"
			style="bottom:2%;left:2%;width:22%;height:42%;opacity:0.16;"
		/>
		<BlueprintStationSection
			class="edge-detail"
			style="bottom:0;left:28%;width:35%;height:52%;opacity:0.14;"
		/>
		<BlueprintSignal
			class="edge-detail"
			style="bottom:4%;right:8%;width:10%;height:58%;opacity:0.20;"
		/>
	{/snippet}
</BlueprintShell>
