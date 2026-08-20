import assert from "node:assert/strict";
import test from "node:test";

import { E6_BUSY_BUDGET_MS } from "../lib/config.mjs";
import {
  E6_BUSY_PROBE_CADENCE_MS,
  assertSamplerEvidence,
  samplerInitScript,
} from "../lib/sampler.mjs";

function probe(scheduledAt, postedAt, sampledAt) {
  return { scheduledAt, postedAt, sampledAt };
}

test("accepts valid busy and Event Timing evidence without optional observer fields", () => {
  const report = {
    busyProbes: [
      probe(100, 101, 102),
      probe(102, 104, 106),
      probe(106, 110, 113),
    ],
    busyProbeCadenceMs: E6_BUSY_PROBE_CADENCE_MS,
    windowStartedAt: 100,
    stopRequestedAt: 112,
    workloadCompletedAt: 110,
    interactions: [{ duration: 19, interactionId: 1 }],
    eventTimingSupported: true,
  };
  const evidence = assertSamplerEvidence(report, {
    requireInteraction: true,
  });
  assert.deepEqual(evidence.interactions, report.interactions);
  assert.equal(evidence.summary.count, 3);
  assert.equal(evidence.summary.max, 7);
  assert.deepEqual(evidence.busy, [2, 4, 7]);
});

test("requires supported Event Timing evidence for the binding interaction score", () => {
  assert.throws(
    () =>
      assertSamplerEvidence(
        {
          busyProbes: [probe(100, 101, 102)],
          busyProbeCadenceMs: E6_BUSY_PROBE_CADENCE_MS,
          windowStartedAt: 100,
          stopRequestedAt: 101,
          interactions: [],
          eventTimingSupported: false,
        },
        { requireInteraction: true },
      ),
    /E6_EVENT_TIMING_UNSUPPORTED/u,
  );
});

test("a single continuous probe can span the window but necessarily scores FAIL", () => {
  const report = {
    busyProbes: [probe(100, 20_100, 20_100)],
    busyProbeCadenceMs: E6_BUSY_PROBE_CADENCE_MS,
    windowStartedAt: 100,
    stopRequestedAt: 20_100,
    interactions: [],
    eventTimingSupported: true,
  };
  const evidence = assertSamplerEvidence(report, {
    requiredWindowMs: 20_000,
  });
  assert.equal(evidence.summary.count, 1);
  assert.equal(evidence.summary.p95, 20_000);
  assert.ok(evidence.summary.p95 > E6_BUSY_BUDGET_MS);
});

test("requires an edge-bound, gap-free, ordered raw probe chain", () => {
  const valid = {
    busyProbes: [probe(100, 101, 102), probe(102, 103, 104)],
    busyProbeCadenceMs: E6_BUSY_PROBE_CADENCE_MS,
    windowStartedAt: 100,
    stopRequestedAt: 103,
    interactions: [],
    eventTimingSupported: true,
  };
  for (const [changes, pattern, options] of [
    [
      { busyProbes: [probe(100, 100, 100), probe(101, 20_100, 20_100)] },
      /E6_BUSY_PROBE_GAP/u,
    ],
    [
      {
        busyProbes: [probe(100, 20_099.999, 20_099.999)],
        stopRequestedAt: 20_099.999,
      },
      /E6_BUSY_WINDOW_DURATION_MISMATCH/u,
      { requiredWindowMs: 20_000 },
    ],
    [
      {
        busyProbes: [
          probe(100, 101, 102),
          probe(102, 20_101, 20_101),
          probe(20_101, 20_102, 20_102),
        ],
        stopRequestedAt: 20_100,
      },
      /E6_BUSY_WINDOW_OVEREXTENDED/u,
      { requiredWindowMs: 20_000 },
    ],
    [
      {
        busyProbes: [probe(100, 20_101, 20_101)],
        stopRequestedAt: 20_101,
      },
      /E6_BUSY_WINDOW_DURATION_MISMATCH/u,
      { requiredWindowMs: 20_000 },
    ],
    [{ busyProbes: [probe(100, 99, 101)] }, /E6_BUSY_PROBE_PHASE_INVALID/u],
    [
      { busyProbes: [probe(100, Number.NaN, 101)] },
      /E6_BUSY_PROBE_TIME_INVALID/u,
    ],
    [{ windowStartedAt: 99 }, /E6_BUSY_WINDOW_START_MISMATCH/u],
    [{ stopRequestedAt: 105 }, /E6_BUSY_WINDOW_NOT_DRAINED/u],
    [{ busyProbeCadenceMs: 5 }, /E6_BUSY_PROBE_CADENCE_INVALID/u],
  ]) {
    assert.throws(
      () => assertSamplerEvidence({ ...valid, ...changes }, options),
      pattern,
    );
  }
});

test("derives the probe cadence from half the fixed busy budget", () => {
  assert.equal(E6_BUSY_PROBE_CADENCE_MS, E6_BUSY_BUDGET_MS / 2);
  assert.equal(typeof samplerInitScript, "function");
});

test("owns one fixed deadline and rejects a late workload", async () => {
  let now = 0;
  const timers = [];
  const originals = new Map(
    [
      "window",
      "performance",
      "PerformanceObserver",
      "MessageChannel",
      "setTimeout",
    ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  class FakePerformanceObserver {
    static supportedEntryTypes = ["event"];
    constructor() {}
    observe() {}
    takeRecords() {
      return [];
    }
    disconnect() {}
  }
  class FakeMessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close() {} };
      this.port2 = {
        postMessage: (data) => this.port1.onmessage?.({ data }),
        close() {},
      };
    }
  }
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  try {
    define("window", {});
    define("performance", { now: () => now });
    define("PerformanceObserver", FakePerformanceObserver);
    define("MessageChannel", FakeMessageChannel);
    define("setTimeout", (callback) => {
      timers.push(callback);
      return timers.length;
    });

    samplerInitScript(E6_BUSY_PROBE_CADENCE_MS);
    const state = globalThis.window.__e6Sampler;
    state.start(20);
    now = 4;
    timers.shift()();
    const deadlineAt = state.deadlineAt;
    assert.equal(state.busyProbes.length, 1);
    assert.equal(state.deadlineAt, deadlineAt);
    assert.equal(state.markWorkloadComplete(), 4);

    while (timers.length > 0) {
      now += 4;
      timers.shift()();
    }
    await state.donePromise;
    assert.equal(state.windowStartedAt, 0);
    assert.equal(state.stopRequestedAt, 20);
    assert.equal(state.busyProbes.at(-1).sampledAt, 20);
    assert.ok(state.busyProbes.at(-2).sampledAt < 20);
    assert.equal(timers.length, 0);
    assert.throws(
      () => state.markWorkloadComplete(),
      /E6_WORKLOAD_WINDOW_EXCEEDED/u,
    );
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
