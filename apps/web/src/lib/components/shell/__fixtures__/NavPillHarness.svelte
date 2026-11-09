<script lang="ts">
	import { untrack, type ComponentProps } from 'svelte';
	import { createNavigationLifecycle } from '@yesid/ui/brand';
	import NavPill from '../NavPill.svelte';
	import { createNavigationRouter } from './navigationRouter';
	let {
		adapter = createNavigationRouter(),
		...props
	}: Omit<ComponentProps<typeof NavPill>, 'navigation'> & {
		adapter?: ReturnType<typeof createNavigationRouter>;
	} = $props();
	const navigation = untrack(() =>
		createNavigationLifecycle({
			...adapter.router,
		}),
	);
</script>

<NavPill {...props} {navigation} />
