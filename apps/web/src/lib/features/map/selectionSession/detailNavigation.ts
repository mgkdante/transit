import { sameSelection, type MapSelection } from './mapSelection';

export interface SelectionHistory {
	readonly entries: readonly MapSelection[];
	readonly cursor: number;
}
export const emptyHistory = (): SelectionHistory => ({ entries: [], cursor: -1 });
export function visit(history: SelectionHistory, next: MapSelection): SelectionHistory {
	const current = history.entries[history.cursor];
	if (current && sameSelection(current, next)) return history;
	return {
		entries: [...history.entries.slice(0, history.cursor + 1), next],
		cursor: history.cursor + 1,
	};
}
export function travel(history: SelectionHistory, delta: -1 | 1): SelectionHistory {
	const cursor = history.cursor + delta;
	return cursor < 0 || cursor >= history.entries.length ? history : { ...history, cursor };
}
export function neighbors(selection: MapSelection | null, items: readonly MapSelection[]) {
	const index = selection ? items.findIndex((item) => sameSelection(item, selection)) : -1;
	return {
		previous: index > 0 ? items[index - 1] : null,
		next: index >= 0 ? (items[index + 1] ?? null) : null,
		// One-based place in the stepped list, so the stepper can say where it is.
		position: index >= 0 ? index + 1 : null,
		total: items.length,
	};
}
export function acceptsItemArrow(event: KeyboardEvent): boolean {
	return (
		!event.defaultPrevented &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		(event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
		!(
			event.target instanceof Element &&
			event.target.closest(
				'input, textarea, select, [contenteditable], [role="separator"], [role="tablist"], [role="slider"]',
			)
		)
	);
}
