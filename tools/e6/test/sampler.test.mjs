import assert from "node:assert/strict";
import test from "node:test";

import { assertSamplerEvidence, samplerInitScript } from "../lib/sampler.mjs";

test("rejects a score that lacks the required LoAF observer evidence", () => {
  assert.throws(
    () =>
      assertSamplerEvidence({
        busy: [2, 4, 7],
        loafSupported: false,
        loaf: [],
        interactions: [{ duration: 19, interactionId: 1 }],
      }),
    /E6_LOAF_MISSING/,
  );
});

test("requires supported Event Timing evidence for the binding interaction score", () => {
  assert.throws(
    () =>
      assertSamplerEvidence(
        {
          busy: [2, 4, 7],
          loafSupported: true,
          loaf: [],
          interactions: [],
          eventTimingSupported: false,
        },
        { requireInteraction: true },
      ),
    /E6_EVENT_TIMING_UNSUPPORTED/u,
  );
});

test("initializes rAF busy, Long Animation Frame, and Event Timing observers", () => {
  assert.equal(typeof samplerInitScript, "function");
  const source = samplerInitScript.toString();
  assert.match(source, /new MessageChannel/u);
  assert.match(source, /long-animation-frame/u);
  assert.match(source, /durationThreshold: 16/u);
});
