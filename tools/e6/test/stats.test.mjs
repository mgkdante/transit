import assert from "node:assert/strict";
import test from "node:test";

import { E6_BUSY_BUDGET_MS } from "../lib/config.mjs";
import {
  busySummary,
  percentile,
  scoreBusyBudget,
  scoreInteractionBudget,
} from "../lib/stats.mjs";

test("computes interpolated percentiles from independently checked literals", () => {
  const samples = [0, 10, 20, 30, 40];
  assert.equal(percentile(samples, 0.5), 20);
  assert.equal(percentile(samples, 0.95), 38);
  assert.equal(percentile(samples, 0.99), 39.6);
});

test("reports p50 p95 and p99 without rounding away the raw values", () => {
  assert.deepEqual(busySummary([1, 2, 3, 4, 5]), {
    count: 5,
    p50: 3,
    p95: 4.8,
    p99: 4.96,
    max: 5,
  });
});

test("fails the binding 8ms budget when measured p95 is above it", () => {
  assert.deepEqual(scoreBusyBudget(8.01, E6_BUSY_BUDGET_MS), {
    budgetMs: 8,
    p95Ms: 8.01,
    passed: false,
    verdict: "FAIL",
  });
});

test("passes the binding budget exactly at 8ms", () => {
  assert.equal(scoreBusyBudget(8, E6_BUSY_BUDGET_MS).passed, true);
  assert.equal(scoreBusyBudget(9, 10).passed, true);
  assert.throws(() => scoreBusyBudget(8), /E6_BUDGET_INPUT_INVALID/u);
});

test("requires exactly the declared number of distinct trusted interactions", () => {
  assert.throws(
    () =>
      scoreInteractionBudget(
        [
          { interactionId: 1, duration: 16 },
          { interactionId: 2, duration: 16 },
        ],
        { requiredInteractions: 1, budgetMs: 200 },
      ),
    /E6_EVENT_TIMING_COUNT_MISMATCH distinct=2 required=1/u,
  );
});
