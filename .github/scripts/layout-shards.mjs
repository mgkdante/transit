import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const selectionHash = (keys) =>
  createHash("sha256")
    .update(JSON.stringify([...keys].sort(compare)))
    .digest("hex");
const assignmentHash = (shards) =>
  selectionHash(
    shards.map((s) =>
      JSON.stringify({ id: s.id, keys: [...s.case_keys].sort(compare) }),
    ),
  );

export function caseRows(report) {
  const rows = [];
  function visit(suite, titles = [], root = true) {
    const parents = root ? titles : [...titles, suite.title];
    for (const spec of suite.specs ?? [])
      for (const item of spec.tests ?? []) {
        const project = item.projectName,
          file = spec.file;
        if (
          typeof project !== "string" ||
          !/^layout-[A-Za-z0-9_-]+$/.test(project) ||
          typeof file !== "string" ||
          file !== file.trim() ||
          posix.normalize(file) !== file ||
          file.startsWith("/") ||
          file.split("/").includes("..") ||
          /[\\:\r\n>›\x00-\x1f]/.test(file) ||
          !file.endsWith(".spec.ts") ||
          typeof spec.title !== "string" ||
          !spec.title
        )
          throw new Error("Invalid layout case identity");
        rows.push({
          project,
          file,
          key: JSON.stringify([project, file, ...parents, spec.title]),
        });
      }
    for (const child of suite.suites ?? []) visit(child, parents, false);
  }
  for (const suite of report.suites ?? []) visit(suite);
  if (!rows.length || new Set(rows.map((r) => r.key)).size !== rows.length)
    throw new Error("Missing or duplicate layout cases");
  return rows;
}

function durationProfile(baseline) {
  const profile = new Map();
  for (const [project, file, cases, ms] of baseline.groups ?? []) {
    const key = JSON.stringify([project, file]);
    if (
      profile.has(key) ||
      !Number.isInteger(cases) ||
      cases < 1 ||
      !Number.isFinite(ms) ||
      ms <= 0
    )
      throw new Error("Invalid layout duration baseline");
    profile.set(key, { cases, ms });
  }
  if (!profile.size) throw new Error("Missing measured duration baseline");
  return profile;
}

function planningTasks(rows, baseline) {
  const profile = durationProfile(baseline),
    groups = new Map();
  const fallback = Math.max(
    ...[...profile.values()].map((p) => p.ms / p.cases),
  );
  for (const row of rows) {
    const key = JSON.stringify([row.project, row.file]);
    if (!groups.has(key))
      groups.set(key, { project: row.project, file: row.file, keys: [] });
    groups.get(key).keys.push(row.key);
  }
  return [...groups]
    .map(([key, group]) => {
      const measured = profile.get(key);
      const estimated_ms =
        group.keys.length *
        (measured ? measured.ms / measured.cases : fallback);
      if (!Number.isFinite(estimated_ms))
        throw new Error("Layout duration estimate overflow");
      return { ...group, estimated_ms, unmeasured: !measured };
    })
    .sort(
      (a, b) =>
        b.estimated_ms - a.estimated_ms ||
        compare(a.project, b.project) ||
        compare(a.file, b.file),
    );
}

function distribute(tasks, count) {
  if (tasks.length < count) throw new Error("Fewer layout groups than shards");
  const shards = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    estimated_ms: 0,
    groups: [],
    case_keys: [],
  }));
  for (const task of tasks) {
    const bin = shards.reduce((a, b) =>
      a.estimated_ms <= b.estimated_ms ? a : b,
    );
    bin.estimated_ms += task.estimated_ms;
    bin.groups.push({
      project: task.project,
      file: task.file,
      cases: task.keys.length,
      unmeasured: task.unmeasured,
    });
    bin.case_keys.push(...task.keys);
  }
  return shards;
}

