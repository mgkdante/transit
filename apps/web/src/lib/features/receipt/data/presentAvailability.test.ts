import { describe, it, expect } from 'vitest';
import { selectAvailability } from './presentAvailability';
import type { ReceiptsIndex } from '$lib/v1/schemas';

const labels = {
	formatDate: (iso: string) => iso,
	gap: 'no receipt',
	empty: 'empty',
};

const idx = (partial: Partial<ReceiptsIndex>): ReceiptsIndex =>
	({ generated_utc: '2026-06-08T00:00:00Z', ...partial }) as ReceiptsIndex;

describe('selectAvailability — the smart calendar', () => {
	it('enumerates the FULL span with published days enabled and gap-days disabled', () => {
		// Jun 15 and Jun 17 published; Jun 16 is a GAP the index never published.
		const vm = selectAvailability(idx({ dates: ['2026-06-15', '2026-06-17'] }), labels);
		expect(vm.options.map((o) => o.date)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17']);
		const gap = vm.options.find((o) => o.date === '2026-06-16')!;
		expect(gap.disabled).toBe(true);
		expect(gap.disabledLabel).toBe('no receipt');
		expect(vm.enabledDates).toEqual(['2026-06-15', '2026-06-17']);
		expect(vm.hasAny).toBe(true);
	});

	it('enumerates a complete 731-day retained span without hitting the safety guard', () => {
		const oldest = '2024-06-17';
		const latest = '2026-06-17';
		const vm = selectAvailability(idx({ dates: [oldest, latest] }), labels);

		expect(vm.options).toHaveLength(731);
		expect(vm.options[0].date).toBe(oldest);
		expect(vm.options.at(-1)?.date).toBe(latest);
		const gap = vm.options.find((option) => option.date === '2025-06-17');
		expect(gap).toMatchObject({ disabled: true, disabledLabel: 'no receipt' });
		expect(vm.enabledDates).toEqual([oldest, latest]);
	});

	it('is timezone-safe across a DST edge (no dropped/duplicated service day)', () => {
		// 2026-03-08 is the US/CA spring-forward day — string math must not skip it.
		const vm = selectAvailability(idx({ dates: ['2026-03-07', '2026-03-09'] }), labels);
		expect(vm.options.map((o) => o.date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
	});

	it('distinguishes an EMPTY shell (disabled) from a schedule-only day (enabled)', () => {
		const vm = selectAvailability(
			idx({
				dates: ['2026-06-15', '2026-06-16'],
				available: [
					{ date: '2026-06-15', has_data: false, has_schedule: true }, // schedule-only → enabled
					{ date: '2026-06-16', has_data: false, has_schedule: false }, // empty shell → disabled
				],
			}),
			labels,
		);
		expect(vm.options.find((o) => o.date === '2026-06-15')!.disabled).toBe(false);
		const empty = vm.options.find((o) => o.date === '2026-06-16')!;
		expect(empty.disabled).toBe(true);
		expect(empty.disabledLabel).toBe('empty');
		expect(vm.enabledDates).toEqual(['2026-06-15']);
	});

	it('treats a pre-S13 index (dates only, no available) as plain enabled days', () => {
		const vm = selectAvailability(idx({ dates: ['2026-06-15', '2026-06-16'] }), labels);
		expect(vm.options.every((o) => !o.disabled)).toBe(true);
		expect(vm.enabledDates).toEqual(['2026-06-15', '2026-06-16']);
	});

	it('stands the picker down on an empty index', () => {
		const vm = selectAvailability(idx({ dates: [] }), labels);
		expect(vm.hasAny).toBe(false);
		expect(vm.options).toEqual([]);
		expect(selectAvailability(null, labels).hasAny).toBe(false);
	});
});
