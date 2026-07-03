// envelope.test.ts — the build-accountability envelope selector.

import { describe, it, expect } from 'vitest';
import { selectEnvelope } from './envelope';

describe('selectEnvelope', () => {
	it('reads all three fields off the primary source', () => {
		const view = selectEnvelope(
			{ publish_generation_id: 'gen-1', schema_version: 2, methodology_version: 'live-1' },
			null,
		);
		expect(view).toEqual({
			generationId: 'gen-1',
			schemaVersion: '2',
			methodologyVersion: 'live-1',
		});
	});

	it('falls back per-field to the secondary source when the primary omits a field', () => {
		const view = selectEnvelope(
			{ schema_version: 5 }, // primary carries only schema
			{ publish_generation_id: 'gen-fallback', methodology_version: 'historic-2' },
		);
		expect(view).toEqual({
			generationId: 'gen-fallback',
			schemaVersion: '5',
			methodologyVersion: 'historic-2',
		});
	});

	it('returns nulls when neither source carries a field (→ the section stands down)', () => {
		expect(selectEnvelope(null, undefined)).toEqual({
			generationId: null,
			schemaVersion: null,
			methodologyVersion: null,
		});
		expect(selectEnvelope({}, {})).toEqual({
			generationId: null,
			schemaVersion: null,
			methodologyVersion: null,
		});
	});

	it('treats an empty-string id / null field as absent (honest, never a blank value)', () => {
		const view = selectEnvelope(
			{ publish_generation_id: '', methodology_version: null },
			{ publish_generation_id: 'gen-real' },
		);
		// Empty string on the primary falls through to the secondary's real value.
		expect(view.generationId).toBe('gen-real');
		expect(view.methodologyVersion).toBeNull();
	});

	it('stringifies schema_version 0 (a real version, not absence)', () => {
		expect(selectEnvelope({ schema_version: 0 }, null).schemaVersion).toBe('0');
	});
});
