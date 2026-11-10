import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  new URL("../workflows/deploy-now.yml", import.meta.url),
  "utf8",
);
const nodePin = readFileSync(
  new URL("../../.nvmrc", import.meta.url),
  "utf8",
).trim();
const bunPin = readFileSync(
  new URL("../../.bun-version", import.meta.url),
  "utf8",
).trim();
const wranglerPin = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).devDependencies.wrangler;
const web = readFileSync(
  new URL("../workflows/web.yml", import.meta.url),
  "utf8",
);

test("manual production deployment checks out the selected ref without CI dependencies", () => {
  const triggers = workflow.split("\non:\n")[1].split("\npermissions:")[0];
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(
    triggers,
    /(?:push|pull_request|workflow_run|merge_group):/,
  );
  assert.match(triggers, /ref:[\s\S]*required: true/);
  assert.match(triggers, /options: \[web, data-proxy, both\]/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: \$\{\{ inputs.ref \}\}/);
  assert.match(workflow, /git rev-parse --verify 'HEAD\^\{commit\}'/);
  assert.doesNotMatch(workflow, /needs:|run:.*(?:test|smoke)|workflow_run/);
  for (const setting of [
    "TRANSIT_BUILD_TARGET: production",
    "PUBLIC_SITE_ORIGIN: https://transit.yesid.dev",
    "PUBLIC_V1_BASE: https://data.yesid.dev/v1",
    'PUBLIC_INDEXING: "true"',
  ]) {
    assert.ok(workflow.includes(setting), setting);
    assert.ok(web.includes(setting), setting);
  }
  for (const source of [workflow, web.split("\n  deploy-production:")[1]]) {
    assert.match(source, /environment: production/);
    assert.match(
      source,
      /group: transit-data-edge-production\n\s+cancel-in-progress: false/,
    );
  }
  for (const target of ["web", "data-proxy"]) {
    assert.match(
      workflow,
      new RegExp(
        `if: inputs.target == '${target}' \\|\\| inputs.target == 'both'`,
      ),
    );
  }
});

