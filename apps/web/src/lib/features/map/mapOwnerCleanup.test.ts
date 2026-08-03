import { describe, expect, it, vi } from 'vitest';
import { createMapDisposalRegistry, mapOwnerBoundary } from '$lib/components/map/mapOwnerBoundary';

describe('mapOwnerBoundary', () => {
	it('isolates each cleanup step, retries only failures, and reports each failed step', () => {
		const firstFailure = new Error('first cleanup failed before mutation');
		const persistentFailure = new Error('persistent cleanup failed');
		const calls: string[] = [];
		const report = vi.fn();
		let firstAttempts = 0;

		const destroy = mapOwnerBoundary(
			'MapProbe',
			[
				() => {
					calls.push('first');
					firstAttempts += 1;
					if (firstAttempts === 1) throw firstFailure;
				},
				() => calls.push('second'),
				() => {
					calls.push('third');
					throw persistentFailure;
				},
			],
			report,
		);

		expect(() => destroy()).not.toThrow();
		expect(calls).toEqual(['first', 'second', 'third', 'first', 'third']);
		expect(report).toHaveBeenCalledTimes(2);
		expect(report.mock.calls[0]).toEqual([firstFailure]);
		expect(report.mock.calls[1]?.[0]).toBeInstanceOf(AggregateError);
		expect((report.mock.calls[1]?.[0] as AggregateError).errors).toEqual([
			persistentFailure,
			persistentFailure,
		]);

		destroy();
		expect(calls).toHaveLength(5);
	});

	it('observes rejected async cleanup and contains broken reporters', async () => {
		const cleanupFailure = new Error('async cleanup failed');
		const reporterFailure = new Error('reporter failed');
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const report = vi.fn(() => {
			throw reporterFailure;
		});
		const sibling = vi.fn();
		const destroy = mapOwnerBoundary(
			'MapAsyncProbe',
			[() => Promise.reject(cleanupFailure), sibling],
			report,
		);

		destroy();
		await Promise.resolve();
		await Promise.resolve();

		expect(sibling).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledExactlyOnceWith(cleanupFailure);
		expect(consoleError.mock.calls[0]?.[0]).toBe('MapAsyncProbe cleanup reporter failed');
		expect(consoleError.mock.calls[0]?.[1]).toBeInstanceOf(AggregateError);
	});

	it('honours an explicit single-attempt receipt without skipping later steps', () => {
		const failure = new Error('single-attempt cleanup failed');
		const releaseOnce = vi.fn(() => {
			throw failure;
		});
		const sibling = vi.fn();
		const report = vi.fn();
		const destroy = mapOwnerBoundary(
			'MapSingleAttemptProbe',
			[{ release: releaseOnce, retry: false }, sibling],
			report,
		);

		destroy();

		expect(releaseOnce).toHaveBeenCalledOnce();
		expect(sibling).toHaveBeenCalledOnce();
		expect(report).toHaveBeenCalledExactlyOnceWith(failure);
	});
});

describe('createMapDisposalRegistry', () => {
	it('owns receipts before registration and releases every active resource through the boundary', () => {
		const report = vi.fn();
		const registry = createMapDisposalRegistry('MapRuntime', report);
		const firstFailure = new Error('listener removal failed before mutation');
		const calls: string[] = [];
		let firstAttempts = 0;
		registry.own(() => {
			calls.push('first');
			firstAttempts += 1;
			if (firstAttempts === 1) throw firstFailure;
		});
		registry.own(() => {
			calls.push('second');
		});

		expect(registry.size).toBe(2);
		registry.dispose();

		expect(calls).toEqual(['first', 'second', 'first']);
		expect(registry.size).toBe(0);
		expect(report).toHaveBeenCalledExactlyOnceWith(firstFailure);
	});

	it('immediately contains a resource published after disposal', () => {
		const release = vi.fn();
		const registry = createMapDisposalRegistry('RetiredMapRuntime', vi.fn());
		registry.dispose();

		registry.own(release);

		expect(release).toHaveBeenCalledOnce();
		expect(registry.size).toBe(0);
	});
});
