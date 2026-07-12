import type { MagnitudeDatum } from '../ChartSpec';
import type { ChartDatumPopoverController } from '../useChartDatumPopover.svelte';

export function activateMagnitudeRow(
	event: MouseEvent | PointerEvent,
	datum: MagnitudeDatum,
	popover: ChartDatumPopoverController,
	navigate: (href: string) => void | Promise<void>,
): 'popover' | 'navigate' | 'none' {
	if (datum.tapPopover && popover.activate(event, datum.tapPopover)) return 'popover';
	if (datum.href) {
		void navigate(datum.href);
		return 'navigate';
	}
	return 'none';
}
