import { createRequire } from "node:module";

const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);

export function resolveChromeExecutable(env = process.env) {
  return (
    env.E6_CHROME_EXECUTABLE ||
    env.CHROME_EXECUTABLE ||
    "/usr/bin/google-chrome"
  );
}

export function loadChromium() {
  return require("playwright-core").chromium;
}

export async function launchChromium({
  chromium = loadChromium(),
  executablePath,
  headless = true,
} = {}) {
  return chromium.launch({
    headless,
    executablePath: executablePath ?? resolveChromeExecutable(),
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
}

export async function createArmContext(
  browser,
  { rate, storage = {}, viewport = { width: 1440, height: 960 } } = {},
) {
  if (rate !== undefined && rate !== 1)
    throw new Error("E6_BINDING_ARM_REQUIRED rate must equal 1");
  const context = await browser.newContext({
    viewport,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    // The harness serves its immutable app build and recording replay on two
    // loopback ports. Bypass the production connect-src policy only inside
    // this isolated Playwright context so the local replay remains offline.
    bypassCSP: true,
  });
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries))
      localStorage.setItem(key, value);
  }, storage);
  const page = await context.newPage();
  return { context, page };
}

export async function observeForbiddenVitals(page) {
  const attempts = [];
  await page.route("**/api/vitals", async (route) => {
    attempts.push(route.request().url());
    await route.abort();
  });
  return attempts;
}

export function assertNoVitalsRequests(attempts) {
  if (!Array.isArray(attempts)) throw new Error("E6_VITALS_OBSERVER_INVALID");
  if (attempts.length !== 0) {
    throw new Error(
      `E6_VITALS_REQUEST_FORBIDDEN count=${attempts.length} urls=${attempts.join(",")}`,
    );
  }
  return 0;
}

export async function waitForMapReady(page, { timeoutMs = 20_000 } = {}) {
  await page
    .locator(
      '.map-hero[data-motion-stale="false"][data-motion-tick-key][data-motion-vehicle-count]',
    )
    .waitFor({ state: "visible", timeout: timeoutMs });
  await page
    .locator("canvas.maplibregl-canvas")
    .waitFor({ state: "visible", timeout: timeoutMs });
}

export async function readMapTickSnapshot(page) {
  const hero = page.locator(
    ".map-hero[data-motion-tick-key][data-motion-vehicle-count]",
  );
  const tickKey = await hero.getAttribute("data-motion-tick-key");
  const vehicleCount = Number(
    await hero.getAttribute("data-motion-vehicle-count"),
  );
  if (
    typeof tickKey !== "string" ||
    tickKey.length === 0 ||
    !Number.isSafeInteger(vehicleCount) ||
    vehicleCount < 1
  )
    throw new Error("E6_REPLAY_TICK_KEY_MISSING");
  return { tickKey, vehicleCount };
}

export async function waitForMapTickChange(
  page,
  { previousTickKey, expectedVehicleCount, timeoutMs } = {},
) {
  if (
    typeof previousTickKey !== "string" ||
    previousTickKey.length === 0 ||
    !Number.isSafeInteger(expectedVehicleCount) ||
    expectedVehicleCount < 1 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new Error("E6_REPLAY_TICK_OBSERVATION_INVALID");
  }
  let handle;
  try {
    handle = await page.waitForFunction(
      ({ previous, expectedCount }) => {
        const hero = document.querySelector(
          ".map-hero[data-motion-tick-key][data-motion-vehicle-count]",
        );
        const tickKey = hero?.getAttribute("data-motion-tick-key");
        const vehicleCount = Number(
          hero?.getAttribute("data-motion-vehicle-count"),
        );
        return tickKey && tickKey !== previous && vehicleCount === expectedCount
          ? { tickKey, vehicleCount }
          : false;
      },
      { previous: previousTickKey, expectedCount: expectedVehicleCount },
      { timeout: timeoutMs },
    );
  } catch (error) {
    throw new Error("E6_REPLAY_TICK_OBSERVATION_INCOMPLETE", { cause: error });
  }
  const next = await handle.jsonValue();
  await handle.dispose();
  if (
    typeof next?.tickKey !== "string" ||
    next.tickKey.length === 0 ||
    next.tickKey === previousTickKey ||
    next.vehicleCount !== expectedVehicleCount
  )
    throw new Error("E6_REPLAY_TICK_OBSERVATION_INVALID");
  return next;
}

const REFRESH_BUTTON = '[data-slot="refresh-control"] button[data-refreshing]';

