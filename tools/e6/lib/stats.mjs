export const PERCENTILE_METHOD = "r7-linear-interpolation";

function finiteSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("E6_BUSY_SAMPLES_EMPTY");
  }
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("E6_BUSY_SAMPLES_INVALID");
  }
  return [...samples].sort((left, right) => left - right);
}

export function percentile(samples, fraction) {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error(`E6_PERCENTILE_INVALID fraction=${String(fraction)}`);
  }
  const sorted = finiteSamples(samples);
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * fraction;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function busySummary(samples) {
  const sorted = finiteSamples(samples);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1),
  };
}

export function scoreBusyBudget(p95Ms, budgetMs) {
  if (
    !Number.isFinite(p95Ms) ||
    p95Ms < 0 ||
    !Number.isFinite(budgetMs) ||
    budgetMs <= 0
  ) {
    throw new Error("E6_BUDGET_INPUT_INVALID");
  }
  const passed = p95Ms <= budgetMs;
  return {
    budgetMs,
    p95Ms,
    passed,
    verdict: passed ? "PASS" : "FAIL",
  };
}

export function scoreInteractionBudget(
  entries,
  { requiredInteractions, budgetMs } = {},
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("E6_EVENT_TIMING_MISSING");
  }
  if (!Number.isInteger(requiredInteractions) || requiredInteractions < 1) {
    throw new Error("E6_EVENT_TIMING_REQUIRED_COUNT_INVALID");
  }
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error("E6_EVENT_TIMING_BUDGET_INVALID");
  }
  const maxima = new Map();
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry?.interactionId) ||
      entry.interactionId <= 0
    ) {
      throw new Error("E6_EVENT_TIMING_ID_INVALID");
    }
    if (!Number.isFinite(entry?.duration) || entry.duration < 0) {
      throw new Error("E6_EVENT_TIMING_DURATION_INVALID");
    }
    maxima.set(
      entry.interactionId,
      Math.max(maxima.get(entry.interactionId) ?? 0, entry.duration),
    );
  }
  if (maxima.size !== requiredInteractions) {
    throw new Error(
      `E6_EVENT_TIMING_COUNT_MISMATCH distinct=${maxima.size} required=${requiredInteractions}`,
    );
  }
  const values = [...maxima]
    .sort(([left], [right]) => left - right)
    .map(([, duration]) => duration);
  const p95Ms = percentile(values, 0.95);
  const passed = p95Ms < budgetMs;
  return {
    percentileMethod: PERCENTILE_METHOD,
    budgetMs,
    distinctInteractions: maxima.size,
    requiredInteractions,
    values,
    p95Ms,
    passed,
    verdict: passed ? "PASS" : "FAIL",
  };
}

export function scoreArmVerdict({
  busyPassed,
  interactionPassed,
  requestedActions,
  completedActions,
} = {}) {
  if (
    typeof busyPassed !== "boolean" ||
    typeof interactionPassed !== "boolean" ||
    !Number.isInteger(requestedActions) ||
    requestedActions < 1 ||
    !Number.isInteger(completedActions) ||
    completedActions < 0
  ) {
    throw new Error("E6_ARM_VERDICT_INPUT_INVALID");
  }
  const actionsPassed = completedActions === requestedActions;
  const passed = busyPassed && interactionPassed && actionsPassed;
  return {
    passed,
    verdict: passed ? "PASS" : "FAIL",
    busyPassed,
    interactionPassed,
    actionsPassed,
    requestedActions,
    completedActions,
  };
}