export function makePlan(catalog, baseline, sourceSha, count = 12) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha ?? "") ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    catalog.errors?.length ||
    catalog.config?.shard ||
    catalog.config?.workers !== 2 ||
    catalog.config?.version !== baseline.playwright ||
    baseline.workers !== 2
  )
    throw new Error("Invalid layout planning context");
  const rows = caseRows(catalog);
  const projects = (catalog.config.projects ?? [])
    .filter((p) => typeof p.name === "string" && p.name.startsWith("layout-"))
    .map((p) => p.name);
  const selected = new Set(rows.map((r) => r.project));
  if (
    !projects.length ||
    new Set(projects).size !== projects.length ||
    projects.length !== selected.size ||
    projects.some((p) => !selected.has(p))
  )
    throw new Error("Incomplete layout project catalog");
  const shards = distribute(planningTasks(rows, baseline), count);
  return {
    schema: 1,
    source_sha: sourceSha,
    playwright: catalog.config.version,
    workers: 2,
    total: count,
    catalog_sha256: selectionHash(rows.map((r) => r.key)),
    assignment_sha256: assignmentHash(shards),
    selected_cases: rows.length,
    baseline_run: baseline.run_id,
    shards,
  };
}

export function writePlan(plan, directory) {
  if (!isAbsolute(directory))
    throw new Error("Layout plan directory must be absolute");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plan.json"), JSON.stringify(plan) + "\n");
  for (const shard of plan.shards) {
    const selectors = shard.groups
      .map((g) => "[" + g.project + "] › " + g.file)
      .sort(compare);
    writeFileSync(
      join(directory, "shard-" + shard.id + ".txt"),
      selectors.join("\n") + "\n",
    );
  }
}

export function plannedCoverage(report, env) {
  if (report.config?.shard)
    throw new Error("Native and planned layout sharding cannot be combined");
  const plan = JSON.parse(readFileSync(env.TRANSIT_LAYOUT_PLAN, "utf8"));
  const current = Number(env.TRANSIT_LAYOUT_SHARD),
    total = Number(env.TRANSIT_LAYOUT_SHARDS);
  const shard = plan.shards?.find((s) => s.id === current);
  if (
    plan.schema !== 1 ||
    plan.source_sha !== env.GITHUB_SHA ||
    plan.workers !== 2 ||
    plan.total !== total ||
    plan.playwright !== report.config?.version ||
    !shard
  )
    throw new Error("Layout plan identity mismatch");
  const all = plan.shards.flatMap((s) => s.case_keys);
  if (
    plan.shards.length !== total ||
    new Set(plan.shards.map((s) => s.id)).size !== total ||
    all.length !== plan.selected_cases ||
    new Set(all).size !== all.length ||
    selectionHash(all) !== plan.catalog_sha256 ||
    assignmentHash(plan.shards) !== plan.assignment_sha256
  )
    throw new Error("Layout plan coverage seal mismatch");
  const actual = caseRows(report).map((r) => r.key);
  if (selectionHash(actual) !== selectionHash(shard.case_keys))
    throw new Error("Layout shard selection differs from plan");
  return {
    shard: { current, total },
    coverage: {
      catalog_sha256: plan.catalog_sha256,
      assignment_sha256: plan.assignment_sha256,
      selection_sha256: selectionHash(actual),
      selected_cases: actual.length,
      catalog_cases: plan.selected_cases,
    },
  };
}

