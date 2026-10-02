export interface EnvelopeBearing {
	readonly publish_generation_id?: string | null;
	readonly schema_version?: number;
	readonly methodology_version?: string | null;
}

export interface EnvelopeView {
	readonly generationId: string | null;
	readonly schemaVersion: string | null;
	readonly methodologyVersion: string | null;
}

export function selectEnvelope(
	primary: EnvelopeBearing | null | undefined,
	fallback: EnvelopeBearing | null | undefined,
): EnvelopeView {
	const str = (v: string | null | undefined): string | null => (v != null && v !== '' ? v : null);
	const gen = str(primary?.publish_generation_id) ?? str(fallback?.publish_generation_id);
	const method = str(primary?.methodology_version) ?? str(fallback?.methodology_version);
	const schema = primary?.schema_version ?? fallback?.schema_version ?? null;
	return {
		generationId: gen,
		schemaVersion: typeof schema === 'number' ? String(schema) : null,
		methodologyVersion: method,
	};
}
