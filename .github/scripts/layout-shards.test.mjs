import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  caseRows,
  makePlan,
  plannedCoverage,
  selectionHash,
  verifyCoverage,
  writePlan,
} from "./layout-shards.mjs";
import { recordTiming } from "./layout-timing.mjs";

const version = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).devDependencies["@playwright/test"];
const sha = "a".repeat(40);
function catalog(costs) {
  return {
    config: {
      version,
      workers: 2,
      projects: [{ name: "layout-chromium-360-light" }],
    },
    suites: costs.map((_, i) => ({
      title: "layout-" + i + ".spec.ts",
      specs: [
        {
          file: "layout-" + i + ".spec.ts",
          title: "case " + i,
          tests: [{ projectName: "layout-chromium-360-light", results: [] }],
        },
      ],
    })),
  };
}
const baseline = (costs) => ({
  playwright: version,
  workers: 2,
  run_id: "123",
  groups: costs.map((ms, i) => [
    "layout-chromium-360-light",
    "layout-" + i + ".spec.ts",
    1,
    ms,
  ]),
});

test("longest measured groups are assigned first with deterministic complete coverage", () => {
  const costs = [800, 700, 500, 350, 200, 150];
  const input = catalog(costs),
    profile = baseline(costs);
  const plan = makePlan(input, profile, sha, 2);
  assert.deepEqual(plan, makePlan(input, profile, sha, 2));
  const keys = plan.shards.flatMap((s) => s.case_keys);
  assert.equal(keys.length, 6);
  assert.equal(new Set(keys).size, 6);
  assert.equal(
    selectionHash(keys),
    selectionHash(caseRows(input).map((r) => r.key)),
  );
  assert.deepEqual(
    plan.shards.map((s) => s.estimated_ms),
    [1350, 1350],
  );
  assert.equal(plan.workers, 2);
  assert.equal(plan.selected_cases, 6);
});

test("new groups stay selected with positive conservative estimates; invalid weights fail closed", () => {
  const input = catalog([100, 50, 25]);
  const profile = baseline([100, 50]);
  const plan = makePlan(input, profile, sha, 2);
  assert.equal(plan.selected_cases, 3);
  assert.equal(
    plan.shards.flatMap((s) => s.groups).filter((g) => g.unmeasured).length,
    1,
  );
  assert.ok(plan.shards.every((s) => s.estimated_ms > 0));
  assert.throws(
    () => makePlan(input, baseline([100, 0, 25]), sha, 2),
    /baseline/,
  );
  assert.throws(() => makePlan(input, profile, sha, 4), /Fewer/);
  assert.throws(
    () =>
      makePlan(
        {
          ...input,
          config: { ...input.config, shard: { current: 1, total: 4 } },
        },
        profile,
        sha,
        2,
      ),
    /planning context/,
  );
  assert.throws(
    () =>
      makePlan(
        {
          ...input,
          config: {
            ...input.config,
            projects: [
              ...input.config.projects,
              { name: "layout-webkit-1440-light" },
            ],
          },
        },
        profile,
        sha,
        2,
      ),
    /project catalog/,
  );
});

test("native double-sharding and a wrong plan cannot silently shrink a selection", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-plan-"));
  try {
    const input = catalog([100, 50]);
    const plan = makePlan(input, baseline([100, 50]), sha, 2);
    writePlan(plan, root);
    const env = {
      GITHUB_SHA: sha,
      TRANSIT_LAYOUT_PLAN: join(root, "plan.json"),
      TRANSIT_LAYOUT_SHARD: "1",
      TRANSIT_LAYOUT_SHARDS: "2",
    };
    const actual = { ...input, suites: [input.suites[0]] };
    assert.equal(plannedCoverage(actual, env).coverage.selected_cases, 1);
    assert.throws(
      () =>
        plannedCoverage(
          {
            ...actual,
            config: { ...actual.config, shard: { current: 1, total: 2 } },
          },
          env,
        ),
      /cannot be combined/,
    );
    assert.throws(
      () => plannedCoverage(actual, { ...env, GITHUB_SHA: "b".repeat(40) }),
      /identity mismatch/,
    );
    assert.throws(
      () => plannedCoverage({ ...input, suites: [input.suites[1]] }, env),
      /differs/,
    );
    assert.equal(
      readFileSync(join(root, "shard-1.txt"), "utf8"),
      "[layout-chromium-360-light] › layout-0.spec.ts\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("global audit proves every selected case occurs once across all shard reports", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-coverage-"));
  try {
    const input = catalog([100, 50]);
    const plan = makePlan(input, baseline([100, 50]), sha, 2);
    const planDir = join(root, "plan"),
      reports = join(root, "reports");
    writePlan(plan, planDir);
    mkdirSync(reports);
    const env = {
      GITHUB_REPOSITORY: "yesid-dev/transit",
      GITHUB_SHA: sha,
      TRANSIT_LAYOUT_HEAD_SHA: "b".repeat(40),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      TRANSIT_LAYOUT_PLAN: join(planDir, "plan.json"),
      TRANSIT_LAYOUT_SHARDS: "2",
    };
    for (let i = 0; i < 2; i++) {
      const folder = join(reports, "shard-" + (i + 1));
      mkdirSync(folder);
      writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
      const suite = structuredClone(input.suites[i]);
      suite.specs[0].tests[0].results = [{ status: "passed", duration: 10 }];
      const report = {
        config: { version, workers: 2, shard: null },
        suites: [suite],
        stats: {
          duration: 10,
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
        },
      };
      writeFileSync(join(folder, "report.json"), JSON.stringify(report));
      recordTiming(folder, { ...env, TRANSIT_LAYOUT_SHARD: String(i + 1) });
    }
    assert.deepEqual(verifyCoverage(reports, env, 2), { shards: 2, cases: 2 });
    const partial = join(root, "partial");
    mkdirSync(partial);
    cpSync(join(reports, "shard-1"), join(partial, "shard-1"), {
      recursive: true,
    });
    assert.throws(() => verifyCoverage(partial, env, 2), /Incomplete/);
    cpSync(join(reports, "shard-1"), join(partial, "duplicate"), {
      recursive: true,
    });
    assert.throws(() => verifyCoverage(partial, env, 2), /Duplicate/);
    const file = join(reports, "shard-2", "metadata.json");
    const original = readFileSync(file, "utf8");
    writeFileSync(
      file,
      original.replace('"status": "measured"', '"status": "rejected"'),
    );
    assert.throws(() => verifyCoverage(reports, env, 2), /receipt/);
    writeFileSync(file, original);
    writeFileSync(join(reports, "shard-2", "report.json"), "{}");
    assert.throws(() => verifyCoverage(reports, env, 2), /seal/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
