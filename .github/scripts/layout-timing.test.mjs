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
  assert.match(layout, /shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12\]/);
  assert.match(layout, /--test-list=/);
  assert.doesNotMatch(layout, /test:e2e:layout --shard=/);
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

test("declared not-applicable cases retain observed overhead without claiming asserted execution", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-applicability-"));
  try {
    const item = {
      expectedStatus: "skipped",
      projectName: "layout-chromium-1440-light",
      annotations: [
        {
          type: "skip",
          description: "desktop shows a panel, not the mobile sheet",
        },
      ],
      results: [{ status: "skipped", duration: 203 }],
    };
    const value = {
      ...report,
      stats: { ...report.stats, skipped: 1 },
      suites: [
        {
          specs: [
            report.suites[0].specs[0],
            {
              id: "mobile-sheet-desktop",
              file: "layout-map.spec.ts",
              title: "mobile sheet",
              tests: [item],
            },
          ],
        },
      ],
    };
    writeFileSync(join(root, "report.json"), JSON.stringify(value));
    const metadata = recordTiming(root, env);
    assert.equal(metadata.status, "measured_with_not_applicable");
    assert.equal(metadata.selected_cases, 2);
    assert.equal(metadata.measured_cases, 1);
    assert.equal(metadata.not_applicable[0].overhead_ms, 203);
    assert.equal(
      metadata.not_applicable[0].reason,
      item.annotations[0].description,
    );
    item.results = [];
    writeFileSync(join(root, "report.json"), JSON.stringify(value));
    assert.throws(() => recordTiming(root, env), /Incomplete/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mixed executed and skipped or interrupted cases cannot be complete duration evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-mixed-"));
  try {
    for (const missing of [
      { status: "skipped", results: [] },
      { status: "skipped", results: [{ duration: 0, status: "skipped" }] },
      {
        status: "unexpected",
        results: [{ duration: 50, status: "interrupted" }],
      },
    ]) {
      const interrupted = missing.results.some(
        (result) => result.status === "interrupted",
      );
      const value = {
        ...report,
        stats: {
          ...report.stats,
          skipped: interrupted ? 0 : 1,
          unexpected: interrupted ? 1 : 0,
        },
        suites: [
          { specs: [{ tests: [report.suites[0].specs[0].tests[0], missing] }] },
        ],
      };
      writeFileSync(join(root, "report.json"), JSON.stringify(value));
      assert.throws(() => recordTiming(root, env), /Incomplete/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejected and missing reports retain diagnostic provenance while still failing", () => {
  const root = mkdtempSync(join(tmpdir(), "transit-layout-diagnostic-"));
  try {
    assert.throws(() => recordTiming(root, env));
    let metadata = JSON.parse(
      readFileSync(join(root, "metadata.json"), "utf8"),
    );
    assert.equal(metadata.status, "missing");
    assert.equal(metadata.source_sha, env.GITHUB_SHA);
    assert.equal(metadata.head_sha, env.TRANSIT_LAYOUT_HEAD_SHA);
    assert.equal(metadata.report_sha256, null);
    assert.equal(metadata.expected.workers, 2);
    const text = JSON.stringify({
      ...report,
      config: { ...report.config, workers: 4 },
    });
    writeFileSync(join(root, "report.json"), text);
    assert.throws(() => recordTiming(root, env), /identity mismatch/);
    metadata = JSON.parse(readFileSync(join(root, "metadata.json"), "utf8"));
    assert.equal(metadata.status, "rejected");
    assert.equal(metadata.observed.workers, 4);
    assert.equal(metadata.expected.workers, 2);
    assert.equal(
      metadata.report_sha256,
      createHash("sha256").update(text).digest("hex"),
    );
    assert.ok(metadata.reason);
    assert.equal(readFileSync(join(root, "report.json"), "utf8"), text);
    writeFileSync(join(root, "report.json"), "invalid JSON");
    assert.throws(() => recordTiming(root, env));
    metadata = JSON.parse(readFileSync(join(root, "metadata.json"), "utf8"));
    assert.equal(metadata.status, "rejected");
    assert.equal(
      metadata.report_sha256,
      createHash("sha256").update("invalid JSON").digest("hex"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
