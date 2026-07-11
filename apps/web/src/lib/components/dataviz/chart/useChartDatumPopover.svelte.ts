export interface ChartDatumPopoverRow {
	readonly label: string;
	readonly value: string;
	readonly colorVar?: string;
}

export interface ChartDatumPopoverAction {
	readonly href: string;
	readonly label: string;
	readonly ariaLabel: string;
}

export interface ChartDatumPopoverModel {
	readonly key: string;
	readonly heading: string;
	readonly meta?: string;
	readonly rows: readonly ChartDatumPopoverRow[];
	readonly action?: ChartDatumPopoverAction;
}

export interface ChartDatumPopoverController {
	readonly id: string;
	readonly open: boolean;
	readonly model: ChartDatumPopoverModel | null;
	readonly x: number;
	readonly y: number;
	activate(event: MouseEvent, model: ChartDatumPopoverModel): boolean;
	close(): void;
}

let popoverSequence = 0;

export function createChartDatumPopover(): ChartDatumPopoverController {
	const id = `chart-datum-popover-${++popoverSequence}`;
	let open = $state(false);
	let model = $state<ChartDatumPopoverModel | null>(null);
	let x = $state(0);
	let y = $state(0);

	return {
		get id() {
			return id;
		},
		get open() {
			return open;
		},
		get model() {
			return model;
		},
		get x() {
			return x;
		},
		get y() {
			return y;
		},
		activate(event: MouseEvent, nextModel: ChartDatumPopoverModel): boolean {
			const pointerType = (event as PointerEvent).pointerType;
			if (pointerType !== 'touch' && pointerType !== 'pen') return false;

			x = event.clientX;
			y = event.clientY;
			model = nextModel;
			open = true;
			return true;
		},
		close(): void {
			open = false;
			model = null;
		},
	};
}
