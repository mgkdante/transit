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
	notePointerSource(event: PointerEvent, trigger?: HTMLElement): void;
	activate(event: MouseEvent, model: ChartDatumPopoverModel): boolean;
	close(restoreFocus?: boolean): void;
}

type ChartDatumPointerSource = 'mouse' | 'touch' | 'pen';
type ChartDatumTrigger = HTMLElement | SVGElement;

interface TriggerState {
	readonly element: ChartDatumTrigger;
	readonly controls: string | null;
	readonly expanded: string | null;
	readonly managesExpanded: boolean;
}

let popoverSequence = 0;

function recognizedPointerSource(pointerType: string | undefined): ChartDatumPointerSource | null {
	if (pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen') {
		return pointerType;
	}
	return null;
}

function triggerFrom(value: EventTarget | null): ChartDatumTrigger | null {
	if (value instanceof HTMLElement) return value;
	if (typeof SVGElement !== 'undefined' && value instanceof SVGElement) return value;
	return null;
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
	if (value == null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

export function createChartDatumPopover(): ChartDatumPopoverController {
	const id = `chart-datum-popover-${++popoverSequence}`;
	let open = $state(false);
	let model = $state<ChartDatumPopoverModel | null>(null);
	let x = $state(0);
	let y = $state(0);
	let pointerSource = $state<ChartDatumPointerSource>('mouse');
	let preferredTrigger: HTMLElement | null = null;
	let activeTrigger: TriggerState | null = null;

	const releaseTrigger = (restoreFocus: boolean): void => {
		const state = activeTrigger;
		activeTrigger = null;
		if (!state) return;

		restoreAttribute(state.element, 'aria-controls', state.controls);
		if (state.managesExpanded) restoreAttribute(state.element, 'aria-expanded', state.expanded);
		if (!restoreFocus || !state.element.isConnected) return;

		const tabindex = state.element.getAttribute('tabindex');
		if (!state.element.matches('button, a[href], input, select, textarea, [tabindex]')) {
			state.element.setAttribute('tabindex', '-1');
		}
		state.element.focus({ preventScroll: true });
		restoreAttribute(state.element, 'tabindex', tabindex);
	};

	const associateTrigger = (element: ChartDatumTrigger | null): void => {
		if (!element || activeTrigger?.element === element) return;
		releaseTrigger(false);
		const managesExpanded = element.matches('button, [role="button"]');
		activeTrigger = {
			element,
			controls: element.getAttribute('aria-controls'),
			expanded: element.getAttribute('aria-expanded'),
			managesExpanded,
		};
		element.setAttribute('aria-controls', id);
		if (managesExpanded) element.setAttribute('aria-expanded', 'true');
	};

	const closePopover = (restoreFocus = true): void => {
		open = false;
		model = null;
		releaseTrigger(restoreFocus);
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
		notePointerSource(event: PointerEvent, trigger?: HTMLElement): void {
			const nextSource = recognizedPointerSource(event.pointerType);
			if (!nextSource) return;

			pointerSource = nextSource;
			if (nextSource === 'touch' || nextSource === 'pen') {
				preferredTrigger = trigger ?? preferredTrigger;
			}
			if (nextSource === 'mouse') closePopover(false);
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
			associateTrigger(
				preferredTrigger ?? triggerFrom(event.currentTarget) ?? triggerFrom(event.target),
			);
			model = nextModel;
			open = true;
			return true;
		},
		close(restoreFocus = true): void {
			closePopover(restoreFocus);
		},
	};
}

export function chartDatumPopoverBoundary(
	node: HTMLElement,
	controller: ChartDatumPopoverController,
): { destroy(): void } {
	const note = (event: PointerEvent): void => controller.notePointerSource(event, node);
	node.addEventListener('pointerover', note, true);
	node.addEventListener('pointerdown', note, true);
	node.addEventListener('click', note, true);

	return {
		destroy(): void {
			node.removeEventListener('pointerover', note, true);
			node.removeEventListener('pointerdown', note, true);
			node.removeEventListener('click', note, true);
		},
	};
}
