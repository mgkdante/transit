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
	readonly showNativeTooltip: boolean;
	notePointerSource(event: PointerEvent): void;
	activate(event: MouseEvent, model: ChartDatumPopoverModel): boolean;
	close(): void;
}

type ChartDatumPointerSource = 'mouse' | 'touch' | 'pen';

let popoverSequence = 0;

function recognizedPointerSource(pointerType: string | undefined): ChartDatumPointerSource | null {
	if (pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen') {
		return pointerType;
	}
	return null;
}

export function createChartDatumPopover(): ChartDatumPopoverController {
	const id = `chart-datum-popover-${++popoverSequence}`;
	let open = $state(false);
	let model = $state<ChartDatumPopoverModel | null>(null);
	let x = $state(0);
	let y = $state(0);
	let pointerSource = $state<ChartDatumPointerSource>('mouse');
	const closePopover = (): void => {
		open = false;
		model = null;
	};

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
		get showNativeTooltip() {
			return pointerSource === 'mouse';
		},
		notePointerSource(event: PointerEvent): void {
			const nextSource = recognizedPointerSource(event.pointerType);
			if (!nextSource) return;

			pointerSource = nextSource;
			if (nextSource === 'mouse') closePopover();
		},
		activate(event: MouseEvent, nextModel: ChartDatumPopoverModel): boolean {
			const pointerType = (event as Partial<PointerEvent>).pointerType;
			const explicitSource = recognizedPointerSource(pointerType);
			if (explicitSource) pointerSource = explicitSource;

			const hasUnknownPointerType = typeof pointerType === 'string' && pointerType.length > 0;
			const activationSource = explicitSource ?? (hasUnknownPointerType ? null : pointerSource);
			if (activationSource !== 'touch' && activationSource !== 'pen') return false;

			x = event.clientX;
			y = event.clientY;
			model = nextModel;
			open = true;
			return true;
		},
		close(): void {
			closePopover();
		},
	};
}

export function chartDatumPopoverBoundary(
	node: HTMLElement,
	controller: ChartDatumPopoverController,
): { destroy(): void } {
	const note = (event: PointerEvent): void => controller.notePointerSource(event);
	node.addEventListener('pointerover', note, true);
	node.addEventListener('pointerdown', note, true);

	return {
		destroy(): void {
			node.removeEventListener('pointerover', note, true);
			node.removeEventListener('pointerdown', note, true);
		},
	};
}
