function failedConditionalStatus(headers, object) {
  const ifMatch = headers.get("if-match");
  if (ifMatch !== null) {
    if (
      ifMatch.trim() !== "*" &&
      !ifMatch
        .split(",")
        .some((candidate) => candidate.trim() === object.httpEtag)
    )
      return 412;
  } else {
    const ifUnmodifiedSince = headers.get("if-unmodified-since");
    const timestamp = Date.parse(ifUnmodifiedSince ?? "");
    if (
      ifUnmodifiedSince !== null &&
      !Number.isNaN(timestamp) &&
      !(
        object.uploaded instanceof Date &&
        object.uploaded.getTime() <= timestamp
      )
    )
      return 412;
  }
  return headers.has("if-none-match") || headers.has("if-modified-since")
    ? 304
    : 412;
}

/** Serve one R2 object; routing, CORS and missing-object policy belong to callers. */
export async function serveSnapshot(request, bucket, key) {
  const conditionalHead =
    request.method === "HEAD" &&
    [
      "if-match",
      "if-none-match",
      "if-modified-since",
      "if-unmodified-since",
    ].some((header) => request.headers.has(header));
  const range = request.method === "GET" ? request.headers.get("range") : null;
  let object;
  try {
    object =
      request.method === "HEAD" && bucket.head && !conditionalHead
        ? await bucket.head(key)
        : await bucket.get(key, {
            onlyIf: request.headers,
            ...(range ? { range: request.headers } : {}),
          });
  } catch (error) {
    if (
      range &&
      error instanceof Error &&
      /\(10039\)\s*$/.test(error.message)
    ) {
      return new Response(null, {
        status: 416,
        headers: { "accept-ranges": "bytes", "cache-control": "no-store" },
      });
    }
    throw error;
  }
  if (object === null) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");

  if (object.body == null && (request.method !== "HEAD" || conditionalHead)) {
    const status = failedConditionalStatus(request.headers, object);
    if (status === 412) headers.set("cache-control", "no-store");
    return new Response(null, { status, headers });
  }
  if (request.method === "HEAD")
    return new Response(null, { status: 200, headers });
  if (range && object.range && object.size !== undefined) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set(
      "content-range",
      `bytes ${offset}-${offset + length - 1}/${object.size}`,
    );
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}
