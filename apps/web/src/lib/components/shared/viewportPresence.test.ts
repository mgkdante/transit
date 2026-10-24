import { afterEach, describe, expect, it } from 'vitest';
import { findScrollParent } from './viewportPresence';

afterEach(() => {
	document.body.replaceChildren();
});

describe('findScrollParent', () => {
	it('finds the nearest internal vertical auto scroller through a non-scrolling parent', () => {
		const scroller = document.createElement('main');
		scroller.style.overflowY = 'auto';
		const wrapper = document.createElement('div');
		const target = document.createElement('section');
		wrapper.append(target);
		scroller.append(wrapper);
		document.body.append(scroller);

		expect(findScrollParent(target)).toBe(scroller);
	});
});
