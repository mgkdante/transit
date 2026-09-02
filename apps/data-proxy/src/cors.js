// Shared CORS surface for the transit-data-proxy routes (/data/* and
// /api/v1/*): everything served here is public read-only data, so the origin
// allowlist is `*` because the web app and external consumers, including the
// yesid.dev KPI widget, fetch the canonical host directly.
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  // Expose range and validator headers for cross-origin PMTiles readers.
  "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges, ETag",
};

export const PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  // Range is required for PMTiles partial reads.
  "access-control-allow-headers": "If-None-Match, If-Modified-Since, Range",
  "access-control-max-age": "86400",
};
