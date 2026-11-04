import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const WEEKLY_CRON = "37 10 * * 1";
export const TEST_LABEL = "[AUTOMATED TEST - NOT A LEAD]";
const CONTACT_URL = "https://yesid.dev/contact";
const SUBMIT_URL = "https://api.web3forms.com/submit";
const TRANSIT_PAGES = ["/", "/fr", "/status", "/fr/status", "/map", "/fr/map"];

/** @typedef {(...args: string[]) => unknown} Alert */
/** @typedef {{error_map?: Record<string, {url: string}[]>, timeout_map?: Record<string, {url: string}[]>}} LinkReport */

/** @param {Record<string, string | undefined>} env @param {string | undefined} schedule */
export function weeklyAllowed(env, schedule) {
  return (
    env.GITHUB_RUN_ATTEMPT === "1" &&
    ((env.GITHUB_EVENT_NAME === "schedule" && schedule === WEEKLY_CRON) ||
      (env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        env.CONTACT_TEST === "true"))
  );
}

// Bounded urlset, never Transit's 17k-entry sitemap. Fail closed on format/growth.
/** @param {string} xml */
export function sitemapPages(xml) {
  if (
    !/<urlset[\s>]/.test(xml) ||
    !/<\/urlset>\s*$/.test(xml) ||
    /<sitemapindex[\s>]/.test(xml)
  )
    throw new Error("expected complete urlset");
  const pages = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) =>
    m[1].replaceAll("&amp;", "&"),
  );
  if (
    !pages.length ||
    pages.length > 200 ||
    pages.length !== [...xml.matchAll(/<loc\b/g)].length
  )
    throw new Error("sitemap page budget or incomplete entries");
  for (const page of pages) {
    const url = new URL(page);
    if (url.origin !== "https://yesid.dev" || url.username || url.password)
      throw new Error("unexpected sitemap host");
  }
  return [...new Set(pages)];
}

/** @param {string[]} pages @param {string} targetHost */
export function linkArguments(pages, targetHost) {
  return [
    "--no-progress",
    "--format",
    "json",
    "--max-concurrency",
    "2",
    "--max-retries",
    "0",
    "--timeout",
    "15",
    "--max-redirects",
    "0",
    "--exclude-all-private",
    "--include",
    `^https://${targetHost.replaceAll(".", "\\.")}(?:/|$)`,
    ...pages,
  ];
}

/** @param {string} raw */
function publicLocation(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !["yesid.dev", "transit.yesid.dev"].includes(url.host)
  )
    throw new Error("unexpected report URL");
  return `${url.origin}${url.pathname}`;
}

/** @param {string | Buffer | undefined} stdout */
export function linkFailures(stdout) {
  try {
    /** @type {LinkReport} */
    const report = JSON.parse(stdout?.toString() ?? "");
    return [
      ...new Set(
        [report.error_map, report.timeout_map].flatMap((map) =>
          Object.entries(map ?? {}).flatMap(([source, errors]) =>
            errors.map(
              (error) =>
                `${publicLocation(source)} -> ${publicLocation(error.url)}`,
            ),
          ),
        ),
      ),
    ].slice(0, 20);
  } catch {
    return [];
  }
}

