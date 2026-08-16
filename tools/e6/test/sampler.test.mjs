import assert from "node:assert/strict";
import test from "node:test";

import { assertSamplerEvidence, samplerInitScript } from "../lib/sampler.mjs";

test("accepts valid busy and Event Timing evidence without optional observer fields", () => {
  const report = {
    busy: [2, 4, 7],
    interactions: [{ duration: 19, interactionId: 1 }],
    eventTimingSupported: true,
  };
  const evidence = assertSamplerEvidence(report, { requireInteraction: true });
  assert.deepEqual(evidence.interactions, report.interactions);
  assert.equal(evidence.summary.count, 3);
  assert.equal(evidence.summary.max, 7);
});

test("requires supported Event Timing evidence for the binding interaction score", () => {
  assert.throws(
    () =>
      assertSamplerEvidence(
        {
          busy: [2, 4, 7],
          interactions: [],
          eventTimingSupported: false,
        },
        { requireInteraction: true },
      ),
    /E6_EVENT_TIMING_UNSUPPORTED/u,
  );
});

test("initializes MessageChannel busy and Event Timing observers", () => {
  assert.equal(typeof samplerInitScript, "function");
  const source = samplerInitScript.toString();
  assert.match(source, /new MessageChannel/u);
  assert.match(source, /durationThreshold: 16/u);
});
