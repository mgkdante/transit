import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const WEEKLY_CRON = "37 10 * * 1";
const TRANSIT_PAGES = ["/", "/fr", "/status", "/fr/status", "/map", "/fr/map"];

/** @typedef {(...args: string[]) => unknown} Alert */
/** @typedef {{error_map?: Record<string, {url: string}[]>, timeout_map?: Record<string, {url: string}[]>}} LinkReport */

/** @param {Record<string, string | undefined>} env @param {string | undefined} schedule */
export function weeklyAllowed(env, schedule) {
  return (
    env.GITHUB_RUN_ATTEMPT === "1" &&
    ((env.GITHUB_EVENT_NAME === "schedule" && schedule === WEEKLY_CRON) ||
      (env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
        env.LINK_CHECK === "true"))
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

function runUrl() {
  return `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "mgkdante/transit"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
}