function readCoverageReceipt(folder, env, total) {
  const metadata = JSON.parse(
    readFileSync(join(folder, "metadata.json"), "utf8"),
  );
  if (
    !["measured", "measured_with_not_applicable"].includes(metadata.status) ||
    metadata.schema !== 2 ||
    metadata.repository !== env.GITHUB_REPOSITORY ||
    metadata.source_sha !== env.GITHUB_SHA ||
    metadata.run_id !== env.GITHUB_RUN_ID ||
    metadata.attempt !== env.GITHUB_RUN_ATTEMPT ||
    metadata.head_sha !== env.TRANSIT_LAYOUT_HEAD_SHA ||
    metadata.workers !== 2 ||
    metadata.shard?.total !== total ||
    !Number.isInteger(metadata.shard.current) ||
    metadata.shard.current < 1 ||
    metadata.shard.current > total ||
    !metadata.coverage
  )
    throw new Error("Invalid layout coverage receipt");
  const bytes = readFileSync(join(folder, "report.json"));
  if (
    createHash("sha256").update(bytes).digest("hex") !== metadata.report_sha256
  )
    throw new Error("Layout coverage report seal mismatch");
  const report = JSON.parse(bytes),
    keys = caseRows(report).map((r) => r.key);
  if (
    report.config?.version !== metadata.playwright ||
    report.config?.workers !== 2 ||
    metadata.selected_cases !== keys.length
  )
    throw new Error("Layout coverage configuration mismatch");
  const verified = plannedCoverage(report, {
    ...env,
    TRANSIT_LAYOUT_SHARD: String(metadata.shard.current),
    TRANSIT_LAYOUT_SHARDS: String(total),
    TRANSIT_LAYOUT_PLAN: join(folder, "plan.json"),
  });
  if (
    JSON.stringify(verified.coverage) !== JSON.stringify(metadata.coverage) ||
    selectionHash(keys) !== metadata.coverage.selection_sha256
  )
    throw new Error("Layout plan receipt mismatch");
  return { metadata, keys };
}

export function verifyCoverage(directory, env, total = 12) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? "") ||
    ![env.GITHUB_SHA, env.TRANSIT_LAYOUT_HEAD_SHA].every((sha) =>
      /^[a-f0-9]{40}$/.test(sha ?? ""),
    ) ||
    ![env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT].every((id) =>
      /^[1-9][0-9]*$/.test(id ?? ""),
    )
  )
    throw new Error("Invalid layout coverage context");
  const seen = new Set(),
    keys = new Set(),
    catalogs = new Set(),
    assignments = new Set();
  let expectedCases;
  for (const name of readdirSync(directory)) {
    const receipt = readCoverageReceipt(join(directory, name), env, total),
      metadata = receipt.metadata;
    if (seen.has(metadata.shard.current))
      throw new Error("Duplicate layout coverage receipt");
    seen.add(metadata.shard.current);
    for (const key of receipt.keys) {
      if (keys.has(key)) throw new Error("Duplicate layout case across shards");
      keys.add(key);
    }
    catalogs.add(metadata.coverage.catalog_sha256);
    assignments.add(metadata.coverage.assignment_sha256);
    if (
      expectedCases !== undefined &&
      expectedCases !== metadata.coverage.catalog_cases
    )
      throw new Error("Inconsistent layout catalogs");
    expectedCases = metadata.coverage.catalog_cases;
  }
  if (
    seen.size !== total ||
    catalogs.size !== 1 ||
    assignments.size !== 1 ||
    keys.size !== expectedCases ||
    !catalogs.has(selectionHash([...keys]))
  )
    throw new Error("Incomplete layout grid coverage");
  return { shards: seen.size, cases: keys.size };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv[2] === "plan") {
    const catalog = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const baseline = JSON.parse(
      readFileSync(
        new URL("./layout-duration-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    const plan = makePlan(
      catalog,
      baseline,
      process.env.GITHUB_SHA,
      Number(process.argv[5] ?? 12),
    );
    writePlan(plan, process.argv[4]);
    process.stdout.write(
      "Layout plan: " +
        plan.selected_cases +
        " cases across " +
        plan.total +
        " shards, two workers each.\n",
    );
    if (plan.shards.some((s) => s.groups.some((g) => g.unmeasured)))
      process.stdout.write(
        "::warning::New layout groups use conservative duration estimates; all cases remain selected.\n",
      );
  } else if (process.argv[2] === "verify") {
    const result = verifyCoverage(
      process.argv[3],
      process.env,
      Number(process.argv[4] ?? 12),
    );
    process.stdout.write(
      "Verified complete layout coverage: " +
        result.cases +
        " cases across " +
        result.shards +
        " shards.\n",
    );
  } else
    throw new Error(
      "Expected plan CATALOG DIRECTORY [SHARDS] or verify DIRECTORY [SHARDS]",
    );
}
