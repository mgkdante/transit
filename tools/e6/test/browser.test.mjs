import assert from "node:assert/strict";
import test from "node:test";

import {
  createArmContext,
  resolveChromeExecutable,
  runAssertedActions,
} from "../lib/browser.mjs";

test("uses the E6 executable override before the system Chrome fallback", () => {
  assert.equal(
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
