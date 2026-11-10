import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function caseCount(suites) {
  if (!Array.isArray(suites)) throw new Error("Invalid timing suites");
  return suites.reduce(
    (total, suite) =>
      total +
      (suite.specs ?? []).reduce((count, spec) => {
        for (const item of spec.tests) {
          if (
            !Array.isArray(item.results) ||
            (item.results.length === 0 && item.status !== "skipped") ||
            item.results.some(
              (result) =>
                !Number.isFinite(result.duration) || result.duration < 0,
            )
          ) {
            throw new Error("Incomplete case durations");
          }
        }
        return count + spec.tests.length;
      }, 0) +
      caseCount(suite.suites ?? []),
    0,
  );
}

export function recordTiming(directory, env = process.env) {
  if (!isAbsolute(directory))
    throw new Error("Timing directory must be absolute");
  const identity = {
    repository: env.GITHUB_REPOSITORY,
    source_sha: env.GITHUB_SHA,
    head_sha: env.TRANSIT_LAYOUT_HEAD_SHA,
    run_id: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
  };
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
  const bytes = readFileSync(join(directory, "report.json"));
  const report = JSON.parse(bytes);
  const pin = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ).devDependencies["@playwright/test"];
  const shard = report.config?.shard;
  if (
    report.config?.version !== pin ||
    report.config?.workers !== 2 ||
    shard?.current !== Number(env.TRANSIT_LAYOUT_SHARD) ||
    shard?.total !== Number(env.TRANSIT_LAYOUT_SHARDS) ||
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
  if (
    !counts.every((value) => Number.isInteger(value) && value >= 0) ||
    !Number.isFinite(stats?.duration) ||
    stats.duration < 0 ||
    stats.expected + stats.unexpected + stats.flaky === 0 ||
    caseCount(report.suites) !== counts.reduce((a, b) => a + b, 0)
  ) {
    throw new Error("Incomplete or unexecuted layout timing report");
  }
  const metadata = {
    schema: 1,
    ...identity,
    playwright: pin,
    workers: report.config.workers,
    shard,
    stats,
    report_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  writeFileSync(
    join(directory, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
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
    `Recorded full timing report for shard ${result.shard.current}/${result.shard.total}, source ${result.source_sha}.\n`,
  );
}
