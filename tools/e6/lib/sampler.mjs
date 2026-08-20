import { E6_BUSY_BUDGET_MS } from "./config.mjs";
import { busySummary } from "./stats.mjs";

export const E6_BUSY_PROBE_CADENCE_MS = E6_BUSY_BUDGET_MS / 2;

export function samplerInitScript(probeCadenceMs) {
  const existing = window.__e6Sampler;
  if (existing?.stop) void existing.stop();
  if (!Number.isFinite(probeCadenceMs) || probeCadenceMs <= 0)
    throw new Error("E6_BUSY_PROBE_CADENCE_INVALID");
  const state = {
    busyProbes: [],
    busyProbeCadenceMs: probeCadenceMs,
    interactions: [],
    eventTimingSupported: false,
    running: false,
  };
  window.__e6Sampler = state;

  const supported = PerformanceObserver.supportedEntryTypes ?? [];
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
  state.flushEventTiming = () => {
    state.recordEventTiming?.(state.eventTimingObserver?.takeRecords() ?? []);
    state.eventTimingObserver?.disconnect();
  };
  state.finish = () => {
    if (state.finished) return;
    state.finished = true;
    state.flushEventTiming();
    channel.port1.close();
    channel.port2.close();
    state.resolveDone?.();
  };
  const schedule = (scheduledAt) => {
    state.inFlight = true;
    setTimeout(() => {
      window.__e6BeforeSamplerPostMessage?.();
      const postedAt = performance.now();
      channel.port2.postMessage({ scheduledAt, postedAt });
      window.__e6AfterSamplerPostMessage?.();
    }, probeCadenceMs);
  };
  channel.port1.onmessage = (event) => {
    const sampledAt = performance.now();
    state.busyProbes.push({ ...event.data, sampledAt });
    state.inFlight = false;
    if (state.running && sampledAt < state.deadlineAt) schedule(sampledAt);
    else {
      state.running = false;
      state.stopRequestedAt ??= state.deadlineAt;
      state.finish();
    }
  };
  state.start = (windowMs) => {
    if (state.started) return;
    if (!Number.isFinite(windowMs) || windowMs <= 0)
      throw new Error("E6_BUSY_WINDOW_INVALID");
    state.started = true;
    state.running = true;
    state.busyProbes.length = 0;
    state.interactions.length = 0;
    state.donePromise = new Promise((resolve) => {
      state.resolveDone = resolve;
    });
    state.createEventTimingObserver();
    state.windowStartedAt = performance.now();
    state.deadlineAt = state.windowStartedAt + windowMs;
    schedule(state.windowStartedAt);
  };
  state.markWorkloadComplete = () => {
    const completedAt = performance.now();
    if (!state.running || completedAt >= state.deadlineAt)
      throw new Error("E6_WORKLOAD_WINDOW_EXCEEDED");
    state.workloadCompletedAt = completedAt;
    return completedAt;
  };
  state.stop = () => {
    if (!state.started || state.finished) return Promise.resolve();
    state.running = false;
    state.stopRequestedAt = performance.now();
    if (!state.inFlight) state.finish();
    return state.donePromise;
  };
}

export async function installSampler(page) {
  await page.addInitScript(samplerInitScript, E6_BUSY_PROBE_CADENCE_MS);
}

export async function readSampler(page) {
  return page.evaluate(async () => {
    const state = window.__e6Sampler;
    if (!state) throw new Error("E6_SAMPLER_NOT_INSTALLED");
    if (!state.donePromise) throw new Error("E6_SAMPLER_NOT_STARTED");
    await state.donePromise;
    return {
      busyProbes: state.busyProbes.map((probe) => ({ ...probe })),
      busyProbeCadenceMs: state.busyProbeCadenceMs,
      windowStartedAt: state.windowStartedAt,
      stopRequestedAt: state.stopRequestedAt,
      workloadCompletedAt: state.workloadCompletedAt,
      interactions: [...state.interactions],
      eventTimingSupported: state.eventTimingSupported,
    };
  });
}

export async function startSampler(page, windowMs) {
  await page.evaluate((duration) => {
    const state = window.__e6Sampler;
    if (!state) throw new Error("E6_SAMPLER_NOT_INSTALLED");
    state.start(duration);
  }, windowMs);
}

export async function markSamplerWorkloadComplete(page) {
  return page.evaluate(() => {
    const state = window.__e6Sampler;
    if (!state) throw new Error("E6_SAMPLER_NOT_INSTALLED");
    return state.markWorkloadComplete();
  });
}

