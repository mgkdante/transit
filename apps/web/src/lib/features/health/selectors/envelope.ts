// envelope — the in-band accountability envelope (PayloadEnvelope) view-model.
//
// Every top-level /v1 payload carries three additive-optional accountability
// fields: publish_generation_id (the deterministic stamp of the ONE publish run
// that produced everything on the page), schema_version, and methodology_version.
// /status renders all three so the citizen can cite the exact build. This selector
// reads them off whichever envelope-bearing payload we have (the data-health doc
// on the live lane, or the provenance doc as a fallback) and formats each for the
// honest-absent path (null → the styled absence chip at the call site).

/** Any payload root that carries the accountability envelope. */
export interface EnvelopeBearing {
	readonly publish_generation_id?: string | null;
	readonly schema_version?: number;
	readonly methodology_version?: string | null;
}

/** The three envelope values, each null when the payload omitted it. */
export interface EnvelopeView {
	/** The deterministic publish-run stamp, null when absent. */
	readonly generationId: string | null;
	/** The payload schema version as a string ("1"), null when absent. */
	readonly schemaVersion: string | null;
	/** The methodology family version ("live-1"), null when absent. */
	readonly methodologyVersion: string | null;
}

/**
 * Read the envelope off the FIRST source that carries a value for each field,
 * preferring the data-health doc (the live lane's own stamp) then falling back to
 * provenance — so /status still shows the envelope on a legacy publish with no
 * data_health. Each field independently falls back, so a partial payload never
 * blanks a field another source could fill.
 */
export function selectEnvelope(
	primary: EnvelopeBearing | null | undefined,
	fallback: EnvelopeBearing | null | undefined,
): EnvelopeView {
	// A present string field is one that is non-null AND non-empty; an empty string
	// counts as absent so it does not block the fallback (a blank id is not a value).
	const str = (v: string | null | undefined): string | null => (v != null && v !== '' ? v : null);
	const gen = str(primary?.publish_generation_id) ?? str(fallback?.publish_generation_id);
	const method = str(primary?.methodology_version) ?? str(fallback?.methodology_version);
	// schema_version is a number: 0 is a real version, so only null/undefined falls
	// through to the fallback.
	const schema = primary?.schema_version ?? fallback?.schema_version ?? null;
	return {
		generationId: gen,
		schemaVersion: typeof schema === 'number' ? String(schema) : null,
		methodologyVersion: method,
	};
}
