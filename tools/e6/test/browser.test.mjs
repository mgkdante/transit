import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTrustedInteractionStart,
  createArmContext,
  findLiveVehiclePoint,
  readMapTickSnapshot,
  resolveChromeExecutable,
  runAssertedActions,
  runObservedRefreshes,
  runTrustedInteractions,
  waitForMapTickChange,
} from "../lib/browser.mjs";

function createTrustedInteractionPage(
  vehicleAt,
  { rejectMotionLocatorClick = false, selectedKindAfterClick = "vehicle" } = {},
) {
  const moves = [];
  const events = [];
  let hovered = null;
  let completedPicks = 0;
  let motionEnabled = false;
  let filterEnabled = false;
  let focused = null;
  let escapeSettled = false;
  const motion = {
    count: async () => 1,
    getAttribute: async (name) =>
      name === "aria-checked" ? String(motionEnabled) : null,
    click: async () => {
      if (rejectMotionLocatorClick)
        throw new Error("motion locator click must not be used");
      motionEnabled = !motionEnabled;
    },
    boundingBox: async () => ({ x: 100, y: 200, width: 40, height: 20 }),
    focus: async () => {
      focused = "motion";
    },
  };
  const filter = {
    getAttribute: async (name) =>
      name === "aria-pressed" ? String(filterEnabled) : null,
    click: async () => {
      filterEnabled = !filterEnabled;
    },
  };
  const page = {
    locator: (selector) => {
      if (selector === "canvas.maplibregl-canvas")
        return {
          boundingBox: async () => ({ x: 0, y: 0, width: 72, height: 48 }),
        };
      if (selector === '.map-peek .map-hover-peek[data-kind="vehicle"]')
        return {
          isVisible: async () =>
            vehicleAt(hovered, completedPicks, filterEnabled, motionEnabled),
        };
      if (selector.includes("map-motion-switch")) return motion;
      if (selector.includes("mf-shape-chip")) return { first: () => filter };
      return {
        waitFor: async ({ state }) => {
          if (
            selector === '.map-selection-detail[data-kind="vehicle"]' &&
            state === "visible" &&
            selectedKindAfterClick !== "vehicle"
          )
            throw new Error(`selected ${selectedKindAfterClick}`);
          if (
            selector === '[data-slot="map-detail-overlay"]' &&
            state === "hidden"
          )
            events.push("detail-hidden");
          if (
            selector === '.map-hero[data-selection-presence="gone"]' &&
            state === "visible"
          ) {
            escapeSettled = true;
            events.push("selection-gone");
          }
        },
      };
    },
    mouse: {
      move: async (x, y) => {
        hovered = { x, y };
        moves.push(hovered);
      },
      click: async (x, y) => {
        if (x === 120 && y === 210) {
          assert.equal(escapeSettled, true);
          motionEnabled = !motionEnabled;
          events.push("motion-mouse-click");
          return;
        }
        assert.equal(
          vehicleAt(hovered, completedPicks, filterEnabled, motionEnabled),
          true,
        );
        completedPicks += 1;
      },
    },
    evaluate: async () =>
      vehicleAt(hovered, completedPicks, filterEnabled, motionEnabled),
    keyboard: {
      press: async (key) => {
        if (focused === "motion" && (key === "Enter" || key === "Space"))
          motionEnabled = !motionEnabled;
      },
    },
    url: () => "https://example.test/map",
  };
  return { events, page, moves };
}

test("uses the E6 executable override before the system Chrome fallback", () => {
  assert.deepEqual(
    resolveChromeExecutable({ E6_CHROME_EXECUTABLE: "/tmp/e6-chrome" }),
    "/tmp/e6-chrome",
  );
  assert.equal(resolveChromeExecutable({}), "/usr/bin/google-chrome");
});

test("creates a fresh context, pre-seeds raw controls, and never opens a CDP throttle session", async () => {
  const calls = [];
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (...args) => calls.push(args),
      }),
    }),
  };
  const context = {
    addInitScript: async (script, values) =>
      calls.push(["init", script, values]),
    newPage: async () => page,
  };
  const browser = {
    newContext: async (options) => {
      calls.push(["context", options]);
      return context;
    },
  };

  const arm = await createArmContext(browser, {
    rate: 1,
    storage: {
      "transit:motion-mode": "raw",
      "transit:controls-rail": "false",
    },
  });

  assert.equal(arm.context, context);
  assert.equal(arm.page, page);
  assert.equal(calls[0][0], "context");
  assert.deepEqual(calls[0][1], {
    viewport: { width: 1440, height: 960 },
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    bypassCSP: true,
  });
  assert.equal(calls[1][0], "init");
  assert.deepEqual(calls[1][2], {
    "transit:motion-mode": "raw",
    "transit:controls-rail": "false",
  });
  assert.equal(
    calls.some(([command]) => command === "Emulation.setCPUThrottlingRate"),
    false,
  );
});

