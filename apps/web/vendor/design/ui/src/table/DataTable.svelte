<!--
  A captioned data table built from column definitions and a cell snippet per column. Below a
  breakpoint it either stacks each row into label/value pairs (`stack`) or scrolls sideways
  (`scroll`); a scrolling table that overflows becomes a focusable region named by its caption.
  Attributes go to the frame; `tableClass` styles the table itself.
-->
<script module lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export type DataTableAlign = 'start' | 'end';
	export type DataTableResponsive =
		| { mode: 'none' }
		| { mode: 'stack'; at: 'compact' | 'tablet' }
		| { mode: 'scroll'; minWidth?: string; minWidthCompact?: string };

	export interface DataTableColumn<T> {
		readonly key: string;
		readonly header: string;
		readonly align?: DataTableAlign;
		readonly numeric?: boolean;
		readonly width?: string;
		readonly rowHeader?: true;
		readonly cell: Snippet<[T]>;
	}

	export interface DataTableProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		readonly rows: readonly T[];
		readonly columns: readonly DataTableColumn<T>[];
		readonly key: (row: T, index: number) => string;
		readonly caption: string;
		readonly responsive?: DataTableResponsive;
		/** `card` draws a rounded, bordered card around the table. */
		readonly frame?: 'none' | 'card';
		readonly borderCollapse?: 'collapse' | 'separate';
		readonly headerBand?: 'none' | 'terminal';
		readonly tableClass?: string;
		readonly class?: string;
	}

	const DEFAULT_RESPONSIVE: DataTableResponsive = { mode: 'none' };
</script>

