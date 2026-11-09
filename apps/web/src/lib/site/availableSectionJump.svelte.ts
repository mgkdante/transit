import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { useSectionJump, type TocEntry } from '@yesid/ui/brand';

/** Retain a fragment while its asynchronously loaded content is absent. */
export function useAvailableSectionJump(
	entries: () => readonly TocEntry[],
	additionalTarget: (id: string) => boolean = () => false,
) {
	const navigation = useSectionJump(afterNavigate);
	let pending = $state<string | null>(null);
	let requested: string | null | undefined;
	function readHash() {
		let id: string | null;
		try {
			id = decodeURIComponent(window.location.hash.slice(1)) || null;
		} catch {
			id = null;
		}
		if (id === requested) return;
		requested = id;
		pending = id;
	}
	onMount(() => {
		readHash();
		window.addEventListener('hashchange', readHash);
		return () => window.removeEventListener('hashchange', readHash);
	});
	$effect(() => {
		const id = pending;
		if (!id || (!entries().some((entry) => entry.id === id) && !additionalTarget(id))) return;
		pending = null;
		void navigation.jump(id);
	});
	return {
		navigation,
		navigate(id: string) {
			pending = null;
			return navigation.jump(id);
		},
	};
}
