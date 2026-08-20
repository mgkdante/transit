import assert from "node:assert/strict";
import test from "node:test";

import { main, redProofReceipt, webPaths } from "../e6-measure.mjs";

function redFixture({
  phase = "before-post",
  blockMs = 28,
  serviceMs = 32,
  count = 2,
} = {}) {
  const busyProbes = [];
  const redProofTraces = [];
  let scheduledAt = 0;
  for (let index = 0; index < count; index += 1) {
    const startedAt = scheduledAt + serviceMs - blockMs;
    const endedAt = startedAt + blockMs;
    const postedAt = phase === "before-post" ? endedAt : startedAt;
    const sampledAt = scheduledAt + serviceMs;
    busyProbes.push({ scheduledAt, postedAt, sampledAt });
    redProofTraces.push({ phase, startedAt, endedAt });
    scheduledAt = sampledAt;
  }
  return {
    busyProbes,
    busyProbeCadenceMs: 4,
    windowStartedAt: busyProbes[0].scheduledAt,
    stopRequestedAt: busyProbes.at(-1).sampledAt - 1,
    interactions: [],
    redProofTraces,
  };
}

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
    redFixture({ blockMs: 24, serviceMs: 28, count: 4 }),
    { redBlockMs: 24, phase: "before-post" },
  );
  assert.equal(receipt.label, "SYNTHETIC_NOT_A_BENCHMARK");
  assert.equal(receipt.sourceKind, "synthetic");
  assert.equal(receipt.benchmarkEligible, false);
  assert.equal(receipt.proof.expectedServiceMs, 28);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("red proof accepts scheduler overshoot when every after-post probe ran the full blocker", () => {
  const receipt = redProofReceipt(
    redFixture({ phase: "after-post", serviceMs: 60, count: 4 }),
    { redBlockMs: 28, phase: "after-post" },
  );

  assert.equal(receipt.busy.p95, 60);
  assert.equal(receipt.proof.minimumAcceptedServiceMs, 30);
  assert.equal(receipt.proof.traceCount, 4);
  assert.equal(receipt.budget.verdict, "FAIL");
});

test("red proof rejects evidence without one blocker trace per probe", () => {
  const evidence = redFixture({ serviceMs: 60 });
  evidence.redProofTraces = [];
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_COUNT_MISMATCH/u,
  );
});

test("red proof rejects a wrong-phase blocker masked by scheduler delay", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ phase: "after-post", serviceMs: 60 }), {
        redBlockMs: 28,
        phase: "before-post",
      }),
    /E6_RED_PROOF_TRACE_PHASE_MISMATCH/u,
  );
});

test("red proof rejects a truncated blocker masked by scheduler delay", () => {
  const evidence = redFixture({ serviceMs: 60 });
  evidence.redProofTraces[0].endedAt -= 1;
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_DURATION_INVALID/u,
  );
});

test("red proof rejects blocker traces outside either probe phase", () => {
  for (const phase of ["before-post", "after-post"]) {
    const evidence = redFixture({ phase });
    if (phase === "before-post") evidence.redProofTraces[0].endedAt += 1;
    else evidence.redProofTraces[0].startedAt -= 1;
    assert.throws(
      () => redProofReceipt(evidence, { redBlockMs: 28, phase }),
      /E6_RED_PROOF_TRACE_CONTAINMENT_INVALID/u,
      phase,
    );
  }
});

test("red proof rejects blocker traces paired to the wrong probe", () => {
  const evidence = redFixture();
  evidence.redProofTraces.reverse();
  assert.throws(
    () => redProofReceipt(evidence, { redBlockMs: 28, phase: "before-post" }),
    /E6_RED_PROOF_TRACE_CONTAINMENT_INVALID/u,
  );
});

test("red proof rejects an injected block that is not itself over budget", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ blockMs: 4, serviceMs: 60 }), {
        redBlockMs: 4,
        phase: "before-post",
      }),
    /E6_RED_PROOF_INPUT_INVALID/u,
  );
});

test("red proof rejects samples that omit the four-millisecond probe cadence", () => {
  assert.throws(
    () =>
      redProofReceipt(redFixture({ serviceMs: 28, count: 4 }), {
        redBlockMs: 28,
        phase: "before-post",
      }),
    /E6_RED_PROOF_UNDERSHOOT/u,
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
  await assert.rejects(
    main(["--red-tolerance-ms", "4"]),
    /E6_OPTION_UNKNOWN --red-tolerance-ms/u,
  );
});
