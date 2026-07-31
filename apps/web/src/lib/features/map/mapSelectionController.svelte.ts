import { sameNullableSelection, sameSelection, type MapSelection } from './mapSelection';

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
	close(): void;
}

/** Owns selection transitions while MapHero retains picking, resolution, and camera work. */
export function createMapSelectionController(): MapSelectionController {
	let selected = $state<MapSelection | null>(null);
	let hovered = $state<MapSelection | null>(null);
	let stack = $state<MapSelection[]>([]);
	let detailOpen = $state(false);

	function selectPicked(next: MapSelection): void {
		stack = [];
		selected = next;
		detailOpen = true;
	}

	function selectFromDetail(next: MapSelection): void {
		if (selected && !sameSelection(selected, next)) stack = [...stack, selected];
		selected = next;
		detailOpen = true;
	}

	function setHovered(next: MapSelection | null): boolean {
		if (sameNullableSelection(hovered, next)) return false;
		hovered = next;
		return true;
	}

	function goBack(): boolean {
		const previous = stack.at(-1);
		if (!previous) return false;
		stack = stack.slice(0, -1);
		selected = previous;
		detailOpen = true;
		return true;
	}

	function close(): void {
		detailOpen = false;
		selected = null;
		stack = [];
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
		close,
	};
}
