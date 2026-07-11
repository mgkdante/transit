<script lang="ts">
	import ChartDatumPopover from '../ChartDatumPopover.svelte';
	import {
		createChartDatumPopover,
		type ChartDatumPopoverModel,
	} from '../useChartDatumPopover.svelte';

	const linkedModel: ChartDatumPopoverModel = {
		key: 'route-24-morning',
		heading: 'Route 24 · Sherbrooke',
		meta: 'Weekdays · 07:00–09:00',
		rows: [
			{
				label: 'Median wait',
				value: '6 min',
				colorVar: 'var(--dataviz-series-a)',
			},
			{ label: 'Observed trips', value: '42' },
		],
		action: {
			href: '/lines/24',
			label: 'View line 24',
			ariaLabel: 'View details for line 24',
		},
	};

	const informationModel: ChartDatumPopoverModel = {
		key: 'route-55-midday',
		heading: 'Route 55 · Saint-Laurent',
		meta: 'Weekdays · 11:00–13:00',
		rows: [{ label: 'P90 wait', value: '14 min' }],
	};

	const controller = createChartDatumPopover();
	let lastActivation = $state<boolean | null>(null);

	function activate(event: PointerEvent, model: ChartDatumPopoverModel): void {
		lastActivation = controller.activate(event, model);
	}
</script>

<div
	data-testid="chart-popover-harness"
	data-controller-id={controller.id}
	data-open={controller.open}
	data-model-key={controller.model?.key ?? ''}
	data-x={controller.x}
	data-y={controller.y}
	data-last-activation={lastActivation === null ? 'unset' : String(lastActivation)}
>
	<button
		type="button"
		data-testid="linked-trigger"
		onpointerdown={(event) => activate(event, linkedModel)}>Open linked datum</button
	>
	<button
		type="button"
		data-testid="information-trigger"
		onpointerdown={(event) => activate(event, informationModel)}>Open information datum</button
	>
	<button type="button" data-testid="explicit-close" onclick={() => controller.close()}
		>Close</button
	>
	<button type="button" data-testid="outside-focus-target">Outside focus target</button>

	<ChartDatumPopover {controller} />
</div>
