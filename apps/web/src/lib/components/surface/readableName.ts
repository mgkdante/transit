/** Reveal clamped names on touch before the enclosing row activates. */
export function readableName(node: HTMLElement) {
	let touch = false;
	const down = (event: PointerEvent) => {
		touch = event.pointerType === 'touch';
	};
	const click = (event: MouseEvent) => {
		if (
			!touch ||
			node.dataset.expanded ||
			(node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		node.dataset.expanded = 'true';
	};
	node.addEventListener('pointerdown', down);
	node.addEventListener('click', click, true);
	return {
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('click', click, true);
		},
	};
}
