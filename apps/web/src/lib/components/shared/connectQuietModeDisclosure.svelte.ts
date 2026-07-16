import { untrack } from 'svelte';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

export function connectQuietModeDisclosure(setOpen: (next: boolean) => void): void {
	let lastCloseSignal = untrack(() => quietModeStore.closeSignal);
	let lastOpenSignal = untrack(() => quietModeStore.openSignal);

	untrack(() => setOpen(!quietModeStore.enabled));

	$effect(() => {
		const signal = quietModeStore.closeSignal;
		if (signal === lastCloseSignal) return;
		lastCloseSignal = signal;
		setOpen(false);
	});

	$effect(() => {
		const signal = quietModeStore.openSignal;
		if (signal === lastOpenSignal) return;
		lastOpenSignal = signal;
		setOpen(true);
	});
}
