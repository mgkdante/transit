/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is number} */
function count(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** @param {unknown} value */
function delay(value) {
  return (
    value === null || (typeof value === "number" && Number.isSafeInteger(value))
  );
}

/** Live snapshot TTL behind the KPI endpoint; must equal apps/data-proxy LIVE_TTL_SECONDS. */
export const KPI_LIVE_TTL_S = 20;
/** A cold response asks clients to retry after one live TTL. */
export const KPI_COLD_RETRY_AFTER = String(KPI_LIVE_TTL_S);
/** A live reading is fresh while younger than three live TTLs. */
export const KPI_FRESHNESS_LIMIT_S = KPI_LIVE_TTL_S * 3;

// Additive v1: all existing fields retain their types; extra fields are allowed.
// This is a response-shape check and a stateless count of hero-eligible samples,
// not the browser's two-poll hold state machine.
/** @param {unknown} body @param {number} status @param {string | null} retryAfter @returns {'live' | 'demo' | null} */
export function kpiSampleState(body, status, retryAfter) {
  if (!record(body)) return null;
  if (status === 503) {
    return body.error === "pipeline_cold" &&
      typeof body.detail === "string" &&
      retryAfter === KPI_COLD_RETRY_AFTER
      ? "demo"
      : null;
  }
  if (
    status !== 200 ||
    typeof body.snapshotAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(body.snapshotAt) ||
    !Number.isFinite(Date.parse(body.snapshotAt)) ||
    !count(body.freshnessS) ||
    body.freshnessS >= KPI_FRESHNESS_LIMIT_S ||
    !count(body.vehicles) ||
    !count(body.routesLive) ||
    !(body.routesTotal === null || count(body.routesTotal)) ||
    !delay(body.avgDelayS) ||
    !(
      body.coverage === null ||
      (typeof body.coverage === "number" &&
        Number.isFinite(body.coverage) &&
        body.coverage >= 0 &&
        body.coverage <= 1)
    ) ||
    !Array.isArray(body.topRoutes) ||
    !body.topRoutes.every(
      (route) =>
        record(route) &&
        typeof route.route === "string" &&
        route.route.length > 0 &&
        count(route.vehicles) &&
        delay(route.avgDelayS),
    )
  )
    return null;
  return body.avgDelayS !== null &&
    body.coverage !== null &&
    body.routesTotal !== null &&
    body.topRoutes.some((route) => route.avgDelayS !== null)
    ? "live"
    : "demo";
}
