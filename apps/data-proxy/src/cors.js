export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges, ETag",
};

export const PREFLIGHT_HEADERS = {
  ...CORS_HEADERS,
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "If-None-Match, If-Modified-Since, Range",
  "access-control-max-age": "86400",
};
