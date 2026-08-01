import { describe, expect, it, vi } from 'vitest';

import { emptyFilterState } from './state';
import { fromSearchParams, toSearchString } from './url';
import { createFilterStore, type FilterWriteContext, type PushUrl } from './store.svelte';

const claimAsSelection = {
	authority: 'selection',
	ownership: 'claim-new',
} as const satisfies FilterWriteContext;

function fromSearch(search: string) {
	return fromSearchParams(new URLSearchParams(search));
}

describe('filter store selection ownership', () => {
	it('claims only newly inserted chips, so close removes the vehicle but keeps its URL route', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(fromSearch('route=24'), pushUrl);

		store.applyChips(
			[
				{ kind: 'vehicle', value: 'bus-1' },
				{ kind: 'route', value: '24' },
			],
			claimAsSelection,
		);
		expect(toSearchString(store.state)).toBe('route=24&vehicle=bus-1');
		expect(pushUrl).toHaveBeenCalledOnce();

		store.clearSelectionOwned();
		expect(toSearchString(store.state)).toBe('route=24');
		expect(pushUrl).toHaveBeenCalledTimes(2);
		expect(pushUrl).toHaveBeenLastCalledWith('route=24');
	});

	it('preserves selection ownership across an equal navigation echo', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(emptyFilterState(), pushUrl);
		store.applyChips([{ kind: 'stop', value: 'stop-1' }], claimAsSelection);
		const committed = store.state;

		store.replaceFromUrl(fromSearch('stop=stop-1'), 'echo');
		expect(store.state).toBe(committed);
		expect(pushUrl).toHaveBeenCalledOnce();

		store.clearSelectionOwned();
		expect(store.stops.size).toBe(0);
		expect(pushUrl).toHaveBeenLastCalledWith('');
	});

	it('reclassifies an equal genuine URL adoption without cloning or publishing', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(emptyFilterState(), pushUrl);
		store.applyChips([{ kind: 'route', value: '24' }], claimAsSelection);
		const committed = store.state;
		pushUrl.mockClear();

		store.replaceFromUrl(fromSearch('route=24'), 'adopt');
		expect(store.state).toBe(committed);
		expect(pushUrl).not.toHaveBeenCalled();

		store.clearSelectionOwned();
		expect(toSearchString(store.state)).toBe('route=24');
		expect(store.state).toBe(committed);
		expect(pushUrl).not.toHaveBeenCalled();
	});

	it('releases a selection-owned chip on a default user no-op without a clone or URL push', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(emptyFilterState(), pushUrl);
		store.applyChips([{ kind: 'route', value: '24' }], claimAsSelection);
		const committed = store.state;
		pushUrl.mockClear();

		store.addRoute('24');
		expect(store.state).toBe(committed);
		expect(pushUrl).not.toHaveBeenCalled();

		store.clearSelectionOwned();
		expect(toSearchString(store.state)).toBe('route=24');
		expect(pushUrl).not.toHaveBeenCalled();
	});

	it.each([
		['user', 'release-touched', true],
		['selection', 'release-touched', true],
		['user', 'claim-new', false],
		['selection', 'claim-new', false],
	] as const)(
		'keeps authority %s independent from %s ownership',
		(authority, ownership, survivesClose) => {
			const store = createFilterStore(emptyFilterState());
			const context: FilterWriteContext = { authority, ownership };

			store.applyChips([{ kind: 'route', value: '24' }], context);
			store.clearSelectionOwned();

			expect(store.routes.has('24')).toBe(survivesClose);
		},
	);

	it('applies and clears an alert selection as one commit per transaction', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(emptyFilterState(), pushUrl);

		store.applyChips(
			[
				{ kind: 'alert', value: 'has_alert' },
				{ kind: 'route', value: '24' },
				{ kind: 'stop', value: 'stop-1' },
				{ kind: 'stop', value: 'stop-2' },
			],
			claimAsSelection,
		);
		expect(pushUrl).toHaveBeenCalledOnce();
		expect(pushUrl).toHaveBeenLastCalledWith('route=24&stop=stop-1%2Cstop-2&alert=has_alert');

		store.clearSelectionOwned();
		expect(store.isEmpty).toBe(true);
		expect(pushUrl).toHaveBeenCalledTimes(2);
		expect(pushUrl).toHaveBeenLastCalledWith('');
	});

	it('guards the shared commit seam for both granular mutations and URL replacement', () => {
		const pushUrl = vi.fn<PushUrl>();
		const store = createFilterStore(fromSearch('route=24'), pushUrl);
		const initial = store.state;

		store.addRoute('24');
		expect(store.state).toBe(initial);
		store.replaceFromUrl(fromSearch('route=24'), 'adopt');
		expect(store.state).toBe(initial);
		expect(pushUrl).not.toHaveBeenCalled();
	});
});
