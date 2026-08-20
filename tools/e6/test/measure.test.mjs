import assert from "node:assert/strict";
import test from "node:test";

import { main, redProofReceipt, webPaths } from "../e6-measure.mjs";

test("resolves the web build and client output from tools/e6, not tools/apps", () => {
  assert.match(webPaths.webDirectory, /\/apps\/web\/?$/u);
  assert.match(
    webPaths.clientRoot,
    /\/apps\/web\/\.svelte-kit\/output\/client$/u,
  );
  assert.doesNotMatch(webPaths.webDirectory, /\/tools\/apps\//u);
});

test("red proof receipt binds a measured p95 over the eight-millisecond budget to FAIL", () => {
  const receipt = redProofReceipt(
    {
      busyProbes: [
        { scheduledAt: 0, postedAt: 1, sampledAt: 27 },
        { scheduledAt: 27, postedAt: 28, sampledAt: 55 },
        { scheduledAt: 55, postedAt: 56, sampledAt: 83 },
        { scheduledAt: 83, postedAt: 84, sampledAt: 112 },
      ],
      busyProbeCadenceMs: 4,
      windowStartedAt: 0,
      stopRequestedAt: 111,
      interactions: [],
    },
    { redBlockMs: 24, redToleranceMs: 2 },
  );
  assert.equal(receipt.label, "SYNTHETIC_NOT_A_BENCHMARK");
  assert.equal(receipt.sourceKind, "synthetic");
  assert.equal(receipt.benchmarkEligible, false);
  assert.equal(receipt.proof.expectedServiceMs, 28);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("red proof rejects samples that omit the four-millisecond probe cadence", () => {
  assert.throws(
    () =>
      redProofReceipt(
        {
          busyProbes: [
            { scheduledAt: 0, postedAt: 0, sampledAt: 28 },
            { scheduledAt: 28, postedAt: 28, sampledAt: 56 },
            { scheduledAt: 56, postedAt: 56, sampledAt: 84 },
            { scheduledAt: 84, postedAt: 84, sampledAt: 112 },
          ],
          busyProbeCadenceMs: 4,
          windowStartedAt: 0,
          stopRequestedAt: 111,
          interactions: [],
        },
        { redBlockMs: 28, redToleranceMs: 4 },
      ),
    /E6_RED_PROOF_TOLERANCE/u,
  );
});

test("refuses a short duration before it can label a receipt as a benchmark", async () => {
  await assert.rejects(
    main(["--duration-ms", "10", "--recording", "/tmp/not-read"]),
    /E6_BENCHMARK_WINDOW_REQUIRED windowMs=20000/u,
  );
});

test("rejects obsolete no-op runner flags instead of pretending to honor them", async () => {
  await assert.rejects(
    main(["--url", "file:///tmp/not-a-binding-route"]),
    /E6_OPTION_UNKNOWN --url/u,
  );
  await assert.rejects(main(["--preview"]), /E6_OPTION_UNKNOWN --preview/u);
  await assert.rejects(
    main(["--replay-stats-url", "http://127.0.0.1:4218/stats"]),
    /E6_OPTION_UNKNOWN --replay-stats-url/u,
  );
});
