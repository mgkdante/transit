import { browser } from '$app/environment';

export const REFRESH_INVALIDATE_TIMEOUT_MS = 8_000;

let epoch = $state(0);
let refreshing = $state(false);
async function invalidateAllBounded(): Promise<void> {
	let done = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	await new Promise<void>((resolve) => {
		const finish = () => {
			if (done) return;
			done = true;
			if (timeoutId) clearTimeout(timeoutId);
			resolve();
		};

		timeoutId = setTimeout(finish, REFRESH_INVALIDATE_TIMEOUT_MS);
		void import('$app/navigation')
			.then(({ invalidateAll }) => invalidateAll())
			.catch(() => undefined)
			.finally(finish);
	});
}

export const dataRefresh = {
	get epoch(): number {
		return epoch;
	},
	get refreshing(): boolean {
		return refreshing;
	},
	bumpEpoch(): void {
		if (!browser) return;
		epoch += 1;
	},
	async run(): Promise<void> {
		if (!browser || refreshing) return;
		refreshing = true;
		try {
			epoch += 1;
			await invalidateAllBounded();
		} finally {
			refreshing = false;
		}
	},
};