test("observes one processed application tick change under a deadline", async () => {
  const seen = [];
  const page = {
    locator: () => ({
      getAttribute: async (name) =>
        name === "data-motion-vehicle-count" ? "3424" : "tick-0",
    }),
    waitForFunction: async (_predicate, input, { timeout }) => {
      seen.push({ previous: input.previous, timeout });
      return {
        jsonValue: async () => ({ tickKey: "tick-1", vehicleCount: 3_424 }),
        dispose: async () => {},
      };
    },
  };
  const initialTickKey = (await readMapTickSnapshot(page)).tickKey;
  assert.deepEqual(
    await waitForMapTickChange(page, {
      previousTickKey: initialTickKey,
      expectedVehicleCount: 3_424,
      timeoutMs: 1_000,
    }),
    { tickKey: "tick-1", vehicleCount: 3_424 },
  );
  assert.deepEqual(
    seen.map(({ previous }) => previous),
    ["tick-0"],
  );
  assert.ok(seen.every(({ timeout }) => timeout > 0 && timeout <= 1_000));
});

test("refuses a repeated or missing processed application tick", async () => {
  const page = {
    waitForFunction: async () => ({
      jsonValue: async () => ({ tickKey: "tick-0", vehicleCount: 3_424 }),
      dispose: async () => {},
    }),
  };
  await assert.rejects(
    waitForMapTickChange(page, {
      previousTickKey: "tick-0",
      expectedVehicleCount: 3_424,
      timeoutMs: 1_000,
    }),
    /E6_REPLAY_TICK_OBSERVATION_INVALID/u,
  );
});

test("uses the real refresh handler twice and waits for each processed tick before continuing", async () => {
  let tickKey = "tick-0";
  let refreshing = false;
  let clicks = 0;
  let waitCalls = 0;
  const transitions = [];
  const triggerRefresh = async () => {
    refreshing = true;
    await new Promise((resolve) => setTimeout(resolve, 0));
    clicks += 1;
    tickKey = `tick-${clicks}`;
    refreshing = false;
  };
  const page = {
    locator: (selector) =>
      selector.includes("refresh-control")
        ? { count: async () => 1 }
        : {
            getAttribute: async (name) =>
              name === "data-motion-vehicle-count" ? "3424" : tickKey,
          },
    evaluate: async () => {
      if (refreshing) throw new Error("E6_REFRESH_NOT_IDLE");
      void triggerRefresh();
    },
    waitForFunction: async (_predicate, previous) => {
      waitCalls += 1;
      if (waitCalls % 2 === 1) {
        while (!refreshing)
          await new Promise((resolve) => setTimeout(resolve, 0));
        return { jsonValue: async () => true, dispose: async () => {} };
      }
      while (refreshing || tickKey === previous)
        await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        jsonValue: async () => ({ tickKey, vehicleCount: 3_424 }),
        dispose: async () => {},
      };
    },
  };

  assert.deepEqual(
    await runObservedRefreshes(page, {
      count: 2,
      expectedVehicleCount: 3_424,
      timeoutMs: 1_000,
      afterTransition: async (transition) => transitions.push(transition),
    }),
    {
      initialTickKey: "tick-0",
      observedTickKeys: ["tick-1", "tick-2"],
    },
  );
  assert.equal(clicks, 2);
  assert.deepEqual(
    transitions.map(({ index, previousTickKey, nextTickKey }) => ({
      index,
      previousTickKey,
      nextTickKey,
    })),
    [
      { index: 0, previousTickKey: "tick-0", nextTickKey: "tick-1" },
      { index: 1, previousTickKey: "tick-1", nextTickKey: "tick-2" },
    ],
  );
});