export async function runObservedRefreshes(
  page,
  {
    count = 2,
    expectedVehicleCount,
    timeoutMs = 20_000,
    afterTransition = async () => {},
  } = {},
) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(expectedVehicleCount) ||
    expectedVehicleCount < 1 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    typeof afterTransition !== "function"
  )
    throw new Error("E6_REFRESH_OBSERVATION_INVALID");
  if ((await page.locator(REFRESH_BUTTON).count()) !== 1)
    throw new Error("E6_REFRESH_CONTROL_MISSING");
  const initial = await readMapTickSnapshot(page);
  const observedTickKeys = [];
  let previousTickKey = initial.tickKey;
  for (let index = 0; index < count; index += 1) {
    const deadline = Date.now() + timeoutMs;
    try {
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (!(button instanceof HTMLButtonElement))
          throw new Error("E6_REFRESH_CONTROL_MISSING");
        if (
          button.getAttribute("data-refreshing") !== "false" ||
          button.disabled
        )
          throw new Error("E6_REFRESH_NOT_IDLE");
        button.click();
      }, REFRESH_BUTTON);
      const startedHandle = await page.waitForFunction(
        (selector) => {
          const button = document.querySelector(selector);
          return button?.getAttribute("data-refreshing") === "true" &&
            button.hasAttribute("disabled")
            ? true
            : false;
        },
        REFRESH_BUTTON,
        { timeout: Math.min(1_000, timeoutMs) },
      );
      await startedHandle.dispose();
      const completed = await page.waitForFunction(
        ({ selector, previous, expectedCount }) => {
          const button = document.querySelector(selector);
          const hero = document.querySelector(
            ".map-hero[data-motion-tick-key][data-motion-vehicle-count]",
          );
          const tickKey = hero?.getAttribute("data-motion-tick-key");
          const vehicleCount = Number(
            hero?.getAttribute("data-motion-vehicle-count"),
          );
          return button?.getAttribute("data-refreshing") === "false" &&
            !button.hasAttribute("disabled") &&
            tickKey &&
            tickKey !== previous &&
            vehicleCount === expectedCount
            ? { tickKey, vehicleCount }
            : false;
        },
        {
          selector: REFRESH_BUTTON,
          previous: previousTickKey,
          expectedCount: expectedVehicleCount,
        },
        { timeout: Math.max(1, deadline - Date.now()) },
      );
      const next = await completed.jsonValue();
      await completed.dispose();
      if (
        typeof next?.tickKey !== "string" ||
        next.tickKey === previousTickKey ||
        next.vehicleCount !== expectedVehicleCount
      )
        throw new Error("E6_REFRESH_OBSERVATION_INVALID");
      await afterTransition({
        index,
        previousTickKey,
        nextTickKey: next.tickKey,
        vehicleCount: next.vehicleCount,
      });
      observedTickKeys.push(next.tickKey);
      previousTickKey = next.tickKey;
    } catch (error) {
      throw new Error(`E6_REFRESH_INCOMPLETE index=${index}`, { cause: error });
    }
  }
  return { initialTickKey: initial.tickKey, observedTickKeys };
}

const DESKTOP_MOTION =
  '.map-filter-panel .map-filters[data-presentation="desktop"][data-open="true"] [data-testid="map-motion-switch"]';
const DESKTOP_FILTER =
  '.map-filter-panel .map-filters[data-presentation="desktop"] .mf-shape-chip';

async function hoverLiveVehicleAt(page, peek, { x, y }) {
  await page.mouse.move(x - 1, y);
  await page.mouse.move(x, y);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const pointer = await page.evaluate(
    ({ x: px, y: py }) => {
      const target = document.elementFromPoint(px, py);
      return target ? getComputedStyle(target).cursor === "pointer" : false;
    },
    { x, y },
  );
  return pointer && (await peek.isVisible());
}

async function clickLiveVehicleAt(page, point) {
  const { x, y } = point;
  await page.mouse.click(x, y);
  await page
    .locator('.map-hero[data-selection-presence="present"]')
    .waitFor({ state: "visible" });
  await page
    .locator('[data-slot="map-detail-overlay"]')
    .waitFor({ state: "visible" });
  await page
    .locator('.map-selection-detail[data-kind="vehicle"]')
    .waitFor({ state: "visible" });
  return point;
}

