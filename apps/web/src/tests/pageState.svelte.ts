/** A stable reactive page object, like Kit 3's $app/state export. */
export function createPageState<T extends object>(initial: T) {
	const page = $state(initial);
	return {
		page,
		set(next: T) {
			Object.assign(page, next);
		},
		update(change: (current: T) => T) {
			Object.assign(page, change(page));
		},
	};
}
