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
	notePointerSource(event: PointerEvent | MouseEvent, trigger?: HTMLElement): void;
	openFromTrigger(trigger: HTMLElement | SVGElement, model: ChartDatumPopoverModel): void;
	activate(event: MouseEvent, model: ChartDatumPopoverModel): boolean;
	close(restoreFocus?: boolean): void;
}

type ChartDatumPointerSource = 'mouse' | 'touch' | 'pen';
type ChartDatumTrigger = HTMLElement | SVGElement;

interface PendingGesture {
	readonly source: 'touch' | 'pen';
	readonly pointerId: number;
	readonly target: WeakRef<Element>;
	phase: 'down' | 'released' | 'mouseDownBeforeUp' | 'mouseDown' | 'mouseUp';
}

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

function isFocusableTrigger(element: Element): boolean {
	return element.matches('button, a[href], input, select, textarea, [tabindex]');
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
	let pendingGesture: PendingGesture | null = null;
	const gestureClickSources = new WeakMap<Event, 'touch' | 'pen'>();
	const sameGestureTarget = (target: EventTarget | null): boolean => {
		const previous = pendingGesture?.target.deref();
		return previous != null && previous.isConnected && previous === target;
	};

	const releaseTrigger = (restoreFocus: boolean): void => {
		const state = activeTrigger;
		activeTrigger = null;
		if (!state) return;

		restoreAttribute(state.element, 'aria-controls', state.controls);
		if (state.managesExpanded) restoreAttribute(state.element, 'aria-expanded', state.expanded);
		if (!restoreFocus || !state.element.isConnected) return;

		const tabindex = state.element.getAttribute('tabindex');
		if (!isFocusableTrigger(state.element)) {
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
		if (pendingGesture) {
			pendingGesture = null;
			pointerSource = 'mouse';
		}
		open = false;
		model = null;
		releaseTrigger(restoreFocus);
	};
	const openFromTrigger = (trigger: ChartDatumTrigger, nextModel: ChartDatumPopoverModel): void => {
		const rect = trigger.getBoundingClientRect();
		x = rect.left + rect.width / 2;
		y = rect.top + rect.height / 2;
		associateTrigger(trigger);
		model = nextModel;
		open = true;
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
			return pointerSource === 'mouse' && !open;
		},
		notePointerSource(event: PointerEvent | MouseEvent, trigger?: HTMLElement): void {
			const nextSource = recognizedPointerSource(
				'pointerType' in event ? event.pointerType : undefined,
			);
			if (event.type === 'mousedown' || event.type === 'mouseup') {
				const phase = pendingGesture?.phase;
				if (
					pendingGesture &&
					sameGestureTarget(event.target) &&
					(event.type === 'mousedown'
						? phase === 'down' || phase === 'released'
						: phase === 'mouseDown')
				) {
					pendingGesture.phase =
						event.type === 'mouseup'
							? 'mouseUp'
							: phase === 'down'
								? 'mouseDownBeforeUp'
								: 'mouseDown';
				} else {
					pendingGesture = null;
					pointerSource = 'mouse';
					closePopover(false);
				}
				return;
			}
			if (event.type === 'pointercancel') {
				if (pendingGesture?.pointerId === (event as PointerEvent).pointerId) {
					pendingGesture = null;
					pointerSource = 'mouse';
				}
				return;
			}
			if (event.type === 'pointerup') {
				if (
					(pendingGesture?.phase === 'down' || pendingGesture?.phase === 'mouseDownBeforeUp') &&
					pendingGesture.pointerId === (event as PointerEvent).pointerId &&
					pendingGesture.source === nextSource &&
					sameGestureTarget(event.target)
				) {
					pendingGesture.phase =
						pendingGesture.phase === 'mouseDownBeforeUp' ? 'mouseDown' : 'released';
				} else {
					pendingGesture = null;
				}
				return;
			}
			if (event.type === 'pointerdown') {
				pendingGesture =
					(nextSource === 'touch' || nextSource === 'pen') && event.target instanceof Element
						? {
								source: nextSource,
								pointerId: (event as PointerEvent).pointerId,
								target: new WeakRef(event.target),
								phase: 'down',
							}
						: null;
			}
			if (event.type === 'click') {
				if (
					nextSource === 'mouse' &&
					pendingGesture?.phase === 'mouseUp' &&
					sameGestureTarget(event.target)
				) {
					gestureClickSources.set(event, pendingGesture.source);
					pointerSource = 'mouse';
					pendingGesture = null;
					return;
				}
				pendingGesture = null;
			}
			if (!nextSource) return;
			if (event.type === 'pointerover' && nextSource === 'mouse') pendingGesture = null;

			pointerSource = nextSource;
			if (nextSource === 'touch' || nextSource === 'pen') {
				preferredTrigger = trigger ?? preferredTrigger;
			}
			if (nextSource === 'mouse') closePopover(false);
		},
		openFromTrigger,
		activate(event: MouseEvent, nextModel: ChartDatumPopoverModel): boolean {
			const gestureSource = gestureClickSources.get(event);
			gestureClickSources.delete(event);
			pendingGesture = null;
			const pointerType = (event as Partial<PointerEvent>).pointerType;
			const explicitSource = recognizedPointerSource(pointerType);
			if (explicitSource) pointerSource = explicitSource;

			const hasUnknownPointerType = typeof pointerType === 'string' && pointerType.length > 0;
			const activationSource =
				gestureSource ?? explicitSource ?? (hasUnknownPointerType ? null : pointerSource);
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
	const originalTabindex = node.getAttribute('tabindex');
	if (!isFocusableTrigger(node)) node.setAttribute('tabindex', '-1');
	const note = (event: PointerEvent | MouseEvent): void =>
		controller.notePointerSource(event, node);
	node.addEventListener('pointerover', note, true);
	node.addEventListener('pointerdown', note, true);
	node.addEventListener('pointerup', note, true);
	node.addEventListener('pointercancel', note, true);
	node.addEventListener('mousedown', note, true);
	node.addEventListener('mouseup', note, true);
	node.addEventListener('click', note, true);

	return {
		destroy(): void {
			node.removeEventListener('pointerover', note, true);
			node.removeEventListener('pointerdown', note, true);
			node.removeEventListener('pointerup', note, true);
			node.removeEventListener('pointercancel', note, true);
			node.removeEventListener('mousedown', note, true);
			node.removeEventListener('mouseup', note, true);
			node.removeEventListener('click', note, true);
			controller.close(false);
			restoreAttribute(node, 'tabindex', originalTabindex);
		},
	};
}
