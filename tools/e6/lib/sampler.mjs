import { busySummary } from "./stats.mjs";

export function samplerInitScript() {
  const existing = window.__e6Sampler;
  if (existing?.stop) existing.stop();
  const state = {
    busy: [],
    loaf: [],
    interactions: [],
    loafSupported: false,
    eventTimingSupported: false,
    running: true,
  };
  window.__e6Sampler = state;

  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  state.createLoafObserver = () => {
    if (!supported.includes("long-animation-frame")) return;
    state.loafSupported = true;
    state.loafObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        state.loaf.push({
          duration: entry.duration,
          startTime: entry.startTime,
        });
    });
    state.loafObserver.observe({
      type: "long-animation-frame",
      buffered: false,
    });
  };
  state.createEventTimingObserver = () => {
    if (!supported.includes("event")) return;
    state.eventTimingSupported = true;
    state.recordEventTiming = (entries) => {
      for (const entry of entries) {
        if (entry.interactionId > 0) {
          state.interactions.push({
            duration: entry.duration,
            interactionId: entry.interactionId,
          });
        }
      }
    };
    state.eventTimingObserver = new PerformanceObserver((list) => {
      state.recordEventTiming(list.getEntries());
    });
    state.eventTimingObserver.observe({
      type: "event",
      buffered: false,
      durationThreshold: 16,
    });
  };

  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => {
    const delta = performance.now() - event.data;
    if (Number.isFinite(delta) && delta >= 0) state.busy.push(delta);
    if (state.running) requestAnimationFrame(frame);
  };
  function frame() {
    channel.port2.postMessage(performance.now());
    window.__e6AfterSamplerPostMessage?.();
  }
  state.start = () => {
    if (state.started) return;
    state.started = true;
    state.busy.length = 0;
    state.loaf.length = 0;
    state.interactions.length = 0;
    state.createLoafObserver();
    state.createEventTimingObserver();
    requestAnimationFrame(frame);
  };
  state.stop = () => {
    state.running = false;
    state.loafObserver?.disconnect();
    state.recordEventTiming?.(state.eventTimingObserver?.takeRecords() ?? []);
    state.eventTimingObserver?.disconnect();
    channel.port1.close();
    channel.port2.close();
  };
}

export async function installSampler(page) {
  await page.addInitScript(samplerInitScript);
}

export async function readSampler(page, { stop = true } = {}) {
  return page.evaluate((shouldStop) => {
    const state = window.__e6Sampler;
    if (!state) throw new Error("E6_SAMPLER_NOT_INSTALLED");
    if (shouldStop) state.stop();
    return {
      busy: [...state.busy],
      loaf: [...state.loaf],
      interactions: [...state.interactions],
      loafSupported: state.loafSupported,
      eventTimingSupported: state.eventTimingSupported,
    };
  }, stop);
}

export async function startSampler(page) {
  await page.evaluate(() => {
    const state = window.__e6Sampler;
    if (!state) throw new Error("E6_SAMPLER_NOT_INSTALLED");
    state.start();
  });
}

export function assertSamplerEvidence(
  report,
  { requireInteraction = false } = {},
) {
  if (!report?.loafSupported) throw new Error("E6_LOAF_MISSING");
  if (!Array.isArray(report.busy) || report.busy.length === 0)
    throw new Error("E6_BUSY_MISSING");
  if (requireInteraction && !report?.eventTimingSupported)
    throw new Error("E6_EVENT_TIMING_UNSUPPORTED");
  if (requireInteraction && !Array.isArray(report.interactions))
    throw new Error("E6_EVENT_TIMING_MISSING");
  return { ...report, summary: busySummary(report.busy) };
}

export function assertSyntheticProof(
  report,
  { expectedBlockMs, toleranceMs = 4 } = {},
) {
  const checked = assertSamplerEvidence(report, {
    requireInteraction: false,
  });
  if (
    !Number.isFinite(expectedBlockMs) ||
    expectedBlockMs <= 0 ||
    !Number.isFinite(toleranceMs)
  ) {
    throw new Error("E6_RED_PROOF_INPUT_INVALID");
  }
  if (Math.abs(checked.summary.p95 - expectedBlockMs) > toleranceMs) {
    throw new Error(
      `E6_RED_PROOF_TOLERANCE measured=${checked.summary.p95} expected=${expectedBlockMs} tolerance=${toleranceMs}`,
    );
  }
  return checked;
}
