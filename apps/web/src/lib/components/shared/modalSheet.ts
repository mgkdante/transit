export interface ModalSheetOptions {
	active: boolean;
	trigger?: HTMLElement;
	exempt?: readonly Element[];
	onDismiss: () => void;
}

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])',
].join(',');

interface InertSnapshot {
	element: Element;
	wasInert: boolean;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
	return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(element) =>
			!element.hidden &&
			element.getAttribute('aria-hidden') !== 'true' &&
			element.getAttribute('aria-disabled') !== 'true' &&
			element.closest('[inert]') == null,
	);
}

function isolateBackground(dialog: HTMLElement, exempt: readonly Element[]): () => void {
	const snapshots: InertSnapshot[] = [];
	let branch: Element = dialog;
	let parent = branch.parentElement;

	while (parent) {
		for (const sibling of parent.children) {
			if (
				sibling === branch ||
				sibling.contains(dialog) ||
				exempt.includes(sibling) ||
				sibling.hasAttribute('data-modal-sheet-exempt')
			) {
				continue;
			}
			const wasInert = sibling.hasAttribute('inert');
			snapshots.push({ element: sibling, wasInert });
			sibling.setAttribute('inert', '');
		}

		if (parent === document.body) break;
		branch = parent;
		parent = parent.parentElement;
	}

	return () => {
		for (const { element, wasInert } of snapshots) {
			if (!wasInert) element.removeAttribute('inert');
		}
	};
}

/**
 * Shared modal behavior for the mobile listing-filter and article-rail sheets.
 * Presentation stays component-owned; focus, keyboard, scroll, and background
 * isolation are one contract.
 */
export function modalSheet(node: HTMLElement, initialOptions: ModalSheetOptions) {
	let options = initialOptions;
	let deactivate: (() => void) | undefined;

	function activate(): () => void {
		const restoreBackground = isolateBackground(node, options.exempt ?? []);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		let active = true;

		const onKeydown = (event: KeyboardEvent): void => {
			if (!options.active) return;

			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				const trigger = options.trigger;
				options.onDismiss();
				queueMicrotask(() => trigger?.focus());
				return;
			}

			if (event.key !== 'Tab') return;
			const focusable = focusableElements(node);
			if (focusable.length === 0) {
				event.preventDefault();
				node.focus();
				return;
			}

			const first = focusable[0];
			const last = focusable.at(-1);
			const focused = document.activeElement;
			if (event.shiftKey && (focused === first || !node.contains(focused))) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && (focused === last || !node.contains(focused))) {
				event.preventDefault();
				first?.focus();
			}
		};

		window.addEventListener('keydown', onKeydown, true);
		queueMicrotask(() => {
			if (!active || !options.active) return;
			(focusableElements(node)[0] ?? node).focus();
		});

		return () => {
			active = false;
			window.removeEventListener('keydown', onKeydown, true);
			document.body.style.overflow = previousOverflow;
			restoreBackground();
		};
	}

	function sync(): void {
		if (options.active && !deactivate) deactivate = activate();
		else if (!options.active && deactivate) {
			deactivate();
			deactivate = undefined;
		}
	}

	sync();

	return {
		update(nextOptions: ModalSheetOptions): void {
			options = nextOptions;
			sync();
		},
		destroy(): void {
			deactivate?.();
			deactivate = undefined;
		},
	};
}
