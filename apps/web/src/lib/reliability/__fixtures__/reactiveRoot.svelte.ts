export function stateCell<T>(initial: T) {
	let value = $state.raw(initial);
	return {
		get value() {
			return value;
		},
		set value(next: T) {
			value = next;
		},
	};
}

export function reactiveRoot<T>(create: () => T) {
	let value!: T;
	const destroy = $effect.root(() => {
		value = create();
	});
	return { value, destroy };
}
