import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPreviewUrl,
  main,
  redProofReceipt,
  webPaths,
} from "../e6-measure.mjs";

test("resolves the web build and client output from tools/e6, not tools/apps", () => {
  assert.match(webPaths.webDirectory, /\/apps\/web\/?$/u);
  assert.match(
    webPaths.clientRoot,
    /\/apps\/web\/\.svelte-kit\/output\/client$/u,
  );
  assert.doesNotMatch(webPaths.webDirectory, /\/tools\/apps\//u);
});

test("targets the actual map route for the default replay measurement", () => {
  assert.equal(typeof defaultPreviewUrl, "function");
  assert.equal(defaultPreviewUrl(), "http://127.0.0.1:4217/map");
});

test("red proof receipt binds a measured p95 over the eight-millisecond budget to FAIL", () => {
  const receipt = redProofReceipt(
    {
      busy: [23, 24, 24, 25],
      loafSupported: true,
      loaf: [],
      interactions: [],
    },
    { redBlockMs: 24, redToleranceMs: 2 },
  );
  assert.equal(receipt.label, "SYNTHETIC_NOT_A_BENCHMARK");
  assert.equal(receipt.sourceKind, "synthetic");
  assert.equal(receipt.benchmarkEligible, false);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("refuses a short duration before it can label a receipt as a benchmark", async () => {
  await assert.rejects(
    main(["--duration-ms", "10", "--recording", "/tmp/not-read"]),
    /E6_BENCHMARK_WINDOW_REQUIRED windowMs=20000/u,
  );
});

test("rejects obsolete no-op runner flags instead of pretending to honor them", async () => {
  await assert.rejects(main(["--preview"]), /E6_OPTION_UNKNOWN --preview/u);
  await assert.rejects(
    main(["--replay-stats-url", "http://127.0.0.1:4218/stats"]),
    /E6_OPTION_UNKNOWN --replay-stats-url/u,
  );
});
