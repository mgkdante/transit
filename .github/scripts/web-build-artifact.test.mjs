import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BUILD_INPUTS,
  BUILD_TREES,
  configure,
  main,
  prepare,
  restore,
  verifySource,
} from "./web-build-artifact.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "transit-web-artifact-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  const stage = join(directory, "artifact");
  const write = (path, data = path) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  for (const path of BUILD_INPUTS) write(path, "{}");
  write(".nvmrc", process.versions.node);
  write(".bun-version", "1.3.11");
  write(
    "package.json",
    JSON.stringify({ devDependencies: { wrangler: "4.115.0" } }),
  );
  write(
    "node_modules/wrangler/package.json",
    JSON.stringify({ version: "4.115.0" }),
  );
  write("bin/bun", '#!/bin/sh\nprintf "1.3.11\\n"\n');
  chmodSync(join(root, "bin/bun"), 0o755);
  for (const tree of BUILD_TREES) write(`${tree}/entry.js`);
  write(`${BUILD_TREES[0]}/.assetsignore`, "_worker.js\n");
  write(`${BUILD_TREES[0]}/_app/.hidden/data.json`, '{"valid":true}');
  write("apps/web/.svelte-kit/tsconfig.json", "preserve generated config");
  write("apps/web/.svelte-kit/output/client/keep.txt", "preserve client");
  write("node_modules/dependency/keep.txt", "fresh dependency");
  write(".gitignore", "node_modules/\napps/web/.svelte-kit/\nbin/\n");
  write("apps/web/src/build-input.js", "export const version = 1;\n");
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Transit artifact test",
        "-c",
        "user.email=artifact@example.invalid",
        ...args,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git("init", "--quiet", "--initial-branch=main");
  git(
    "add",
    "--",
    ...BUILD_INPUTS,
    ".gitignore",
    "apps/web/src/build-input.js",
  );
  git("commit", "--quiet", "--message=Artifact fixture");
  const env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    GITHUB_REPOSITORY: "owner/transit",
    GITHUB_SHA: git("rev-parse", "HEAD"),
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_OUTPUT: join(directory, "outputs"),
    GITHUB_ENV: join(directory, "env"),
    TRANSIT_BUILD_TARGET: "production",
    PUBLIC_SITE_ORIGIN: "https://transit.yesid.dev",
    PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
    PUBLIC_INDEXING: "true",
  };
  const options = { root, env };
  const seal = () => {
    const outputs = prepare(stage, options);
    env.TRANSIT_EXPECTED_MANIFEST_SHA256 = outputs.manifest_sha256;
    env.TRANSIT_PRODUCER_ATTEMPT = outputs.producer_attempt;
    return outputs;
  };
  return { directory, root, stage, env, options, write, seal, git };
}

test("configure binds each eligible event to the deployment environment", (t) => {
  const f = fixture(t);
  const cases = [
    ["push", "refs/heads/main", "", "production"],
    ["push", "refs/heads/develop", "", "dev"],
    ["workflow_dispatch", "refs/heads/topic", "dev", "dev"],
    ["workflow_dispatch", "refs/heads/topic", "verify-dev", "dev"],
    [
      "workflow_dispatch",
      "refs/heads/topic",
      "verify-production",
      "production",
    ],
    ["workflow_dispatch", "refs/heads/main", "verify-production", "production"],
    ["pull_request", "refs/heads/main", "verify-production", "verification"],
    ["workflow_dispatch", "refs/heads/main", "production", "production"],
    ["workflow_dispatch", "refs/heads/topic", "production", "verification"],
    ["pull_request", "refs/heads/main", "production", "verification"],
    ["push", "refs/heads/topic", "", "verification"],
  ];
  for (const [event, ref, requested, target] of cases) {
    rmSync(f.env.GITHUB_ENV, { force: true });
    writeFileSync(f.env.GITHUB_OUTPUT, "");
    assert.equal(
      configure({
        env: {
          ...f.env,
          GITHUB_EVENT_NAME: event,
          GITHUB_REF: ref,
          TRANSIT_DEPLOY_TARGET: requested,
        },
      }),
      target,
    );
    assert.equal(
      readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
      `target=${target}\n`,
    );
    if (target === "verification")
      assert.equal(existsSync(f.env.GITHUB_ENV), false);
    else {
      const origin =
        target === "dev"
          ? "https://dev.transit.yesid.dev"
          : "https://transit.yesid.dev";
      assert.equal(
        readFileSync(f.env.GITHUB_ENV, "utf8"),
        `PUBLIC_SITE_ORIGIN=${origin}\nPUBLIC_V1_BASE=https://data.yesid.dev/v1\nPUBLIC_INDEXING=${target === "production"}\n`,
      );
    }
  }
});

