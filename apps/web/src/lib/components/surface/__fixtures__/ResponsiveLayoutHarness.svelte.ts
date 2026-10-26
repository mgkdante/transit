let desktop = $state(false);

export const responsiveLayoutHarness = {
	get current(): boolean {
		return desktop;
	},
	setDesktop(next: boolean): void {
		desktop = next;
	},
};
