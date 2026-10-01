export interface ChartTooltipRow {
	colorVar?: string;
	label: string;
	value: string;
}

export interface ChartAxis {
	label?: string;
	unit?: string;
	domain?: [number, number];
}

export type ChartTooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface ChartTooltipShowArgs {
	xPct: number;
	yPct: number;
	heading?: string;
	rows: ChartTooltipRow[];
	side?: ChartTooltipSide;
}

export interface ChartTooltipController {
	readonly open: boolean;
	readonly xPct: number;
	readonly yPct: number;
	readonly heading: string | undefined;
	readonly rows: ChartTooltipRow[];
	readonly side: ChartTooltipSide;
	readonly id: string;
	show(args: ChartTooltipShowArgs): void;
	hide(): void;
}

let tooltipSeq = 0;

export function createChartTooltip(): ChartTooltipController {
	const id = `chart-tooltip-${++tooltipSeq}`;

	let open = $state(false);
	let xPct = $state(0);
	let yPct = $state(0);
	let heading = $state<string | undefined>(undefined);
	let rows = $state<ChartTooltipRow[]>([]);
	let side = $state<ChartTooltipSide>('top');

	return {
		get open() {
			return open;
		},
		get xPct() {
			return xPct;
		},
		get yPct() {
			return yPct;
		},
		get heading() {
			return heading;
		},
		get rows() {
			return rows;
		},
		get side() {
			return side;
		},
		get id() {
			return id;
		},
		show(args: ChartTooltipShowArgs): void {
			xPct = args.xPct;
			yPct = args.yPct;
			heading = args.heading;
			rows = args.rows;
			side = args.side ?? 'top';
			open = true;
		},
		hide(): void {
			open = false;
		},
	};
}