/** @param {{fetchFn?: typeof fetch, run?: (file: string, args: string[], options: {timeout: number, maxBuffer: number, windowsHide: boolean}) => Promise<{stdout: string | Buffer}>, alert: Alert}} options */
export async function probeLinks({
  fetchFn = fetch,
  run = promisify(execFile),
  alert,
}) {
  const failures = [];
  /** @type {string[]} */
  let pages = [];
  try {
    const response = await fetchFn("https://yesid.dev/sitemap.xml", {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) throw new Error("sitemap unavailable");
    pages = sitemapPages(await response.text());
  } catch {
    failures.push("yesid.dev sitemap could not be read completely");
  }
  if (pages.length) {
    /** @type {[string[], string][]} */
    const directions = [
      [pages, "transit.yesid.dev"],
      [TRANSIT_PAGES.map((p) => `https://transit.yesid.dev${p}`), "yesid.dev"],
    ];
    for (const [sources, target] of directions) {
      try {
        const { stdout } = await run("lychee", linkArguments(sources, target), {
          timeout: 240_000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        });
        const report = JSON.parse(stdout.toString());
        if (!(report.successful > 0))
          throw new Error("no cross-site links checked");
        console.log(
          JSON.stringify({
            linksTo: target,
            sources: sources.length,
            successful: report.successful,
          }),
        );
      } catch (error) {
        const stdout =
          error &&
          typeof error === "object" &&
          "stdout" in error &&
          (typeof error.stdout === "string" || Buffer.isBuffer(error.stdout))
            ? error.stdout
            : undefined;
        const details = linkFailures(stdout);
        failures.push(
          `links to ${target} failed${details.length ? `:\n${details.join("\n")}` : "; source unavailable, tool failed, or no cross-site links found"}`,
        );
      }
    }
  }
  await alert(
    ...(failures.length
      ? [
          "fire",
          "cross-site-links",
          "[alert] Cross-site links failed",
          `${failures.join("\n")}\nRun: ${runUrl()}`,
        ]
      : [
          "resolve",
          "cross-site-links",
          `Cross-site links recovered (${pages.length} yesid.dev pages). Run: ${runUrl()}`,
        ]),
  );
  return failures.length ? 1 : 0;
}

/** @param {string} rawUrl @param {string} method */
export function contactPolicy(rawUrl, method) {
  const url = new URL(rawUrl);
  if (url.href === SUBMIT_URL && method === "POST") return "submit";
  if (
    url.origin === "https://yesid.dev" &&
    method === "GET" &&
    (url.pathname === "/contact" ||
      url.pathname.startsWith("/_app/") ||
      url.pathname.startsWith("/fonts/") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname === "/favicon.ico")
  )
    return "read";
  return "block";
}

/** @param {unknown} value @param {string[]} sensitive */
function diagnosticText(value, sensitive) {
  if (typeof value !== "string") return null;
  let text = value;
  for (const secret of sensitive
    .flatMap((part) => [
      part,
      JSON.stringify(part).slice(1, -1),
      ...part.split(/\r?\n/),
    ])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(secret, "[redacted]");
  }
  return text.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500);
}

/** @param {unknown} error @param {string[]} sensitive */
function diagnosticErrorName(error, sensitive) {
  const name = diagnosticText(
    error instanceof Error ? error.name : "UnknownError",
    sensitive,
  );
  return name && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
    ? name
    : "UnknownError";
}

/** @typedef {{value: unknown, error?: never} | {value?: never, error: unknown}} ProviderRead */

/** @param {import('@playwright/test').Response} response @param {number} timeoutMs @returns {Promise<ProviderRead>} */
async function readProviderJSON(response, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    const value = await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("provider body timeout");
          error.name = "TimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
    return { value };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timer);
  }
}

