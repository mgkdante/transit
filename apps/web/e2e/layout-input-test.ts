import { test as base } from './layout-test';

type InputEventRecord = Record<string, unknown>;

// Keep evidence in the runner: a timed-out renderer may no longer answer evaluate().
export const test = base.extend<{ inputEvents: InputEventRecord[] }>({
	inputEvents: [
		async ({ page }, use, info) => {
			const events: InputEventRecord[] = [];
			await page.exposeBinding('__transitInputEvidence', (_source, value: InputEventRecord) => {
				events.push(value);
				if (events.length > 200) events.shift();
			});
			await page.addInitScript(() => {
				let sent = 0;
				const record = (value: Record<string, unknown>) => {
					if (sent++ >= 1000) return;
					const bridge = (
						window as unknown as {
							__transitInputEvidence(value: Record<string, unknown>): Promise<void>;
						}
					).__transitInputEvidence;
					void bridge({
						...value,
						time: performance.now(),
						path: location.pathname,
						hydrationMarker: document.documentElement.hasAttribute('data-hydrated'),
					}).catch(() => {});
				};
				for (const type of ['focusin', 'blur', 'keydown', 'keyup']) {
					document.addEventListener(
						type,
						(event) => {
							const target = event.target instanceof Element ? event.target : null;
							const key = event instanceof KeyboardEvent ? event.key : undefined;
							const sample = (phase: string) =>
								record({
									type,
									phase,
									key: key?.length === 1 ? 'character' : key,
									defaultPrevented: event.defaultPrevented,
									role: target?.getAttribute('role'),
									slot: target?.getAttribute('data-slot'),
									handle: target?.hasAttribute('data-sheet-handle'),
									connected: target?.isConnected,
									activeIsTarget: document.activeElement === target,
									activeSlot: document.activeElement?.getAttribute('data-slot'),
									documentFocused: document.hasFocus(),
									detent: document.querySelector('[data-detent]')?.getAttribute('data-detent'),
								});
							// Capture immediately, before a synchronous focus handler can stall.
							sample('capture');
							// A task, unlike a capture-listener microtask, follows bubbling handlers.
							if (event instanceof KeyboardEvent) setTimeout(() => sample('after-dispatch'), 0);
						},
						true,
					);
				}
				new MutationObserver((records) => {
					for (const entry of records)
						record({
							type: 'detent-change',
							previous: entry.oldValue,
							current: (entry.target as Element).getAttribute('data-detent'),
						});
				}).observe(document, {
					subtree: true,
					attributes: true,
					attributeOldValue: true,
					attributeFilter: ['data-detent'],
				});
			});
			try {
				await use(events);
			} finally {
				if (info.status !== info.expectedStatus)
					await info.attach('layout-input-events', {
						body: JSON.stringify(events),
						contentType: 'application/json',
					});
			}
		},
		{ auto: true },
	],
});
