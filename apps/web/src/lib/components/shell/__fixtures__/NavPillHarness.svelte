<script lang="ts">
	import { untrack, type ComponentProps } from 'svelte';
	import { createNavigationLifecycle } from '@yesid/ui/brand';
	import NavPill from '../NavPill.svelte';
	import { createNavigationRouter } from './navigationRouter';
	let {
		adapter = createNavigationRouter(),
		subscription = true,
		...props
	}: Omit<ComponentProps<typeof NavPill>, 'navigation'> & {
		adapter?: ReturnType<typeof createNavigationRouter>;
		subscription?: boolean;
	} = $props();
	const navigation = untrack(() =>
		createNavigationLifecycle({
			...adapter.router,
			subscribeNavigation: subscription ? adapter.router.subscribeNavigation : undefined,
		}),
	);
</script>

<NavPill {...props} {navigation} />
