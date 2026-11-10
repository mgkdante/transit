import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { kpiSampleState } from "../../contracts/kpis-v1.js";

/** @typedef {{ name: string, url: string, kind: 'health' } | { name: string, url: string, kind: 'kpis' } | { name: string, url: string, kind: 'html', marker: string }} SiteCheck */

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
  {
    name: "transit-kpis",
    url: "https://transit.yesid.dev/api/v1/kpis",
    kind: "kpis",
  },
];

/** @param {SiteCheck} check @param {typeof fetch} fetchFn @param {(state: 'live' | 'demo' | null) => void} sample */
async function checkSite(check, fetchFn, sample) {
  try {
    const response = await fetchFn(check.url, {
      redirect: "manual",
      headers: {
        "cache-control": "no-cache",
        "user-agent": "Transit-site-probe",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (check.kind === "kpis") {
      const state = kpiSampleState(
        await response.json(),
        response.status,
        response.headers.get("retry-after"),
      );
      sample(state);
      return state === null ? "invalid KPI v1 response" : null;
    }
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
    if (check.kind === "kpis") sample(null);
    // Never copy a response body or exception into a public issue.
    return "request failed, timed out, or returned invalid JSON";
  }
}

/**
 * @param {{ checks?: SiteCheck[], fetchFn?: typeof fetch, alert: (...args: string[]) => unknown, pause?: (ms: number) => Promise<unknown>, log?: (value: unknown) => void }} options
 */
export async function probeSites({
  checks = SITE_CHECKS,
  fetchFn = fetch,
  alert,
  pause = sleep,
  log = (value) => console.log(JSON.stringify(value)),
}) {
  const kpis = { samples: 0, live: 0, demo: 0, invalid: 0 };
  /** @param {'live' | 'demo' | null} state */
  function sample(state) {
    kpis.samples++;
    kpis[state ?? "invalid"]++;
  }
  const failures = (
    await Promise.all(
      checks.map(async (check) => {
        let failure = await checkSite(check, fetchFn, sample);
        if (failure) {
          await pause(5_000);
          failure = await checkSite(check, fetchFn, sample);
        }
        return failure ? `${check.name} (${check.url}): ${failure}` : null;
      }),
    )
  ).filter(Boolean);
  if (kpis.samples) log({ kpis });
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
  return `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "yesid-dev/transit"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "local"}`;
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
    const { weeklyAllowed, probeLinks } =
      await import("./site-probe-weekly.mjs");
    if (!weeklyAllowed(process.env, process.env.PROBE_SCHEDULE))
      throw new Error("Weekly probe is not authorized for this event or rerun");
    process.exitCode = await probeLinks({ alert: issueAlert });
  } else {
    process.exitCode = await probeSites({ alert: issueAlert });
  }
}
