const QUERY = '(min-width: 1024px)';

let desktop = $state(typeof window !== 'undefined' && window.matchMedia(QUERY).matches);

if (typeof window !== 'undefined') {
	window.matchMedia(QUERY).addEventListener('change', (e: MediaQueryListEvent) => {
		desktop = e.matches;
	});
}

export const layout = {
	get isDesktop(): boolean {
		return desktop;
	},
};

export function isDesktopViewport(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(QUERY).matches;
}