test("seals, verifies, and restores hidden files while preserving fresh dependencies and other generated output", (t) => {
  const f = fixture(t);
  const outputs = f.seal();
  assert.match(outputs.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(outputs.producer_attempt, "1");
  assert.deepEqual(
    verifySource(f.stage, f.options).files.map(({ path }) => path),
    [
      `${BUILD_TREES[0]}/.assetsignore`,
      `${BUILD_TREES[0]}/_app/.hidden/data.json`,
      `${BUILD_TREES[0]}/entry.js`,
      `${BUILD_TREES[1]}/entry.js`,
      `${BUILD_TREES[2]}/entry.js`,
    ].sort(),
  );
  for (const tree of BUILD_TREES) {
    rmSync(join(f.root, tree), { recursive: true });
    f.write(`${tree}/stale.txt`, "stale");
  }
  f.env.GITHUB_RUN_ATTEMPT = "2";
  restore(f.stage, f.options);
  assert.equal(
    readFileSync(join(f.root, `${BUILD_TREES[0]}/.assetsignore`), "utf8"),
    "_worker.js\n",
  );
  assert.equal(
    readFileSync(
      join(f.root, `${BUILD_TREES[0]}/_app/.hidden/data.json`),
      "utf8",
    ),
    '{"valid":true}',
  );
  for (const tree of BUILD_TREES)
    assert.equal(existsSync(join(f.root, tree, "stale.txt")), false);
  assert.equal(
    readFileSync(join(f.root, "node_modules/dependency/keep.txt"), "utf8"),
    "fresh dependency",
  );
  assert.equal(
    readFileSync(join(f.root, "apps/web/.svelte-kit/tsconfig.json"), "utf8"),
    "preserve generated config",
  );
  assert.equal(
    readFileSync(
      join(f.root, "apps/web/.svelte-kit/output/client/keep.txt"),
      "utf8",
    ),
    "preserve client",
  );
});

test("checks cannot alter the source build or staged build after sealing", async (t) => {
  for (const location of ["root", "stage"])
    await t.test(location, (t) => {
      const f = fixture(t);
      f.seal();
      writeFileSync(join(f[location], `${BUILD_TREES[0]}/entry.js`), "changed");
      assert.throws(() => verifySource(f.stage, f.options), /mismatch/);
    });
});

test("restore rejects changed identity, producer attempt, public environment, and configuration before deletion", async (t) => {
  for (const [key, value] of [
    ["GITHUB_REPOSITORY", "other/transit"],
    ["GITHUB_SHA", "b".repeat(40)],
    ["GITHUB_RUN_ID", "456"],
    ["TRANSIT_PRODUCER_ATTEMPT", "2"],
    ["TRANSIT_PRODUCER_ATTEMPT", ""],
    ["TRANSIT_BUILD_TARGET", "dev"],
    ["PUBLIC_SITE_ORIGIN", "https://other.invalid"],
    ["PUBLIC_V1_BASE", "https://other.invalid/v1"],
    ["PUBLIC_INDEXING", "false"],
    ["TRANSIT_EXPECTED_MANIFEST_SHA256", "b".repeat(64)],
    ["TRANSIT_EXPECTED_MANIFEST_SHA256", ""],
  ])
    await t.test(key + value, (t) => {
      const f = fixture(t);
      f.seal();
      f.env[key] = value;
      assert.throws(() => restore(f.stage, f.options));
      assert.equal(
        readFileSync(join(f.root, `${BUILD_TREES[0]}/entry.js`), "utf8"),
        `${BUILD_TREES[0]}/entry.js`,
      );
    });
  for (const path of BUILD_INPUTS)
    await t.test(path, (t) => {
      const f = fixture(t);
      f.seal();
      f.write(path, "changed");
      assert.throws(() => restore(f.stage, f.options));
      assert.equal(
        existsSync(join(f.root, `${BUILD_TREES[0]}/entry.js`)),
        true,
      );
    });
});

test("restore rejects missing, extra, changed, linked, and unsafe staged entries without touching existing output", async (t) => {
  const mutations = {
    missing: (f) => rmSync(join(f.stage, `${BUILD_TREES[0]}/entry.js`)),
    changed: (f) =>
      writeFileSync(join(f.stage, `${BUILD_TREES[0]}/entry.js`), "changed"),
    extra: (f) =>
      writeFileSync(join(f.stage, `${BUILD_TREES[0]}/extra.txt`), "extra"),
    outside: (f) => writeFileSync(join(f.stage, "outside.txt"), "extra"),
    emptyDirectory: (f) => mkdirSync(join(f.stage, `${BUILD_TREES[0]}/extra`)),
    symlink: (f) =>
      symlinkSync(
        join(f.root, "bun.lock"),
        join(f.stage, `${BUILD_TREES[0]}/link`),
      ),
    hardlink: (f) =>
      linkSync(
        join(f.root, `${BUILD_TREES[0]}/entry.js`),
        join(f.stage, `${BUILD_TREES[0]}/hardlink`),
      ),
    fifo: (f) =>
      execFileSync("mkfifo", [join(f.stage, `${BUILD_TREES[0]}/fifo`)]),
    manifestLink: (f) => {
      rmSync(join(f.stage, "manifest.json"));
      symlinkSync(join(f.root, "bun.lock"), join(f.stage, "manifest.json"));
    },
    parentSymlink: (f) => {
      rmSync(join(f.stage, BUILD_TREES[1]), { recursive: true });
      symlinkSync(join(f.root, BUILD_TREES[1]), join(f.stage, BUILD_TREES[1]));
    },
    unsafe: (f) =>
      writeFileSync(join(f.stage, `${BUILD_TREES[0]}/bad\\name`), "unsafe"),
    manifest: (f) => writeFileSync(join(f.stage, "manifest.json"), "{}"),
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, (t) => {
      const f = fixture(t);
      f.seal();
      f.write(`${BUILD_TREES[0]}/existing.txt`, "keep until validated");
      mutate(f);
      assert.throws(() => restore(f.stage, f.options));
      assert.equal(
        readFileSync(join(f.root, `${BUILD_TREES[0]}/existing.txt`), "utf8"),
        "keep until validated",
      );
    });
});

test("prepare rejects source links and overlapping or populated stages", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "bun.lock"), join(f.root, `${BUILD_TREES[0]}/link`));
  assert.throws(() => prepare(f.stage, f.options), /regular file/);
  assert.equal(existsSync(f.stage), false);
  rmSync(join(f.root, `${BUILD_TREES[0]}/link`));
  for (const stage of [
    f.root,
    join(f.root, BUILD_TREES[0]),
    join(f.root, BUILD_TREES[0], "stage"),
    f.directory,
  ]) {
    assert.throws(() => prepare(stage, f.options), /overlaps/);
  }
  mkdirSync(f.stage);
  writeFileSync(join(f.stage, "keep.txt"), "existing");
  assert.throws(() => prepare(f.stage, f.options), /empty/);
  assert.equal(readFileSync(join(f.stage, "keep.txt"), "utf8"), "existing");
});

