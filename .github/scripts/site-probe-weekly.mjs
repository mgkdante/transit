import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const WEEKLY_CRON = "37 10 * * 1";
export const TEST_LABEL = "[AUTOMATED TEST - NOT A LEAD]";
const CONTACT_URL = "https://yesid.dev/contact";
const SUBMIT_URL = "https://api.web3forms.com/submit";
const TRANSIT_PAGES = ["/", "/fr", "/status", "/fr/status", "/map", "/fr/map"];

export function weeklyAllowed(env, schedule) {
  return (
    env.GITHUB_RUN_ATTEMPT === "1" &&
    ((env.GITHUB_EVENT_NAME === "schedule" && schedule === WEEKLY_CRON) ||
      (env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        env.CONTACT_TEST === "true"))
  );
}

// Bounded urlset, never Transit's 17k-entry sitemap. Fail closed on format/growth.
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

function publicLocation(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    !["yesid.dev", "transit.yesid.dev"].includes(url.host)
  )
    throw new Error("unexpected report URL");
  return `${url.origin}${url.pathname}`;
}

export function linkFailures(stdout) {
  try {
    const report = JSON.parse(stdout);
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

export async function probeLinks({
  fetchFn = fetch,
  run = promisify(execFile),
  alert,
}) {
  const failures = [];
  let pages;
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
  if (pages) {
    for (const [sources, target] of [
      [pages, "transit.yesid.dev"],
      [TRANSIT_PAGES.map((p) => `https://transit.yesid.dev${p}`), "yesid.dev"],
    ]) {
      try {
        const { stdout } = await run("lychee", linkArguments(sources, target), {
          timeout: 240_000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        });
        const report = JSON.parse(stdout);
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
        const details = linkFailures(error.stdout);
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

// A fresh context, no saved account state, no analytics transport, no stealth.
// prepare/submit are injection boundaries for synthetic browser regression tests.
export async function probeContact({
  browser,
  alert,
  prepare = async () => {},
  submit = (route) => route.continue(),
}) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
  });
  let posts = 0;
  let blockedAnalytics = 0;
  let failure;
  let providerStatus = null;
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
    page.setDefaultTimeout(20_000);
    const navigation = await page.goto(CONTACT_URL, {
      waitUntil: "domcontentloaded",
    });
    if (navigation?.status() !== 200)
      throw new Error("contact page unavailable");
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
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url() === SUBMIT_URL && r.request().method() === "POST",
      ),
      form.getByTestId("contact-submit").click(),
    ]);
    providerStatus = response.status();
    const result = await response.json();
    if (!response.ok() || result?.success !== true)
      throw new Error("provider rejected the labelled test");
    await page
      .getByTestId("contact-success")
      .filter({ visible: true })
      .first()
      .waitFor();
  } catch {
    failure = posts
      ? `Labelled test failed after one POST (provider HTTP ${providerStatus ?? "unknown"}); no retry. Owner decision required.`
      : "Contact form could not be submitted; no POST sent.";
  } finally {
    await context.close();
  }
  await alert(
    ...(failure
      ? [
          "fire",
          "contact-form",
          "[alert] Weekly contact form test failed",
          `${failure}\nRun: ${runUrl()}`,
        ]
      : [
          "resolve",
          "contact-form",
          `Provider accepted one labelled contact test (HTTP ${providerStatus}). Inbox receipt remains owner evidence. Run: ${runUrl()}`,
        ]),
  );
  const result = {
    code: failure ? 1 : 0,
    posts,
    providerStatus,
    blockedAnalytics,
  };
  console.log(JSON.stringify({ contactProbe: result }));
  return result;
}

function runUrl() {
  return `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "mgkdante/transit"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
}
