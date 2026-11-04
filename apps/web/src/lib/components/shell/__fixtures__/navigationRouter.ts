import type { createNavigationLifecycle } from '@yesid/ui/brand';

type Router = Parameters<typeof createNavigationLifecycle>[0];
type Navigation = Parameters<Parameters<Router['beforeNavigate']>[0]>[0];

export function createNavigationRouter() {
	const before = new Set<Parameters<Router['beforeNavigate']>[0]>();
	const during = new Set<Parameters<Router['onNavigate']>[0]>();
	const after = new Set<Parameters<Router['afterNavigate']>[0]>();
	const router: Router = {
		beforeNavigate: (callback) => {
			before.add(callback);
		},
		onNavigate: (callback) => {
			during.add(callback);
		},
		afterNavigate: (callback) => {
			after.add(callback);
		},
	};
	return {
		router,
		async navigate(start: Navigation, commit = start) {
			for (const callback of before) callback(start);
			for (const callback of during) await callback(commit);
			for (const callback of after) callback(commit);
		},
	};
}
