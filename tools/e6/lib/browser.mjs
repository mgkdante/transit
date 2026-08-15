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
    .locator('.map-hero[data-motion-stale="false"][data-motion-tick-key]')
    .waitFor({ state: "visible", timeout: timeoutMs });
  await page
    .locator("canvas.maplibregl-canvas")
    .waitFor({ state: "visible", timeout: timeoutMs });
}

const DESKTOP_MOTION =
  '.map-filter-panel .map-filters[data-presentation="desktop"][data-open="true"] [data-testid="map-motion-switch"]';

async function pickLiveVehicle(page) {
  const box = await page.locator("canvas.maplibregl-canvas").boundingBox();
  if (!box)
    throw new Error(
      "E6_ACTION_MISSED name=canvas-vehicle-pick reason=canvas-not-visible",
    );
  const peek = page.locator('.map-peek .map-hover-peek[data-kind="vehicle"]');
  for (let y = Math.ceil(box.y) + 12; y < box.y + box.height - 12; y += 24) {
    for (let x = Math.ceil(box.x) + 12; x < box.x + box.width - 12; x += 24) {
      await page.mouse.move(x, y);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const pointer = await page.evaluate(
        ({ x: px, y: py }) => {
          const target = document.elementFromPoint(px, py);
          return target ? getComputedStyle(target).cursor === "pointer" : false;
        },
        { x, y },
      );
      if (!pointer || !(await peek.isVisible())) continue;
      await page.mouse.click(x, y);
      await page
        .locator('.map-hero[data-selection-presence="present"]')
        .waitFor({ state: "visible" });
      await page
        .locator('[data-slot="map-detail-overlay"]')
        .waitFor({ state: "visible" });
      return true;
    }
  }
  throw new Error(
    "E6_ACTION_MISSED name=canvas-vehicle-pick reason=no-hoverable-vehicle",
  );
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
    if ((await action.run()) !== true)
      throw new Error(
        `E6_ACTION_MISSED name=${action.name} reason=state-unchanged`,
      );
    completed.push(action.name);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return completed;
}

export async function runTrustedInteractions(page, { interactions = 13 } = {}) {
  const motion = page.locator(DESKTOP_MOTION);
  const filter = page
    .locator(
      '.map-filter-panel .map-filters[data-presentation="desktop"] .mf-shape-chip',
    )
    .first();
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
  return runAssertedActions(
    [
      { name: "canvas-vehicle-pick", run: () => pickLiveVehicle(page) },
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
        run: () => toggle(motion, () => motion.click()),
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
    ],
    interactions,
  );
}