function runStep(name, cwd, env = {}) {
  const block = workflow
    .split(`      - name: ${name}\n`)[1]
    ?.split("\n      - name:")[0];
  assert.ok(block, `Missing ${name}`);
  const body = block
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  const script = join(cwd, "step.ps1");
  writeFileSync(script, body);
  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("deployment request rejects empty, option-like and invalid refs and targets before checkout", () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-deploy-input-"));
  try {
    for (const ref of [
      "",
      " ",
      "--help",
      "main..other",
      "main~1",
      "bad ref",
      "bad\nref",
    ]) {
      const result = runStep("Validate deployment request", directory, {
        REQUESTED_REF: ref,
        DEPLOY_TARGET: "web",
      });
      assert.notEqual(result.status, 0, ref);
    }
    const badTarget = runStep("Validate deployment request", directory, {
      REQUESTED_REF: "main",
      DEPLOY_TARGET: "invalid",
    });
    assert.notEqual(badTarget.status, 0);
    for (const ref of [
      "main",
      "refs/heads/feature/admin-release",
      "a".repeat(40),
    ]) {
      const result = runStep("Validate deployment request", directory, {
        REQUESTED_REF: ref,
        DEPLOY_TARGET: "both",
      });
      assert.equal(result.status, 0, result.stderr);
    }
    assert.ok(
      workflow.indexOf("Validate deployment request") <
        workflow.indexOf("Check out main dispatch revision"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolved deployment identity is the selected historical checkout and fails closed without a commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-deploy-ref-"));
  const output = join(directory, "env");
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Deploy test",
        "-c",
        "user.email=deploy@example.invalid",
        ...args,
      ],
      { cwd: directory, encoding: "utf8", stdio: "pipe" },
    ).trim();
  try {
    const invalid = runStep("Resolve deployed commit", directory, {
      GITHUB_ENV: output,
    });
    assert.notEqual(invalid.status, 0);
    git("init", "--quiet", "--initial-branch=main");
    git("commit", "--quiet", "--allow-empty", "-m", "Historical source");
    const selected = git("rev-parse", "HEAD");
    git("commit", "--quiet", "--allow-empty", "-m", "Newer main");
    assert.notEqual(git("rev-parse", "HEAD"), selected);
    git("checkout", "--quiet", "--detach", selected);
    const resolved = runStep("Resolve deployed commit", directory, {
      GITHUB_ENV: output,
    });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(
      readFileSync(output, "utf8").trim(),
      `TRANSIT_COMMIT_SHA=${selected}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deployment summaries use actual Wrangler versions and reject missing deployment receipts", () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-deploy-summary-"));
  try {
    const scripts = [
      ...workflow.matchAll(
        /node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/g,
      ),
    ];
    assert.equal(scripts.length, 2);
    for (const [, body] of scripts) {
      const receipt = join(directory, "receipt.ndjson");
      const summary = join(directory, "summary.md");
      const env = {
        ...process.env,
        WRANGLER_OUTPUT_FILE_PATH: receipt,
        GITHUB_STEP_SUMMARY: summary,
        TRANSIT_COMMIT_SHA: "a".repeat(40),
        DEPLOY_TARGET: "web",
      };
      writeFileSync(
        receipt,
        JSON.stringify({ type: "wrangler-session" }) +
          "\n" +
          JSON.stringify({ type: "deploy", version_id: "worker-version-123" }) +
          "\n",
      );
      execFileSync(process.execPath, ["--input-type=module", "-e", body], {
        env,
      });
      const result = readFileSync(summary, "utf8");
      assert.ok(result.includes("a".repeat(40)));
      assert.match(result, /Target: web/);
      assert.match(result, /Worker version: worker-version-123/);
      writeFileSync(receipt, JSON.stringify({ type: "wrangler-session" }));
      assert.throws(() =>
        execFileSync(process.execPath, ["--input-type=module", "-e", body], {
          env,
          stdio: "pipe",
        }),
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("older application refs use deployment control files preserved from the main dispatch revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "transit-deploy-control-"));
  const assets = [
    ".nvmrc",
    ".bun-version",
    "apps/data-proxy/r2-cors.json",
    "apps/data-proxy/scripts/configure-data-edge.mjs",
  ];
  function step(name) {
    const block = workflow
      .split(`      - name: ${name}\n`)[1]
      ?.split("\n      - name:")[0];
    assert.ok(block, `Missing ${name}`);
    return block
      .split("        run: |\n")[1]
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n");
  }
  try {
    const root = join(directory, "checkout");
    const temporary = join(directory, "runner");
    mkdirSync(root);
    mkdirSync(temporary);
    for (const asset of assets) {
      mkdirSync(join(root, asset, ".."), { recursive: true });
      writeFileSync(join(root, asset), `main control: ${asset}`);
    }
    const run = (name) => {
      const script = join(directory, "step.ps1");
      writeFileSync(script, step(name));
      execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", script], {
        cwd: root,
        env: { ...process.env, RUNNER_TEMP: temporary },
        stdio: "pipe",
      });
    };
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ devDependencies: { wrangler: wranglerPin } }),
    );
    writeFileSync(join(root, ".nvmrc"), nodePin + "\n");
    writeFileSync(join(root, ".bun-version"), bunPin + "\n");
    run("Preserve main deployment controls");
    // Model checkout of a historical ref that has none of these controls.
    for (const asset of assets) rmSync(join(root, asset));
    // Actual old metadata: no Node file and Wrangler lives in data-proxy.
    const historical = JSON.stringify({
      name: "transit",
      private: true,
      workspaces: ["apps/*", "packages/*"],
      devDependencies: { turbo: "^2.5.0" },
    });
    writeFileSync(join(root, "package.json"), historical);
    assert.equal(JSON.parse(historical).devDependencies?.wrangler, undefined);
    const control = join(temporary, "transit-deploy-control");
    assert.equal(readFileSync(join(control, ".nvmrc"), "utf8").trim(), nodePin);
    assert.equal(
      readFileSync(join(control, ".bun-version"), "utf8").trim(),
      bunPin,
    );
    assert.equal(
      JSON.parse(readFileSync(join(control, "package.json"), "utf8"))
        .dependencies.wrangler,
      wranglerPin,
    );
    assert.match(workflow, /node-version-file: \.nvmrc/);
    assert.ok(
      workflow.indexOf("Set up deployment Node") <
        workflow.indexOf("Check out deployment ref"),
    );
    assert.match(workflow, /bun-version-file: \.bun-version/);
    assert.ok(
      workflow.indexOf("Set up deployment Bun") <
        workflow.indexOf("Check out deployment ref"),
    );
    assert.match(workflow, /run: bun install --frozen-lockfile/);
    assert.doesNotMatch(workflow, /uses: \.\/\.github\/actions\/setup/);
    for (const asset of assets.slice(2)) {
      assert.equal(
        readFileSync(join(temporary, "transit-deploy-control", asset), "utf8"),
        `main control: ${asset}`,
      );
    }
    assert.match(
      workflow,
      /--file "\$RUNNER_TEMP\/transit-deploy-control\/apps\/data-proxy\/r2-cors.json"/,
    );
    assert.match(
      workflow,
      /node "\$RUNNER_TEMP\/transit-deploy-control\/apps\/data-proxy\/scripts\/configure-data-edge.mjs"/,
    );
    assert.ok(
      workflow.indexOf("Preserve main deployment controls") <
        workflow.indexOf("Check out deployment ref"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
