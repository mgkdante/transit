import { afterNavigate } from '$app/navigation';
import { useSectionJump, type TocEntry } from '@yesid/ui/brand';

interface ArticleSection {
	id: string;
	title: string;
	number: number;
	present: boolean;
}
interface ArticleNavigationOptions {
	behavior: () => ScrollBehavior;
	reconcileEmpty?: () => boolean;
}

export function createArticleNavigation(
	sections: () => readonly ArticleSection[],
	options: ArticleNavigationOptions,
) {
	const navigation = useSectionJump(afterNavigate);
	const entries = $derived<TocEntry[]>(
		sections()
			.filter((section) => section.present)
			.map((section) => ({
				id: section.id,
				title: section.title,
				level: 2,
				badge: { kind: 'number' as const, value: section.number },
				children: [],
			})),
	);
	// Keep the previous registration while an asynchronous section list is temporarily empty.
	let registeredEntries = $state<TocEntry[]>([]);
	$effect(() => {
		if (entries.length || options.reconcileEmpty?.() !== false) registeredEntries = entries;
	});
	return {
		navigation,
		get entries() {
			return entries;
		},
		get registeredEntries() {
			return registeredEntries;
		},
		navigate: (id: string) => navigation.jump(id, { behavior: options.behavior() }),
	};
}
