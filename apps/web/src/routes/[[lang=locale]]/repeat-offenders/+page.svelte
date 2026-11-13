<script lang="ts">
	import RepeatOffenders from '#lib/features/repeat-offenders/RepeatOffenders.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<RepeatOffenders manifest={data.v1?.manifest} />
