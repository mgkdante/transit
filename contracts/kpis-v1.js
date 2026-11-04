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

// Additive v1: all existing fields retain their types; extra fields are allowed.
// This is a response-shape check and a stateless count of hero-eligible samples,
// not the browser's two-poll hold state machine.
/** @param {unknown} body @param {number} status @param {string | null} retryAfter @returns {'live' | 'demo' | null} */
export function kpiSampleState(body, status, retryAfter) {
  if (!record(body)) return null;
  if (status === 503) {
    return body.error === "pipeline_cold" &&
      typeof body.detail === "string" &&
      retryAfter === "30"
      ? "demo"
      : null;
  }
  if (
    status !== 200 ||
    typeof body.snapshotAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(body.snapshotAt) ||
    !Number.isFinite(Date.parse(body.snapshotAt)) ||
    !count(body.freshnessS) ||
    body.freshnessS >= 90 ||
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