<script lang="ts" generics="T">
	import { cn } from '../cn/index.js';

	let {
		rows,
		columns,
		key,
		caption,
		responsive = DEFAULT_RESPONSIVE,
		frame = 'none',
		borderCollapse = 'collapse',
		headerBand = 'none',
		tableClass,
		class: className,
		...restProps
	}: DataTableProps<T> = $props();

	let frameElement = $state<HTMLDivElement | null>(null);
	let scrollable = $state(false);

	const accessibleCaption = $derived.by(() => {
		const value = caption.trim();
		if (value.length === 0) {
			throw new Error('DataTable caption must be a non-empty string after trimming.');
		}
		return value;
	});
	const stackAt = $derived(responsive.mode === 'stack' ? responsive.at : undefined);
	const scrollMinWidth = $derived(responsive.mode === 'scroll' ? responsive.minWidth : undefined);
	const scrollMinWidthCompact = $derived(
		responsive.mode === 'scroll' ? responsive.minWidthCompact : undefined,
	);

	function columnAlignment(column: DataTableColumn<T>): DataTableAlign {
		return column.numeric ? 'end' : (column.align ?? 'start');
	}

	function measure(): void {
		const element = frameElement;
		if (!element || responsive.mode !== 'scroll') {
			scrollable = false;
			return;
		}
		scrollable = element.scrollWidth - element.clientWidth > 1;
	}

	$effect(() => {
		const element = frameElement;
		if (!element) return;
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (an overflowing table must be keyboard-scrollable) -->
<div
	bind:this={frameElement}
	class={cn('data-table-frame', className)}
	data-slot="data-table-frame"
	{...restProps}
	data-responsive={responsive.mode}
	data-stack-at={stackAt}
	data-frame={frame}
	data-collapse={borderCollapse}
	data-header-band={headerBand}
	data-scrollable={scrollable}
	style:--dt-min-width={scrollMinWidth}
	style:--dt-min-width-compact={scrollMinWidthCompact}
	role={scrollable ? 'region' : undefined}
	aria-label={scrollable ? accessibleCaption : undefined}
	tabindex={scrollable ? 0 : undefined}
	onscroll={measure}
>
	<table class={cn('data-table', tableClass)} data-slot="data-table">
		<caption class="data-table-caption">{accessibleCaption}</caption>
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th
						scope="col"
						data-column={column.key}
						data-align={columnAlignment(column)}
						data-numeric={column.numeric || undefined}
						style:width={column.width}
					>
						{column.header}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row, index (key(row, index))}
				<tr>
					{#each columns as column (column.key)}
						{#if column.rowHeader}
							<th
								scope="row"
								data-column={column.key}
								data-col={column.header}
								data-align={columnAlignment(column)}
								data-numeric={column.numeric || undefined}
							>
								<div class="data-table-cell-content">{@render column.cell(row)}</div>
							</th>
						{:else}
							<td
								data-column={column.key}
								data-col={column.header}
								data-align={columnAlignment(column)}
								data-numeric={column.numeric || undefined}
							>
								<div class="data-table-cell-content">{@render column.cell(row)}</div>
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.data-table-frame,
	.data-table {
		min-width: 0;
	}

	.data-table-frame {
		width: 100%;
		max-width: 100%;
	}

	.data-table-frame[data-responsive='scroll'] {
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: thin;
		overscroll-behavior-inline: contain;
		touch-action: pan-x pan-y;
	}

	.data-table-frame:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.data-table-frame[data-frame='card'] {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}

	.data-table {
		width: 100%;
		margin: 0;
		border-collapse: collapse;
		font-size: var(--text-small);
		overflow-wrap: anywhere;
	}

	.data-table-frame[data-collapse='separate'] .data-table {
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
	}

	.data-table-frame[data-responsive='scroll'] .data-table {
		min-width: var(--dt-min-width, 100%);
	}

	.data-table-caption {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.data-table-frame[data-header-band='terminal'] .data-table thead {
		background: var(--terminal-chrome);
	}

	.data-table th,
	.data-table td {
		padding: 0.5rem;
		text-align: left;
		vertical-align: top;
	}

	.data-table thead th {
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}

	.data-table tbody th {
		font-weight: 500;
		color: var(--foreground);
	}

	.data-table tbody td {
		font-family: var(--font-mono);
		color: var(--foreground);
	}

	.data-table tbody tr + tr > * {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}

	.data-table [data-align='end'] {
		text-align: right;
	}

	.data-table [data-numeric='true'] {
		font-variant-numeric: tabular-nums;
	}

	.data-table-cell-content {
		min-width: 0;
	}

	@media (max-width: 48rem) {
		.data-table-frame[data-responsive='scroll'] .data-table {
			min-width: var(--dt-min-width-compact, var(--dt-min-width, 100%));
		}
	}

	@media (max-width: 28rem) {
		.data-table-frame[data-stack-at='compact'] .data-table,
		.data-table-frame[data-stack-at='compact'] .data-table :is(thead, tbody, tr, th, td) {
			display: block;
			text-align: left;
			white-space: normal;
		}

		.data-table-frame[data-stack-at='compact'] .data-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		.data-table-frame[data-stack-at='compact'] .data-table tbody tr {
			padding: 0.5rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}

		.data-table-frame[data-stack-at='compact'] .data-table tbody :is(th, td) {
			display: grid;
			grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
			gap: 1rem;
			padding: 0.25rem 0;
			border: 0;
		}

		.data-table-frame[data-stack-at='compact'] .data-table tbody :is(th, td)::before {
			content: attr(data-col);
			grid-column: 1;
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			font-weight: 500;
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}

		.data-table-frame[data-stack-at='compact'] .data-table-cell-content {
			grid-column: 2;
		}

		.data-table-frame[data-stack-at='compact'] [data-align='end'] .data-table-cell-content {
			text-align: right;
		}
	}

	@media (max-width: 1023px) {
		.data-table-frame[data-stack-at='tablet'] .data-table,
		.data-table-frame[data-stack-at='tablet'] .data-table :is(thead, tbody, tr, th, td) {
			display: block;
			text-align: left;
			white-space: normal;
		}

		.data-table-frame[data-stack-at='tablet'] .data-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		.data-table-frame[data-stack-at='tablet'] .data-table tbody tr {
			padding: 0.625rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}

		.data-table-frame[data-stack-at='tablet'] .data-table tbody :is(th, td) {
			display: grid;
			grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
			gap: 1rem;
			padding: 0.25rem 0;
			border: 0;
		}

		.data-table-frame[data-stack-at='tablet'] .data-table tbody :is(th, td)::before {
			content: attr(data-col);
			grid-column: 1;
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			font-weight: 500;
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}

		.data-table-frame[data-stack-at='tablet'] .data-table-cell-content {
			grid-column: 2;
		}

		.data-table-frame[data-stack-at='tablet'] [data-align='end'] .data-table-cell-content {
			text-align: right;
		}

		.data-table-frame[data-stack-at='tablet'][data-frame='card'][data-collapse='separate'] {
			border: 0;
			border-radius: 0;
			background: transparent;
		}

		.data-table-frame[data-stack-at='tablet'][data-frame='card'][data-collapse='separate']
			.data-table
			tbody {
			display: grid;
			gap: 0.75rem;
		}

		.data-table-frame[data-stack-at='tablet'][data-frame='card'][data-collapse='separate']
			.data-table
			tbody
			tr {
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			background: var(--card);
		}
	}
</style>
