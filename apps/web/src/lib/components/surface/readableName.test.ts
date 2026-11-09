import { expect, it } from 'vitest';
import { readableName } from './readableName';
it('reveals a clamped name on first touch tap and lets the next tap activate', () => {
	const node = document.createElement('span');
	Object.defineProperties(node, { scrollHeight: { value: 80 }, clientHeight: { value: 40 } });
	const action = readableName(node);
	node.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
	const first = new MouseEvent('click', { cancelable: true });
	node.dispatchEvent(first);
	expect(first.defaultPrevented).toBe(true);
	expect(node.dataset.expanded).toBe('true');
	const next = new MouseEvent('click', { cancelable: true });
	node.dispatchEvent(next);
	expect(next.defaultPrevented).toBe(false);
	action.destroy();
});
it('preserves mouse navigation even for clamped names', () => {
	const node = document.createElement('span');
	Object.defineProperties(node, { scrollHeight: { value: 80 }, clientHeight: { value: 40 } });
	const action = readableName(node);
	node.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
	const event = new MouseEvent('click', { cancelable: true });
	node.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(false);
	action.destroy();
});
