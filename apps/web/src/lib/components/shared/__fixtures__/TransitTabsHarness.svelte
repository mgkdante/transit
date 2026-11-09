<script lang="ts">
	import { Tabs, TabsContent } from '@yesid/ui/tabs';
	import TransitTabList from '../TransitTabList.svelte';
	let { compact = false } = $props();
	const tabs = [
		{ key: 'detail', label: 'Detail' },
		{ key: 'schedule', label: 'Schedule' },
		{ key: 'reliability', label: 'Reliability' },
	];
</script>

<Tabs value="detail"
	><TransitTabList {tabs} {compact} label="Sections" />{#each tabs as tab (tab.key)}<TabsContent
			value={tab.key}>{tab.label} content</TabsContent
		>{/each}</Tabs
>
