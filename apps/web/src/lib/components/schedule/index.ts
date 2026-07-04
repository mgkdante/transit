// $lib/components/schedule — the reusable schedule/departure row-list.
//
// ScheduleTable renders the ONE shared schedule surface in two modes (grid /
// board) over a discriminated row set, extracted from StopDetail's two divergent
// renderings so neither surface forks the markup, the column-major grid, or the
// delay-glyph presentation. Import from `$lib/components/schedule`.

export { default as ScheduleTable } from './ScheduleTable.svelte';
export type {
	ScheduleTableProps,
	ScheduleRow,
	ScheduleGridRow,
	ScheduleBoardRow,
} from './ScheduleTable.svelte';