test("refuses to attribute an already-running refresh to its own click", async () => {
  const page = {
    locator: (selector) =>
      selector.includes("refresh-control")
        ? { count: async () => 1 }
        : {
            getAttribute: async (name) =>
              name === "data-motion-vehicle-count" ? "3424" : "tick-0",
          },
    evaluate: async () => {
      throw new Error("E6_REFRESH_NOT_IDLE");
    },
  };
  await assert.rejects(
    runObservedRefreshes(page, {
      count: 1,
      expectedVehicleCount: 3_424,
      timeoutMs: 1_000,
    }),
    /E6_REFRESH_INCOMPLETE index=0/u,
  );
});

test("rejects a no-op asserted action and returns exactly the requested action count", async () => {
  await assert.rejects(
    runAssertedActions([{ name: "no-op", run: async () => false }], 1, {
      delayMs: 0,
    }),
    /E6_ACTION_MISSED name=no-op/u,
  );
  assert.deepEqual(
    await runAssertedActions([{ name: "toggle", run: async () => true }], 3, {
      delayMs: 0,
    }),
    ["toggle", "toggle", "toggle"],
  );
});

test("discovers a vehicle point without opening its detail", async () => {
  const { page, moves } = createTrustedInteractionPage(
    (point) => point?.x === 36 && point.y === 12,
  );

  assert.deepEqual(await findLiveVehiclePoint(page), { x: 36, y: 12 });

  assert.deepEqual(moves, [
    { x: 35, y: 12 },
    { x: 36, y: 12 },
  ]);
});

test("discovers camera-dependent targets inside the exact 13-action sequence", async () => {
  const { page, moves } = createTrustedInteractionPage(
    (point, completedPicks, filtered, smooth) => {
      const expected = [
        { x: 36, filtered: false, smooth: false },
        { x: 12, filtered: true, smooth: true },
        { x: 36, filtered: false, smooth: false },
      ][completedPicks];
      return (
        point?.y === 12 &&
        point.x === expected?.x &&
        filtered === expected.filtered &&
        smooth === expected.smooth
      );
    },
  );
  assert.deepEqual(await runTrustedInteractions(page, { interactions: 13 }), [
    "canvas-vehicle-pick",
    "keyboard-detail-escape",
    "chrome-motion-click",
    "keyboard-motion-enter",
    "keyboard-motion-space",
    "chrome-filter-toggle",
    "canvas-vehicle-pick",
    "keyboard-detail-escape",
    "chrome-motion-click",
    "keyboard-motion-enter",
    "keyboard-motion-space",
    "chrome-filter-toggle",
    "canvas-vehicle-pick",
  ]);
  assert.deepEqual(moves, [
    { x: 35, y: 12 },
    { x: 36, y: 12 },
    { x: 35, y: 12 },
    { x: 36, y: 12 },
    { x: 11, y: 12 },
    { x: 12, y: 12 },
    { x: 35, y: 12 },
    { x: 36, y: 12 },
  ]);
});

test("accepts only a clean raw unfiltered map start with the first point live", async () => {
  const { page } = createTrustedInteractionPage(
    (point) => point?.x === 36 && point.y === 12,
  );
  assert.equal(await assertTrustedInteractionStart(page), true);
  await assert.rejects(
    assertTrustedInteractionStart({
      ...page,
      url: () => "https://example.test/map?vehicle=v1",
    }),
    /E6_INTERACTION_START_STATE_INVALID/u,
  );
});

test("fails when the bounded canvas search finds no live vehicle", async () => {
  const { page } = createTrustedInteractionPage(() => false);
  await assert.rejects(
    runTrustedInteractions(page, { interactions: 1 }),
    /E6_ACTION_MISSED name=canvas-vehicle-pick reason=no-hoverable-vehicle/u,
  );
});

test("fails when a moving map turns the hovered vehicle click into another selection", async () => {
  const { page } = createTrustedInteractionPage(
    (point) => point?.x === 36 && point.y === 12,
    { selectedKindAfterClick: "stop" },
  );
  await assert.rejects(
    runTrustedInteractions(page, { interactions: 1 }),
    /E6_ACTION_FAILED name=canvas-vehicle-pick index=1 cause=selected stop/u,
  );
});

test("clicks the motion switch center through the mouse after Escape settles", async () => {
  const { events, page } = createTrustedInteractionPage(
    (point) => point?.x === 36 && point.y === 12,
    { rejectMotionLocatorClick: true },
  );

  await runTrustedInteractions(page, {
    interactions: 3,
  });

  assert.deepEqual(events, [
    "detail-hidden",
    "selection-gone",
    "motion-mouse-click",
  ]);
});
