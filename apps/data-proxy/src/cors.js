// Shared CORS surface for the transit-data-proxy routes (/data/* and
// /api/v1/*): everything served here is public read-only data, so the origin
// allowlist is `*` (the slice-9.2 app and any external consumer — e.g. the
// yesid.dev KPI widget — fetch the canonical host directly).
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  // Expose the range/validator headers so a cross-origin pmtiles range reader
  // (MapLibre's pmtiles:// protocol, slice-9.3 basemap) can read them.
  "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges, ETag",
};

export const PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  // Range added for pmtiles partial reads (slice-9.3 basemap).
  "access-control-allow-headers": "If-None-Match, If-Modified-Since, Range",
  "access-control-max-age": "86400",
};
