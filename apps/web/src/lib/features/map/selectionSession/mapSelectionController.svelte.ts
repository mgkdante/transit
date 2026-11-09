import { emptyHistory, visit, travel } from './detailNavigation';
import { sameNullableSelection, type MapSelection } from './mapSelection';

export interface MapSelectionController {
	get selected(): MapSelection | null;
	get hovered(): MapSelection | null;
	get stack(): readonly MapSelection[];
	get detailOpen(): boolean;
	set detailOpen(next: boolean);
	selectPicked(next: MapSelection): void;
	selectFromDetail(next: MapSelection): void;
	setHovered(next: MapSelection | null): boolean;
	goBack(): boolean;
	goForward(): boolean;
	get canGoForward(): boolean;
	close(): void;
}

export function createMapSelectionController(): MapSelectionController {
	let selected = $state<MapSelection | null>(null);
	let hovered = $state<MapSelection | null>(null);
	let history = $state(emptyHistory());
	const stack = $derived(history.entries.slice(0, history.cursor));
	let detailOpen = $state(false);

	function selectPicked(next: MapSelection): void {
		history = visit(history, next);
		selected = next;
		detailOpen = true;
	}

	function selectFromDetail(next: MapSelection): void {
		history = visit(history, next);
		selected = next;
		detailOpen = true;
	}

	function setHovered(next: MapSelection | null): boolean {
		if (sameNullableSelection(hovered, next)) return false;
		hovered = next;
		return true;
	}

	function goBack(): boolean {
		const next = travel(history, -1);
		if (next === history) return false;
		history = next;
		selected = history.entries[history.cursor];
		detailOpen = true;
		return true;
	}

	function goForward(): boolean {
		const next = travel(history, 1);
		if (next === history) return false;
		history = next;
		selected = history.entries[history.cursor];
		detailOpen = true;
		return true;
	}

	function close(): void {
		detailOpen = false;
		selected = null;
		history = emptyHistory();
	}

	return {
		get selected() {
			return selected;
		},
		get hovered() {
			return hovered;
		},
		get stack() {
			return stack;
		},
		get detailOpen() {
			return detailOpen;
		},
		set detailOpen(next: boolean) {
			if (next) detailOpen = true;
			else close();
		},
		selectPicked,
		selectFromDetail,
		setHovered,
		goBack,
		goForward,
		get canGoForward() {
			return history.cursor < history.entries.length - 1;
		},
		close,
	};
}
