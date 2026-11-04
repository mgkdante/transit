import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

/** @typedef {{ name: string, url: string, kind: 'health' } | { name: string, url: string, kind: 'html', marker: string }} SiteCheck */

// Fixed public targets only. No credentials, visitor input, analytics or database access.
/** @type {SiteCheck[]} */
export const SITE_CHECKS = [
  {
    name: "transit-health",
    url: "https://transit.yesid.dev/health",
    kind: "health",
  },
  {
    name: "transit-home",
    url: "https://transit.yesid.dev/",
    kind: "html",
    marker: "Transit",
  },
  {
    name: "yesid-home",
    url: "https://yesid.dev/",
    kind: "html",
    marker: "Yesid",
  },
];

/** @param {SiteCheck} check @param {typeof fetch} fetchFn */
async function checkSite(check, fetchFn) {
  try {
    const response = await fetchFn(check.url, {
      redirect: "manual",
      headers: {
        "cache-control": "no-cache",
        "user-agent": "Transit-site-probe",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) return `HTTP ${response.status}`;
    if (check.kind === "health") {
      const health = await response.json();
      return health?.status === "ok" &&
        health?.data === "readable" &&
        health?.service === "transit-web" &&
        /^[a-f0-9]{40}$/.test(health?.commit ?? "") &&
        typeof health?.branch === "string" &&
        health.branch.length > 0
        ? null
        : "invalid health response or missing deployed version";
    }
    if (!response.headers.get("content-type")?.includes("text/html"))
      return "not HTML";
    const body = await response.text();
    return body.includes("<html") && body.includes(check.marker)
      ? null
      : "missing page content";
  } catch {
    // Never copy a response body or exception into a public issue.
    return "request failed, timed out, or returned invalid JSON";
  }
}

/**
 * @param {{ checks?: SiteCheck[], fetchFn?: typeof fetch, alert: (...args: string[]) => unknown, pause?: (ms: number) => Promise<unknown> }} options
 */
export async function probeSites({
  checks = SITE_CHECKS,
  fetchFn = fetch,
  alert,
  pause = sleep,
}) {
  const failures = (
    await Promise.all(
      checks.map(async (check) => {
        let failure = await checkSite(check, fetchFn);
        if (failure) {
          await pause(5_000);
          failure = await checkSite(check, fetchFn);
        }
        return failure ? `${check.name} (${check.url}): ${failure}` : null;
      }),
    )
  ).filter(Boolean);
  if (failures.length) {
    await alert(
      "fire",
      "site-availability",
      "[alert] Public site unavailable",
      `Failed twice, five seconds apart:\n\n${failures.join("\n")}\n\nRun: ${runUrl()}`,
    );
    return 1;
  }
  await alert(
    "resolve",
    "site-availability",
    `All public site checks recovered. Run: ${runUrl()}`,
  );
  return 0;
}

function runUrl() {
  return `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "mgkdante/transit"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
}

/** @param {string[]} args */
function issueAlert(...args) {
  const result = spawnSync(
    "bash",
    [fileURLToPath(new URL("./alert-issue.sh", import.meta.url)), ...args],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error || result.status !== 0)
    throw new Error("GitHub issue alert failed");
}

// The alert adapter intentionally runs on the Linux Actions host, like the data probes.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "--weekly") {
    const { weeklyAllowed, probeContact, probeLinks } =
      await import("./site-probe-weekly.mjs");
    if (!weeklyAllowed(process.env, process.env.PROBE_SCHEDULE))
      throw new Error("Weekly probe is not authorized for this event or rerun");
    const { chromium } = await import("@playwright/test");
    const { verifyInstalledBrowserArtifact } =
      await import("../../apps/web/scripts/browser-toolchain.mjs");
    const { paths } = await verifyInstalledBrowserArtifact();
    const browser = await chromium.launch({
      executablePath: paths.executablePath,
    });
    let contact;
    try {
      contact = await probeContact({ browser, alert: issueAlert });
    } finally {
      await browser.close();
    }
    // A rejected send is an owner decision. Never retry or work around it.
    process.exitCode =
      contact.code || (await probeLinks({ alert: issueAlert }));
  } else {
    process.exitCode = await probeSites({ alert: issueAlert });
  }
}