export async function findLiveVehiclePoint(page) {
  const peek = page.locator('.map-peek .map-hover-peek[data-kind="vehicle"]');
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  if (!box)
    throw new Error(
      "E6_ACTION_MISSED name=canvas-vehicle-pick reason=canvas-not-visible",
    );
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const points = [];
  for (let y = Math.ceil(box.y) + 12; y < box.y + box.height - 12; y += 24) {
    for (let x = Math.ceil(box.x) + 12; x < box.x + box.width - 12; x += 24)
      points.push({ x, y });
  }
  points.sort(
    (left, right) =>
      Math.hypot(left.x - center.x, left.y - center.y) -
        Math.hypot(right.x - center.x, right.y - center.y) ||
      left.y - right.y ||
      left.x - right.x,
  );
  for (const point of points) {
    if (await hoverLiveVehicleAt(page, peek, point)) return point;
  }
  throw new Error(
    "E6_ACTION_MISSED name=canvas-vehicle-pick reason=no-hoverable-vehicle",
  );
}

function trustedFilter(page) {
  return page.locator(DESKTOP_FILTER).first();
}

export async function assertTrustedInteractionStart(page) {
  const url = new URL(page.url());
  const motion = page.locator(DESKTOP_MOTION);
  const filter = trustedFilter(page);
  if (
    url.pathname !== "/map" ||
    url.search !== "" ||
    (await motion.count()) !== 1 ||
    (await motion.getAttribute("aria-checked")) !== "false" ||
    (await filter.getAttribute("aria-pressed")) !== "false"
  )
    throw new Error("E6_INTERACTION_START_STATE_INVALID");
  await page
    .locator('.map-hero[data-selection-presence="gone"]')
    .waitFor({ state: "visible" });
  return true;
}

export async function runAssertedActions(
  actions,
  interactions,
  { delayMs = 80 } = {},
) {
  if (
    !Number.isInteger(interactions) ||
    interactions < 1 ||
    !Array.isArray(actions) ||
    actions.length === 0
  )
    throw new Error("E6_INTERACTIONS_INVALID");
  const completed = [];
  for (let index = 0; index < interactions; index += 1) {
    const action = actions[index % actions.length];
    let changed;
    try {
      changed = await action.run();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `E6_ACTION_FAILED name=${action.name} index=${index + 1} cause=${reason}`,
        { cause: error },
      );
    }
    if (changed !== true)
      throw new Error(
        `E6_ACTION_MISSED name=${action.name} index=${index + 1} reason=state-unchanged`,
      );
    completed.push(action.name);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return completed;
}

async function trustedInteractionActions(page) {
  const motion = page.locator(DESKTOP_MOTION);
  const filter = trustedFilter(page);
  if ((await motion.count()) !== 1)
    throw new Error("E6_ACTION_MISSED name=motion-switch reason=missing");
  const toggle = async (locator, input) => {
    const before =
      (await locator.getAttribute("aria-checked")) ??
      (await locator.getAttribute("aria-pressed"));
    await input();
    const after =
      (await locator.getAttribute("aria-checked")) ??
      (await locator.getAttribute("aria-pressed"));
    return before !== after;
  };
  return [
    {
      name: "canvas-vehicle-pick",
      run: async () => {
        await clickLiveVehicleAt(page, await findLiveVehiclePoint(page));
        return true;
      },
    },
    {
      name: "keyboard-detail-escape",
      run: async () => {
        await page.keyboard.press("Escape");
        await page
          .locator('[data-slot="map-detail-overlay"]')
          .waitFor({ state: "hidden" });
        await page
          .locator('.map-hero[data-selection-presence="gone"]')
          .waitFor({ state: "visible" });
        return !/[?&](vehicle|route|stop|trip)=/u.test(
          new URL(page.url()).search,
        );
      },
    },
    {
      name: "chrome-motion-click",
      run: () =>
        toggle(motion, async () => {
          const box = await motion.boundingBox();
          if (!box)
            throw new Error(
              "E6_ACTION_MISSED name=chrome-motion-click reason=not-visible",
            );
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }),
    },
    {
      name: "keyboard-motion-enter",
      run: async () => {
        await motion.focus();
        return toggle(motion, () => page.keyboard.press("Enter"));
      },
    },
    {
      name: "keyboard-motion-space",
      run: async () => {
        await motion.focus();
        return toggle(motion, () => page.keyboard.press("Space"));
      },
    },
    {
      name: "chrome-filter-toggle",
      run: () => toggle(filter, () => filter.click()),
    },
  ];
}

export async function runTrustedInteractions(page, { interactions } = {}) {
  if (!Number.isSafeInteger(interactions) || interactions < 1)
    throw new Error("E6_INTERACTIONS_INVALID");
  return runAssertedActions(
    await trustedInteractionActions(page),
    interactions,
  );
}
