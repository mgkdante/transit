let desktop = $state(false);

export const responsiveLayoutHarness = {
	get isDesktop(): boolean {
		return desktop;
	},
	setDesktop(next: boolean): void {
		desktop = next;
	},
};