test("prepare rejects missing source trees, parent links, hardlinks, and special files", async (t) => {
  const mutations = {
    missing: (f) => rmSync(join(f.root, BUILD_TREES[2]), { recursive: true }),
    hardlink: (f) =>
      linkSync(
        join(f.root, `${BUILD_TREES[0]}/entry.js`),
        join(f.root, `${BUILD_TREES[0]}/hardlink`),
      ),
    fifo: (f) =>
      execFileSync("mkfifo", [join(f.root, `${BUILD_TREES[0]}/fifo`)]),
    parentLink: (f) => {
      rmSync(join(f.root, BUILD_TREES[2]), { recursive: true });
      symlinkSync(join(f.root, BUILD_TREES[0]), join(f.root, BUILD_TREES[2]));
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, (t) => {
      const f = fixture(t);
      mutate(f);
      assert.throws(() => prepare(f.stage, f.options));
      assert.equal(existsSync(f.stage), false);
    });
});

test("restore checks every destination ancestor before replacing any tree", (t) => {
  const f = fixture(t);
  f.seal();
  rmSync(join(f.root, "apps/web/.svelte-kit/output"), { recursive: true });
  symlinkSync(f.directory, join(f.root, "apps/web/.svelte-kit/output"));
  assert.throws(() => restore(f.stage, f.options), /plain directory/);
  assert.equal(existsSync(join(f.root, `${BUILD_TREES[0]}/entry.js`)), true);
});

test("tool versions must match repository pins", async (t) => {
  for (const [path, data] of [
    [".nvmrc", "0.0.0"],
    [".bun-version", "0.0.0"],
    ["node_modules/wrangler/package.json", '{"version":"0.0.0"}'],
    ["package.json", '{"devDependencies":{"wrangler":"^4.115.0"}}'],
  ])
    await t.test(path, (t) => {
      const f = fixture(t);
      f.write(path, data);
      if (BUILD_INPUTS.includes(path)) {
        f.git("add", "--", path);
        f.git("commit", "--quiet", "--message=Change tool pin");
        f.env.GITHUB_SHA = f.git("rev-parse", "HEAD");
      }
      assert.throws(() => prepare(f.stage, f.options), /version|pinned/);
      assert.equal(existsSync(f.stage), false);
    });
});

test("every artifact phase independently requires the expected Git HEAD and a clean checkout", async (t) => {
  const source = "apps/web/src/build-input.js";
  const mutations = {
    wrongHead: {
      change: (f) =>
        f.git(
          "commit",
          "--quiet",
          "--allow-empty",
          "--message=Different checkout",
        ),
      error: /Checkout HEAD mismatch/,
    },
    trackedWorktree: {
      change: (f) => f.write(source, "export const version = 2;\n"),
      error: /Checkout contents mismatch/,
    },
    untrackedSource: {
      change: (f) =>
        f.write(
          "apps/web/src/routes/new/+page.svelte",
          "<p>Uncommitted route</p>\n",
        ),
      error: /Checkout contents mismatch/,
    },
    staged: {
      change: (f) => {
        f.write(source, "export const version = 2;\n");
        f.git("add", "--", source);
      },
      error: /Checkout contents mismatch/,
    },
    indexOnly: {
      change: (f) => {
        f.write(source, "export const version = 2;\n");
        f.git("add", "--", source);
        f.write(source, "export const version = 1;\n");
      },
      error: /Checkout contents mismatch/,
    },
  };
  for (const command of [prepare, verifySource, restore]) {
    for (const [name, { change, error }] of Object.entries(mutations)) {
      await t.test(`${command.name}: ${name}`, (t) => {
        const f = fixture(t);
        if (command !== prepare) f.seal();
        change(f);
        assert.throws(() => command(f.stage, f.options), error);
        assert.equal(
          readFileSync(join(f.root, `${BUILD_TREES[0]}/entry.js`), "utf8"),
          `${BUILD_TREES[0]}/entry.js`,
        );
        if (command === prepare) assert.equal(existsSync(f.stage), false);
      });
    }
  }
});

test("every artifact phase requires staging outside the checkout", async (t) => {
  for (const command of [prepare, verifySource, restore]) {
    await t.test(command.name, (t) => {
      const f = fixture(t);
      if (command !== prepare) f.seal();
      assert.throws(
        () => command(join(f.root, "artifact"), f.options),
        /stage overlaps the checkout/,
      );
      assert.equal(existsSync(join(f.root, "artifact")), false);
      assert.equal(
        existsSync(join(f.root, `${BUILD_TREES[0]}/entry.js`)),
        true,
      );
    });
  }
});

test("byte-identical config materialization preserves the checked-out commit contract", (t) => {
  const f = fixture(t);
  const turbo = readFileSync(join(f.root, "turbo.json"));
  f.write("turbo.json", turbo);
  f.seal();
  f.write("turbo.json", turbo);
  verifySource(f.stage, f.options);
  restore(f.stage, f.options);
  assert.equal(f.git("status", "--porcelain", "--untracked-files=all"), "");
});

test("CLI rejects missing arguments and unknown commands", () => {
  for (const args of [[], ["unknown"], ["restore"], ["configure", "extra"]])
    assert.throws(() => main(args), /Usage/);
});

test("CLI uses the explicit checkout cwd and emitted producer outputs across jobs", (t) => {
  const f = fixture(t);
  const script = fileURLToPath(
    new URL("./web-build-artifact.mjs", import.meta.url),
  );
  const run = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: f.root,
      env: f.env,
      encoding: "utf8",
    });
  run("configure");
  run("prepare", f.stage);
  const outputs = Object.fromEntries(
    readFileSync(f.env.GITHUB_OUTPUT, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  f.env.TRANSIT_EXPECTED_MANIFEST_SHA256 = outputs.manifest_sha256;
  f.env.TRANSIT_PRODUCER_ATTEMPT = outputs.producer_attempt;
  run("verify-source", f.stage);
  for (const tree of BUILD_TREES)
    rmSync(join(f.root, tree), { recursive: true });
  run("restore", f.stage);
  assert.equal(
    readFileSync(join(f.root, `${BUILD_TREES[0]}/.assetsignore`), "utf8"),
    "_worker.js\n",
  );
});
