import { expect, it, vi } from 'vitest';

it('shares one pending pmtiles registration across concurrent callers', async () => {
	vi.resetModules();
	const stage = (await import('./MapStage.svelte')) as typeof import('./MapStage.svelte') & {
		registerPmtilesProtocol?: (
			add: (scheme: string, tile: unknown) => void,
			load: () => Promise<{ Protocol: new () => { tile: unknown } }>,
		) => Promise<void>;
	};
	const register = stage.registerPmtilesProtocol!;
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => (release = resolve));
	const tile = vi.fn();
	const load = vi.fn(async () => {
		await barrier;
		return {
			Protocol: class ProtocolStub {
				readonly tile = tile;
			},
		};
	});
	const add = vi.fn();

	const first = register(add, load);
	const second = register(add, load);
	expect(load).toHaveBeenCalledTimes(1);
	expect(add).not.toHaveBeenCalled();
	release();
	await Promise.all([first, second]);

	expect(load).toHaveBeenCalledTimes(1);
	expect(add).toHaveBeenCalledTimes(1);
	expect(add).toHaveBeenCalledWith('pmtiles', tile);
});

it('drops only rejected shared pmtiles promises across fail, fail, succeed attempts', async () => {
	vi.resetModules();
	const stage = (await import('./MapStage.svelte')) as typeof import('./MapStage.svelte') & {
		registerPmtilesProtocol?: (
			add: (scheme: string, tile: unknown) => void,
			load: () => Promise<{ Protocol: new () => { tile: unknown } }>,
		) => Promise<void>;
	};
	const register =
		stage.registerPmtilesProtocol ??
		(async () => {
			throw new Error('registration seam missing');
		});
	const tile = vi.fn();
	const load = vi.fn(async () => ({
		Protocol: class ProtocolStub {
			readonly tile = tile;
		},
	}));
	let failures = 2;
	let successes = 0;
	const add = vi.fn(() => {
		if (failures > 0) {
			failures -= 1;
			throw new Error('registration failed');
		}
		successes += 1;
	});

	await expect(register(add, load)).rejects.toThrow('registration failed');
	await expect(register(add, load)).rejects.toThrow('registration failed');
	await expect(register(add, load)).resolves.toBeUndefined();
	await expect(register(add, load)).resolves.toBeUndefined();

	expect(load).toHaveBeenCalledTimes(3);
	expect(add).toHaveBeenCalledTimes(3);
	expect(add).toHaveBeenNthCalledWith(3, 'pmtiles', tile);
	expect(successes).toBe(1);
});
