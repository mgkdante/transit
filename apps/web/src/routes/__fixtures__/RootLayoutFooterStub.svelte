<script lang="ts">
	let {
		attribution,
	}: {
		attribution?: string;
	} = $props();
</script>

<footer data-testid="root-layout-footer">{attribution ?? ''}</footer>
