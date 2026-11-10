import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { plannedCoverage } from "./layout-shards.mjs";

function reviewedApplicability(spec, item) {
  const desktop = /^layout-(?:chromium|webkit)-(\d+)-(?:light|dark)$/.exec(
    item.projectName ?? "",
  );
  if (
    spec.file !== "layout-map.spec.ts" ||
    spec.title !==
      "mobile detail sheet keeps its header controls above the home indicator at peek @layout" ||
    !desktop ||
    Number(desktop[1]) < 1024 ||
    item.expectedStatus !== "skipped"
  )
    return undefined;
  return item.annotations?.find(
    (annotation) =>
      annotation.type === "skip" &&
      annotation.description ===
        "desktop shows the detail panel, not the sheet",
  );
}

function caseCount(suites, notApplicable) {
  if (!Array.isArray(suites)) throw new Error("Invalid timing suites");
  return suites.reduce(
    (total, suite) =>
      total +
      (suite.specs ?? []).reduce((count, spec) => {
        for (const item of spec.tests) {
          const skip = reviewedApplicability(spec, item);
          const declared =
            item.expectedStatus === "skipped" &&
            skip &&
            [spec.id, spec.file, spec.title, item.projectName].every(
              (value) => typeof value === "string" && value.length,
            );
          if (
            !Array.isArray(item.results) ||
            item.results.length === 0 ||
            item.results.some(
              (result) =>
                !Number.isFinite(result.duration) ||
                result.duration < 0 ||
                !(declared
                  ? result.status === "skipped"
                  : ["passed", "failed", "timedOut"].includes(result.status)),
            )
          ) {
            throw new Error("Incomplete case durations");
          }
          if (declared)
            notApplicable.push({
              id: spec.id,
              file: spec.file,
              title: spec.title,
              project: item.projectName,
              reason: skip.description,
              overhead_ms: item.results.reduce(
                (total, result) => total + result.duration,
                0,
              ),
            });
        }
        return count + spec.tests.length;
      }, 0) +
      caseCount(suite.suites ?? [], notApplicable),
    0,
  );
}

function validateIdentity(identity) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(identity.repository ?? "") ||
    ![identity.source_sha, identity.head_sha].every((sha) =>
      /^[a-f0-9]{40}$/.test(sha ?? ""),
    ) ||
    ![identity.run_id, identity.attempt].every((id) =>
      /^[1-9][0-9]*$/.test(id ?? ""),
    )
  ) {
    throw new Error("Invalid timing provenance");
  }
}

function validateReport(report, expected, planned) {
  const pin = expected.playwright;
  const shard = planned?.shard ?? report.config?.shard;
  if (
    !/^\d+\.\d+\.\d+$/.test(pin ?? "") ||
    report.config?.version !== pin ||
    report.config?.workers !== 2 ||
    shard?.current !== expected.shard.current ||
    shard?.total !== expected.shard.total ||
    !Number.isInteger(shard.current) ||
    !Number.isInteger(shard.total) ||
    shard.total < 1 ||
    shard.current < 1 ||
    shard.current > shard.total
  ) {
    throw new Error("Timing toolchain or shard identity mismatch");
  }
  const stats = report.stats;
  const counts = ["expected", "unexpected", "flaky", "skipped"].map(
    (key) => stats?.[key],
  );
  const notApplicable = [];
  const selected = caseCount(report.suites, notApplicable);
  if (
    !counts.every((value) => Number.isInteger(value) && value >= 0) ||
    !Number.isFinite(stats?.duration) ||
    stats.duration < 0 ||
    stats.skipped !== notApplicable.length ||
    stats.expected + stats.unexpected + stats.flaky === 0 ||
    selected !== counts.reduce((a, b) => a + b, 0)
  ) {
    throw new Error("Incomplete or unexecuted layout timing report");
  }
  return {
    playwright: pin,
    workers: report.config.workers,
    shard,
    stats,
    selected_cases: selected,
    measured_cases: selected - notApplicable.length,
    not_applicable: notApplicable,
  };
}

export function recordTiming(directory, env = process.env) {
  if (typeof directory !== "string" || !isAbsolute(directory))
    throw new Error("Timing directory must be absolute");
  const metadata = {
    schema: 2,
    status: "rejected",
    reason: null,
    repository: env.GITHUB_REPOSITORY ?? null,
    source_sha: env.GITHUB_SHA ?? null,
    head_sha: env.TRANSIT_LAYOUT_HEAD_SHA ?? null,
    run_id: env.GITHUB_RUN_ID ?? null,
    attempt: env.GITHUB_RUN_ATTEMPT ?? null,
    expected: {
      playwright: null,
      workers: 2,
      shard: {
        current: Number(env.TRANSIT_LAYOUT_SHARD),
        total: Number(env.TRANSIT_LAYOUT_SHARDS),
      },
    },
    observed: null,
    report_sha256: null,
    stats: null,
  };
  let pinError;
  try {
    metadata.expected.playwright = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ).devDependencies["@playwright/test"];
  } catch (error) {
    pinError = error;
  }
  let failure;
  try {
    const bytes = readFileSync(join(directory, "report.json"));
    metadata.report_sha256 = createHash("sha256").update(bytes).digest("hex");
    const report = JSON.parse(bytes);
    metadata.observed = {
      playwright: report.config?.version ?? null,
      workers: report.config?.workers ?? null,
      shard: report.config?.shard ?? null,
    };
    metadata.stats = report.stats ?? null;
    if (pinError) throw pinError;
    validateIdentity(metadata);
    const planned = env.TRANSIT_LAYOUT_PLAN
      ? plannedCoverage(report, env)
      : undefined;
    Object.assign(metadata, validateReport(report, metadata.expected, planned));
    if (planned) metadata.coverage = planned.coverage;
    metadata.status = metadata.not_applicable.length
      ? "measured_with_not_applicable"
      : "measured";
  } catch (error) {
    metadata.status =
      error.code === "ENOENT" && metadata.report_sha256 === null
        ? "missing"
        : "rejected";
    metadata.reason = error.message;
    failure = error;
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  if (failure) throw failure;
  return metadata;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv[2] !== "record")
    throw new Error("Expected record DIRECTORY");
  const result = recordTiming(process.argv[3]);
  process.stdout.write(
    `Recorded timing observations for shard ${result.shard.current}/${result.shard.total}: ${result.measured_cases} measured cases, ${result.not_applicable.length} declared not-applicable cases, source ${result.source_sha}.\n`,
  );
}
