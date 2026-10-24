import { reconcileActiveToc, revealTocTarget, type TocEntry } from '$lib/components/shared/toc';

interface ArticleSection {
	id: string;
	title: string;
	number: number;
	present: boolean;
}

interface ArticleNavigationOptions {
	openSignal: () => number;
	behavior: () => ScrollBehavior;
	reconcileEmpty?: () => boolean;
}

export function createArticleNavigation(
	sections: () => readonly ArticleSection[],
	options: ArticleNavigationOptions,
) {
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
	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	let navigationGeneration = 0;
	let previousTocIds: string[] = [];

	function openCard(id: string): void {
		cardOpenSignals = { ...cardOpenSignals, [id]: (cardOpenSignals[id] ?? 0) + 1 };
	}

	$effect(() => {
		const next = entries.map((entry) => entry.id);
		if (next.length === 0 && options.reconcileEmpty?.() === false) return;
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});

	return {
		get entries() {
			return entries;
		},
		get activeId() {
			return activeId;
		},
		set activeId(id: string) {
			activeId = id;
		},
		cardOpenSignal(id: string): number {
			return options.openSignal() + (cardOpenSignals[id] ?? 0);
		},
		async navigate(id: string): Promise<void> {
			const generation = ++navigationGeneration;
			await revealTocTarget(id, {
				beforeReveal: entries.some((entry) => entry.id === id) ? openCard : undefined,
				isCurrent: () => generation === navigationGeneration,
				behavior: options.behavior(),
			});
		},
	};
}