export function assertSamplerEvidence(
  report,
  { requireInteraction = false, requiredWindowMs = 0 } = {},
) {
  if (!Array.isArray(report?.busyProbes) || report.busyProbes.length === 0)
    throw new Error("E6_BUSY_MISSING");
  if (report.busyProbeCadenceMs !== E6_BUSY_PROBE_CADENCE_MS)
    throw new Error("E6_BUSY_PROBE_CADENCE_INVALID");
  const busy = [];
  let previousSampledAt;
  for (const probe of report.busyProbes) {
    const { scheduledAt, postedAt, sampledAt } = probe ?? {};
    if (
      ![scheduledAt, postedAt, sampledAt].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    )
      throw new Error("E6_BUSY_PROBE_TIME_INVALID");
    if (scheduledAt > postedAt || postedAt > sampledAt)
      throw new Error("E6_BUSY_PROBE_PHASE_INVALID");
    if (previousSampledAt !== undefined && scheduledAt !== previousSampledAt)
      throw new Error("E6_BUSY_PROBE_GAP");
    busy.push(sampledAt - scheduledAt);
    previousSampledAt = sampledAt;
  }
  const firstScheduledAt = report.busyProbes[0].scheduledAt;
  const lastSampledAt = report.busyProbes.at(-1).sampledAt;
  if (
    ![report.windowStartedAt, report.stopRequestedAt].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error("E6_BUSY_WINDOW_INVALID");
  if (firstScheduledAt !== report.windowStartedAt)
    throw new Error("E6_BUSY_WINDOW_START_MISMATCH");
  if (lastSampledAt < report.stopRequestedAt)
    throw new Error("E6_BUSY_WINDOW_NOT_DRAINED");
  if (!Number.isFinite(requiredWindowMs) || requiredWindowMs < 0)
    throw new Error("E6_BUSY_WINDOW_INVALID");
  const requestedWindowMs = report.stopRequestedAt - report.windowStartedAt;
  const observedWindowMs = lastSampledAt - firstScheduledAt;
  if (requiredWindowMs > 0 && requestedWindowMs !== requiredWindowMs)
    throw new Error(
      `E6_BUSY_WINDOW_DURATION_MISMATCH requested=${requestedWindowMs} required=${requiredWindowMs}`,
    );
  if (observedWindowMs < requiredWindowMs)
    throw new Error(
      `E6_BUSY_WINDOW_INSUFFICIENT requested=${requestedWindowMs} observed=${observedWindowMs} required=${requiredWindowMs}`,
    );
  if (
    report.busyProbes.length > 1 &&
    report.busyProbes.at(-2).sampledAt >= report.stopRequestedAt
  )
    throw new Error("E6_BUSY_WINDOW_OVEREXTENDED");
  if (requireInteraction && !report?.eventTimingSupported)
    throw new Error("E6_EVENT_TIMING_UNSUPPORTED");
  if (requireInteraction && !Array.isArray(report.interactions))
    throw new Error("E6_EVENT_TIMING_MISSING");
  if (
    requireInteraction &&
    (!Number.isFinite(report.workloadCompletedAt) ||
      report.workloadCompletedAt < report.windowStartedAt ||
      report.workloadCompletedAt >= report.stopRequestedAt)
  )
    throw new Error("E6_WORKLOAD_WINDOW_EXCEEDED");
  return {
    ...report,
    busy,
    requestedWindowMs,
    observedWindowMs,
    summary: busySummary(busy),
  };
}

export function assertSyntheticProof(
  report,
  { expectedBusyMs, toleranceMs = 4 } = {},
) {
  const checked = assertSamplerEvidence(report, {
    requireInteraction: false,
  });
  if (
    !Number.isFinite(expectedBusyMs) ||
    expectedBusyMs <= 0 ||
    !Number.isFinite(toleranceMs) ||
    toleranceMs < 0
  ) {
    throw new Error("E6_RED_PROOF_INPUT_INVALID");
  }
  const difference = checked.summary.p95 - expectedBusyMs;
  if (difference < -E6_BUSY_PROBE_CADENCE_MS / 2 || difference > toleranceMs) {
    throw new Error(
      `E6_RED_PROOF_TOLERANCE measured=${checked.summary.p95} expected=${expectedBusyMs} tolerance=${toleranceMs}`,
    );
  }
  return checked;
}
