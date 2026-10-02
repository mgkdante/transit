import { onMount } from 'svelte';
import type { Manifest } from '$lib/v1/schemas';
import type { Resource } from '$lib/v1/resource.svelte';
import { createLiveStore, type LiveFamily, type LiveStore } from './store.svelte';

export function createLiveResource<Family extends LiveFamily>(manifest: Manifest, family: Family) {
	const live = createLiveStore(manifest, { families: [family] });
	onMount(() => {
		live.start();
		return () => live.stop();
	});
	const resource: Resource<LiveStore[Family]> = {
		get data() {
			return live[family];
		},
		get error() {
			return live.error;
		},
		get loading() {
			return live.loading;
		},
		get settled() {
			const phase = live.familyStates[family].phase;
			return phase === 'ready' || phase === 'failed';
		},
		reload() {
			void live.refresh();
		},
	};
	return { live, resource };
}
