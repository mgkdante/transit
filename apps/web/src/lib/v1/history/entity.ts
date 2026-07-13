const CANONICAL_ENTITY_ID = /^(?:[0-9a-f]{2})+$/;

export function encodeHistoryEntityId(entityId: string): string {
	if (entityId.length === 0) throw new Error('History entity ID cannot be empty.');
	for (let index = 0; index < entityId.length; index += 1) {
		const codeUnit = entityId.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = entityId.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new Error('History entity ID must not contain a lone UTF-16 surrogate.');
			}
			index += 1;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			throw new Error('History entity ID must not contain a lone UTF-16 surrogate.');
		}
	}
	return Array.from(new TextEncoder().encode(entityId), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

export function decodeHistoryEntityId(encodedId: string): string {
	if (!CANONICAL_ENTITY_ID.test(encodedId)) {
		throw new Error('Encoded history entity ID must be non-empty lowercase UTF-8 hex.');
	}
	const bytes = new Uint8Array(encodedId.length / 2);
	for (let offset = 0; offset < encodedId.length; offset += 2) {
		bytes[offset / 2] = Number.parseInt(encodedId.slice(offset, offset + 2), 16);
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (cause) {
		throw new Error('Encoded history entity ID is not valid UTF-8.', { cause });
	}
}
