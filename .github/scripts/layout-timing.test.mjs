import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordTiming } from "./layout-timing.mjs";

const version = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).devDependencies["@playwright/test"];
const env = {
  GITHUB_REPOSITORY: "yesid-dev/transit",
  GITHUB_SHA: "a".repeat(40),
  TRANSIT_LAYOUT_HEAD_SHA: "b".repeat(40),
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
  TRANSIT_LAYOUT_SHARD: "1",
  TRANSIT_LAYOUT_SHARDS: "4",
};
const report = {
  config: { version, workers: 2, shard: { current: 1, total: 4 } },
  stats: { duration: 1234, expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  suites: [
    {
      specs: [{ tests: [{ results: [{ duration: 1000, status: "passed" }] }] }],
    },
  ],
};

test("timing evidence binds report bytes to exact source, head, run, attempt, shard and Playwright pin", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-timing-"));
  try {
    const text = JSON.stringify(report);
    writeFileSync(join(root, "report.json"), text);
    const result = recordTiming(root, env);
    assert.equal(result.source_sha, env.GITHUB_SHA);
    assert.equal(result.head_sha, env.TRANSIT_LAYOUT_HEAD_SHA);
    assert.equal(result.run_id, "123");
    assert.equal(result.attempt, "1");
    assert.deepEqual(result.shard, { current: 1, total: 4 });
    assert.equal(result.playwright, version);
    assert.equal(
      result.report_sha256,
      createHash("sha256").update(text).digest("hex"),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "metadata.json"), "utf8")),
      result,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing, wrong-shard, list-only and incomplete reports cannot become measured evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-timing-reject-"));
  try {
    assert.throws(() => recordTiming(root, env));
    for (const value of [
      {
        ...report,
        config: { version, workers: 2, shard: { current: 2, total: 4 } },
      },
      {
        ...report,
        config: { version, workers: 4, shard: { current: 1, total: 4 } },
      },
      {
        ...report,
        config: { version: "wrong", shard: { current: 1, total: 4 } },
      },
      { ...report, stats: { ...report.stats, expected: 0, skipped: 1 } },
      { ...report, suites: [] },
      { ...report, suites: [{ specs: [{ tests: [{ results: [] }] }] }] },
      { ...report, stats: { ...report.stats, duration: -1 } },
    ]) {
      writeFileSync(join(root, "report.json"), JSON.stringify(value));
      assert.throws(
        () => recordTiming(root, env),
        /identity mismatch|Incomplete/,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the full grid keeps its workers and emits timing artifacts even after a test failure", () => {
  const workflow = readFileSync(
    new URL("../workflows/web.yml", import.meta.url),
    "utf8",
  );
  const layout = workflow.split("\n  layout:\n")[1].split("\n  ci:\n")[0];
  const config = readFileSync(
    new URL("../../apps/web/e2e/playwright.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    config,
    /const jsonReporter: \['json'\]\[\] = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME/,
  );
  assert.match(config, /open: 'never', outputFolder: '..\/playwright-report'/);
  assert.match(config, /\.\.\.jsonReporter/);
  assert.match(layout, /PLAYWRIGHT_JSON_OUTPUT_NAME:/);
  assert.match(layout, /shard: \[1, 2, 3, 4\]/);
  const pkg = JSON.parse(
    readFileSync(
      new URL("../../apps/web/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.match(pkg.scripts["test:e2e:layout"], /--workers=2/);
  assert.match(
    layout,
    /name: Upload complete layout timings\n\s+if: \$\{\{ always\(\) \}\}/,
  );
  assert.match(layout, /if-no-files-found: error/);
});
