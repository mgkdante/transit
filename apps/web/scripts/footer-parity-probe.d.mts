export type FooterParityTheme = 'dark' | 'light';
export type FooterParityLocale = 'en' | 'fr';

export interface FooterParityArgs {
	baseUrl: string;
	outDir: string;
	executablePath?: string;
}

export interface FooterParityScenario {
	id: string;
	width: number;
	theme: FooterParityTheme;
	locale: FooterParityLocale;
	route: '/' | '/fr';
}

export interface HorizontalRect {
	left: number;
	right: number;
	width: number;
}

export interface FooterBleedGeometry {
	footer: HorizontalRect;
	grid: HorizontalRect;
	statusBar: HorizontalRect;
}

export const WIDTHS: readonly number[];
export const THEMES: readonly FooterParityTheme[];

export function parseCliArgs(argv: string[]): FooterParityArgs;
export function buildScenarioMatrix(): FooterParityScenario[];
export function assertFullBleed(geometry: FooterBleedGeometry, tolerance?: number): void;
export function findSystemDateNodeMatch(textNodes: string[]): {
	nodeIndex: number;
	start: number;
	end: number;
	value: string;
};
export function main(argv?: string[]): Promise<void>;