// A fresh context, no saved account state, no analytics transport, no stealth.
// prepare/submit/log/timeoutMs are synthetic-test boundaries, never CLI settings.
/** @param {{browser: import('@playwright/test').Browser, alert: Alert, prepare?: (context: import('@playwright/test').BrowserContext) => Promise<unknown>, submit?: (route: import('@playwright/test').Route) => Promise<unknown>, log?: (entry: unknown) => void, timeoutMs?: number}} options */
export async function probeContact({
  browser,
  alert,
  prepare = async () => {},
  submit = (route) => route.continue(),
  log = (entry) => console.log(JSON.stringify(entry)),
  timeoutMs = 20_000,
}) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
  });
  let posts = 0;
  let blockedAnalytics = 0;
  let failed = false;
  let stage = "navigation";
  /** @type {string | null} */
  let category = null;
  /** @type {string | null} */
  let errorName = null;
  /** @type {string[]} */
  const sensitive = [];
  /** @type {{providerStatus: number | null, navigationStatus: number | null, responseObserved: boolean, requestFailureText: string | null, providerSuccess: boolean | null, providerMessage: string | null, providerJSONErrorName: string | null, read: Promise<ProviderRead> | null}} */
  const evidence = {
    providerStatus: null,
    navigationStatus: null,
    responseObserved: false,
    requestFailureText: null,
    providerSuccess: null,
    providerMessage: null,
    providerJSONErrorName: null,
    read: null,
  };
  /** @param {unknown} value */
  function captureProviderFields(value) {
    if (value && typeof value === "object") {
      evidence.providerSuccess =
        "success" in value && typeof value.success === "boolean"
          ? value.success
          : null;
      evidence.providerMessage = diagnosticText(
        "message" in value ? value.message : null,
        sensitive,
      );
    }
  }
  /** @param {import('@playwright/test').Request} request */
  function onRequestFailed(request) {
    if (request.url() !== SUBMIT_URL || request.method() !== "POST") return;
    evidence.requestFailureText = diagnosticText(
      request.failure()?.errorText ?? "unknown",
      sensitive,
    );
    log({
      contactRequestFailed: { stage, errorText: evidence.requestFailureText },
    });
  }
  /** @param {import('@playwright/test').Response} response */
  function onResponse(response) {
    if (response.url() !== SUBMIT_URL || response.request().method() !== "POST")
      return;
    evidence.responseObserved = true;
    evidence.providerStatus = response.status();
    evidence.read = readProviderJSON(response, timeoutMs);
  }
  context.on("requestfailed", onRequestFailed);
  context.on("response", onResponse);
  try {
    await prepare(context);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const policy = contactPolicy(request.url(), request.method());
      if (policy === "read") return route.fallback();
      if (policy === "submit" && posts === 0) {
        let body;
        try {
          body = request.postDataJSON();
        } catch {
          return route.abort();
        }
        if (!body || typeof body !== "object") return route.abort();
        // Only these exact request strings are retained for redaction, never logged.
        sensitive.push(
          ...Object.values(body).filter((value) => typeof value === "string"),
        );
        if (
          body?.from_name !== TEST_LABEL ||
          !body?.subject?.includes(TEST_LABEL) ||
          !body?.message?.includes("not a lead")
        ) {
          return route.abort();
        }
        posts++;
        return submit(route);
      }
      if (
        /plausible|analytics|insights|api\/event|speed-insights/.test(
          request.url(),
        )
      )
        blockedAnalytics++;
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const navigation = await page.goto(CONTACT_URL, {
      waitUntil: "domcontentloaded",
    });
    evidence.navigationStatus = navigation?.status() ?? null;
    if (evidence.navigationStatus !== 200)
      throw new Error("contact page unavailable");
    stage = "fill";
    const form = page
      .getByTestId("contact-form-terminal")
      .filter({ visible: true })
      .first();
    await form.locator('[name="name"]').fill(TEST_LABEL);
    await form.locator('[name="email"]').fill("admin@yesid.dev");
    await form
      .locator('[name="message"]')
      .fill(
        `${TEST_LABEL}\nWeekly contact delivery check, not a lead. No reply needed.\nRun: ${runUrl()}`,
      );
    // Settle the waiter immediately so a click failure cannot leave an unhandled rejection.
    const responseOutcome = page
      .waitForResponse(
        (r) => r.url() === SUBMIT_URL && r.request().method() === "POST",
      )
      .then(
        (response) => ({ response, error: null }),
        (error) => ({ response: null, error }),
      );
    stage = "click";
    await form.getByTestId("contact-submit").click();
    stage = "waiting-for-response";
    const outcome = await responseOutcome;
    if (!outcome.response) throw outcome.error;
    stage = "reading-json";
    const provider = await (evidence.read ??
      readProviderJSON(outcome.response, timeoutMs));
    if ("error" in provider) throw provider.error;
    captureProviderFields(provider.value);
    if (!outcome.response.ok() || evidence.providerSuccess !== true) {
      category = "provider-rejected";
      throw new Error("provider rejected the labelled test");
    }
    stage = "success-notice";
    await page
      .getByTestId("contact-success")
      .filter({ visible: true })
      .first()
      .waitFor();
  } catch (error) {
    failed = true;
    errorName = diagnosticErrorName(error, sensitive);
    category ??= evidence.requestFailureText
      ? "request-failed"
      : errorName === "TimeoutError"
        ? "timeout"
        : stage === "reading-json" && errorName === "SyntaxError"
          ? "invalid-json"
          : "browser-error";
  } finally {
    if (evidence.read) {
      const provider = await evidence.read;
      if ("error" in provider)
        evidence.providerJSONErrorName = diagnosticErrorName(
          provider.error,
          sensitive,
        );
      else captureProviderFields(provider.value);
    }
    // Do not misreport our own cleanup abort as evidence of a transport failure.
    context.off("requestfailed", onRequestFailed);
    context.off("response", onResponse);
    await context.close();
  }
  const result = {
    code: failed ? 1 : 0,
    posts,
    providerStatus: evidence.providerStatus,
    blockedAnalytics,
    diagnostics: {
      stage,
      category,
      errorName,
      navigationStatus: evidence.navigationStatus,
      responseObserved: evidence.responseObserved,
      providerSuccess: evidence.providerSuccess,
      providerMessage: evidence.providerMessage,
      providerJSONErrorName: evidence.providerJSONErrorName,
      requestFailureText: evidence.requestFailureText,
    },
  };
  // Log before alert delivery, so adapter failure cannot erase the diagnostic.
  log({ contactProbe: result });
  const report = `Diagnostics:\n    ${JSON.stringify(result)}\nRun: ${runUrl()}`;
  await alert(
    ...(failed
      ? [
          "fire",
          "contact-form",
          "[alert] Weekly contact form test failed",
          `Labelled contact test failed; ${posts} POST(s), no retry.\n${report}`,
        ]
      : [
          "resolve",
          "contact-form",
          `Provider accepted one labelled contact test. Inbox receipt remains owner evidence.\n${report}`,
        ]),
  );
  return result;
}

function runUrl() {
  return `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "mgkdante/transit"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
}
