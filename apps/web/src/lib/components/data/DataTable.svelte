<script module lang="ts">
	import type { Snippet } from 'svelte';

	export type DataTableAttributeValue = string | number | boolean | null;
	export type DataTableAttributes = Readonly<Record<string, DataTableAttributeValue>>;
	export type DataTableAlign = 'start' | 'end';
	export type DataTableResponsive =
		| { mode: 'none' }
		| { mode: 'stack'; at: 'compact' | 'tablet' }
		| {
				mode: 'scroll';
				minWidth?: string;
				minWidthCompact?: string;
				scrollLabel?: string;
		  };
	export type DataTableFrame = 'none' | 'card' | 'gridlines';
	export type DataTableBorderCollapse = 'collapse' | 'separate';
	export type DataTableHeaderBand = 'none' | 'terminal' | 'wash';

	export interface DataTableColumn<T> {
		readonly key: string;
		readonly header: string;
		readonly align?: DataTableAlign;
		readonly numeric?: boolean;
		readonly width?: string;
		readonly rowHeader?: true;
		readonly cell: Snippet<[T]>;
	}

	export interface DataTableProps<T> {
		readonly rows: readonly T[];
		readonly columns: readonly DataTableColumn<T>[];
		readonly key: (row: T, index: number) => string;
		readonly caption: string;
		readonly responsive?: DataTableResponsive;
		readonly frame?: DataTableFrame;
		readonly borderCollapse?: DataTableBorderCollapse;
		readonly frameRadius?: boolean;
		readonly headerBand?: DataTableHeaderBand;
		readonly tableAttrs?: DataTableAttributes;
		readonly frameAttrs?: DataTableAttributes;
	}

	const DEFAULT_RESPONSIVE: DataTableResponsive = { mode: 'none' };
</script>

<script lang="ts" generics="T">
	let {
		rows,
		columns,
		key,
		caption,
		responsive = DEFAULT_RESPONSIVE,
		frame = 'none',
		borderCollapse = 'collapse',
		frameRadius = false,
		headerBand = 'none',
		tableAttrs,
		frameAttrs,
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
	const scrollRegionLabel = $derived(
		responsive.mode === 'scroll'
			? (responsive.scrollLabel ?? accessibleCaption)
			: accessibleCaption,
	);

	function attributeText(attrs: DataTableAttributes | undefined, name: string): string | undefined {
		const value = attrs?.[name];
		return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
	}

	const frameClass = $derived(
		['data-table-frame', attributeText(frameAttrs, 'class')].filter(Boolean).join(' '),
	);
	const tableClass = $derived(
		['data-table', attributeText(tableAttrs, 'class')].filter(Boolean).join(' '),
	);
	const frameSlot = $derived(attributeText(frameAttrs, 'data-slot') ?? 'data-table-frame');
	const tableSlot = $derived(attributeText(tableAttrs, 'data-slot') ?? 'data-table');

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
		responsive.mode;
		if (!element) return;
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	{...frameAttrs}
	bind:this={frameElement}
	class={frameClass}
	data-slot={frameSlot}
	data-responsive={responsive.mode}
	data-stack-at={stackAt}
	data-frame={frame}
	data-collapse={borderCollapse}
	data-frame-radius={frameRadius}
	data-header-band={headerBand}
	data-scrollable={scrollable}
	style:--dt-min-width={scrollMinWidth}
	style:--dt-min-width-compact={scrollMinWidthCompact}
	role={scrollable ? 'region' : undefined}
	aria-label={scrollable ? scrollRegionLabel : undefined}
	tabindex={scrollable ? 0 : undefined}
	onscroll={measure}
>
	<table
		{...tableAttrs}
		class={tableClass}
		data-slot={tableSlot}
		role={undefined}
		aria-label={undefined}
		aria-labelledby={undefined}
	>
		<caption class="sr-only">{accessibleCaption}</caption>
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
		background: var(--card);
	}

	.data-table-frame[data-frame='gridlines'] .data-table,
	.data-table-frame[data-frame='gridlines'] .data-table th,
	.data-table-frame[data-frame='gridlines'] .data-table td {
		border: 1px solid var(--border);
	}

	.data-table-frame[data-frame-radius='true'] {
		border-radius: var(--radius-lg);
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

	.data-table caption.sr-only {
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

	.data-table-frame[data-header-band='wash'] .data-table thead {
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
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
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table thead,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table tbody,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table tr,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table th,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table td {
			display: block;
			text-align: left;
			white-space: normal;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table thead {
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

		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table tbody tr {
			padding: 0.5rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table tbody th,
		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table tbody td {
			display: grid;
			grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
			gap: 1rem;
			padding: 0.25rem 0;
			border: 0;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='compact']
			.data-table
			tbody
			:is(th, td)::before {
			content: attr(data-col);
			grid-column: 1;
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			font-weight: 500;
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='compact'] .data-table-cell-content {
			grid-column: 2;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='compact']
			[data-align='end']
			.data-table-cell-content {
			text-align: right;
		}
	}

	@media (max-width: 1023px) {
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table thead,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table tbody,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table tr,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table th,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table td {
			display: block;
			text-align: left;
			white-space: normal;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table thead {
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

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table tbody tr {
			padding: 0.625rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table tbody th,
		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table tbody td {
			display: grid;
			grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
			gap: 1rem;
			padding: 0.25rem 0;
			border: 0;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
			.data-table
			tbody
			:is(th, td)::before {
			content: attr(data-col);
			grid-column: 1;
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			font-weight: 500;
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'] .data-table-cell-content {
			grid-column: 2;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
			[data-align='end']
			.data-table-cell-content {
			text-align: right;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'][data-frame='card'][data-collapse='separate'][data-frame-radius='true'] {
			border: 0;
			border-radius: 0;
			background: transparent;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'][data-frame='card'][data-collapse='separate'][data-frame-radius='true']
			.data-table
			tbody {
			display: grid;
			gap: 0.75rem;
		}

		.data-table-frame[data-responsive='stack'][data-stack-at='tablet'][data-frame='card'][data-collapse='separate'][data-frame-radius='true']
			.data-table
			tbody
			tr {
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			background: var(--card);
		}
	}
</style>
