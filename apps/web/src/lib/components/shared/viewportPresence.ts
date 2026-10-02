export function findScrollParent(el: HTMLElement): HTMLElement | null {
	let node = el.parentElement;
	while (node) {
		const overflowY = getComputedStyle(node).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') return node;
		node = node.parentElement;
	}
	return null;
}

export function observeViewportPresence(
	node: HTMLElement,
	initialOnChange: (visible: boolean) => void,
): { update: (onChange: (visible: boolean) => void) => void; destroy: () => void } {
	let onChange = initialOnChange;
	if (typeof IntersectionObserver === 'undefined') {
		onChange(true);
		return {
			update(next) {
				onChange = next;
				onChange(true);
			},
			destroy() {},
		};
	}

	const observer = new IntersectionObserver(([entry]) => onChange(entry?.isIntersecting ?? false), {
		root: findScrollParent(node),
		threshold: 0,
	});
	observer.observe(node);

	return {
		update(next) {
			onChange = next;
		},
		destroy() {
			observer.disconnect();
		},
	};
}
