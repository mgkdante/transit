import { vi } from 'vitest';

export function observeChartFrames(width: number, height: number): void {
	vi.stubGlobal(
		'ResizeObserver',
		class extends ResizeObserver {
			constructor(private readonly callback: ResizeObserverCallback) {
				super(callback);
			}

			override observe(target: Element, options?: ResizeObserverOptions): void {
				super.observe(target, options);
				if (!target.matches('[data-slot="chart-frame"]')) return;
				queueMicrotask(() => {
					if (!target.isConnected) return;
					this.callback(
						[
							{
								target,
								contentRect: new DOMRectReadOnly(0, 0, width, height),
							} as ResizeObserverEntry,
						],
						this,
					);
				});
			}
		},
	);
}
