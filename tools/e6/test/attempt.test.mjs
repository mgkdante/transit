import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  assertAttempt,
  attemptMarkerDigest,
  attemptMarkerPath,
  buildAttempt,
  claimAttemptMarker,
  loadAttemptMarker,
} from "../lib/attempt.mjs";
import {
  readLocalGitIdentity,
  readPublicGitIdentity,
  sanitizeGitEnvironment,
} from "../lib/identity.mjs";

const HEAD = "4fcb603aa2d600d97061c26ee010a7212555dced";
const TREE = "45892764d7c65708a9c56467d444999ea2ca0d4b";

function identity(gitCommonDirectory) {
  return {
    head: HEAD,
    tree: TREE,
    publicMainHead: HEAD,
    publicMainTree: TREE,
    remote: "https://github.com/mgkdante/transit.git",
    gitCommonDirectory,
    status: "",
  };
}

function attempt(gitCommonDirectory) {
  return buildAttempt({
    consumedUtc: "2026-08-24T12:00:00.000Z",
    identity: identity(gitCommonDirectory),
    recordingDirectory: "/tmp/peak-20260824T120000Z",
  });
}

test("concurrent worktrees can publish exactly one complete B2 marker", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-attempt-race-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const claims = [
    attempt(root),
    attempt(root),
  ];

  const results = await Promise.allSettled(
    claims.map((candidate) =>
      claimAttemptMarker({ attempt: candidate, gitCommonDirectory: root }),
    ),
  );
  const fulfilled = results.filter(({ status }) => status === "fulfilled");
  const rejected = results.filter(({ status }) => status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /E6_ATTEMPT_ALREADY_CONSUMED/u);

  const loaded = await loadAttemptMarker({ gitCommonDirectory: root });
  assert.deepEqual(loaded.attempt, fulfilled[0].value.attempt);
  assert.equal(
    loaded.attemptMarkerDigest,
    fulfilled[0].value.attemptMarkerDigest,
  );
  assert.equal((await stat(attemptMarkerPath(root))).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(attemptMarkerPath(root)))).mode & 0o777, 0o700);
});

test("a malformed durable marker stays consumed and cannot be repaired by retry", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-attempt-tamper-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const first = attempt(root);
  await claimAttemptMarker({ attempt: first, gitCommonDirectory: root });
  const markerPath = attemptMarkerPath(root);
  const malformed = Buffer.from("{}\n", "utf8");
  await writeFile(markerPath, malformed);

  await assert.rejects(
    loadAttemptMarker({ gitCommonDirectory: root }),
    /E6_ATTEMPT_MARKER_INVALID/u,
  );
  await assert.rejects(
    claimAttemptMarker({
      attempt: attempt(root),
      gitCommonDirectory: root,
    }),
    /E6_ATTEMPT_ALREADY_CONSUMED/u,
  );
  assert.deepEqual(await readFile(markerPath), malformed);
});

test("attempt marker identity is canonical across object key order", () => {
  const original = attempt("/tmp/e6-git-common");
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(attemptMarkerDigest(reordered), attemptMarkerDigest(original));
});

test("a symlink at the canonical marker is consumed but never followed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-attempt-symlink-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const markerPath = attemptMarkerPath(root);
  await mkdir(dirname(markerPath), { mode: 0o700 });
  const target = join(root, "target");
  await writeFile(target, "unchanged\n");
  await symlink(target, markerPath);

  await assert.rejects(
    claimAttemptMarker({
      attempt: attempt(root),
      gitCommonDirectory: root,
    }),
    /E6_ATTEMPT_ALREADY_CONSUMED/u,
  );
  await assert.rejects(
    loadAttemptMarker({ gitCommonDirectory: root }),
    /E6_ATTEMPT_MARKER_INVALID/u,
  );
  assert.equal(await readFile(target, "utf8"), "unchanged\n");
});

test("a symlinked attempt directory is rejected", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-attempt-dir-symlink-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target-directory");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, dirname(attemptMarkerPath(root)));
  await assert.rejects(
    claimAttemptMarker({
      attempt: attempt(root),
      gitCommonDirectory: root,
    }),
    /E6_DURABLE_MARKER_DIRECTORY_INVALID/u,
  );
  assert.deepEqual(await readdir(target), []);
});

test("a FIFO marker is rejected without blocking validation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-attempt-fifo-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const markerPath = attemptMarkerPath(root);
  await mkdir(dirname(markerPath), { mode: 0o700 });
  execFileSync("/usr/bin/mkfifo", [markerPath]);
  const moduleUrl = new URL("../lib/attempt.mjs", import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `import(${JSON.stringify(moduleUrl)}).then(({loadAttemptMarker}) => loadAttemptMarker({gitCommonDirectory:${JSON.stringify(root)}})).then(() => process.exit(2)).catch((error) => process.exit(error.message === "E6_ATTEMPT_MARKER_INVALID" ? 0 : 3));`,
    ],
    { timeout: 500 },
  );
  assert.equal(child.status, 0);
});

test("attempt construction refuses an unpinned runtime before consumption", () => {
  assert.throws(
    () =>
      buildAttempt({
        consumedUtc: "2026-08-24T12:00:00.000Z",
        identity: identity("/tmp/e6-git-common"),
        recordingDirectory: "/tmp/peak-20260824T120000Z",
        id: "11111111-1111-4111-8111-111111111111",
        runtime: { engine: "bun", version: "1.3.13" },
      }),
    /E6_ATTEMPT_RUNTIME_INVALID/u,
  );
});

test("attempt evidence accepts only the two pinned runtime engines", () => {
  const options = {
    consumedUtc: "2026-08-24T12:00:00.000Z",
    identity: identity("/tmp/e6-git-common"),
    recordingDirectory: "/tmp/peak-20260824T120000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };
  assert.throws(
    () =>
      buildAttempt({
        ...options,
        runtime: { engine: "python", version: "24.15.0" },
      }),
    /E6_ATTEMPT_RUNTIME_INVALID/u,
  );

  const forged = { ...buildAttempt(options) };
  forged.runtime = { engine: "python", version: "24.15.0" };
  assert.throws(() => assertAttempt(forged), /E6_ATTEMPT_RUNTIME_INVALID/u);
});

test("Git identity commands ignore caller-selected repository state", () => {
  const environment = sanitizeGitEnvironment({
    PATH: "/tmp/fake-bin",
    GIT_DIR: "/tmp/other.git",
    HTTPS_PROXY: "https://mitm.invalid",
    ALL_PROXY: "socks5://mitm.invalid",
    SSL_CERT_FILE: "/tmp/mitm-ca.pem",
  });
  assert.equal(environment.PATH, "/usr/bin:/bin");
  assert.equal(environment.HOME, "/nonexistent");
  assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
  for (const name of [
    "GIT_DIR",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "SSL_CERT_FILE",
  ]) {
    assert.equal(name in environment, false);
  }
});

test("public identity uses the fixed Git binary outside repository config", async () => {
  const calls = [];
  const local = identity("/tmp/e6-git-common");
  const receipt = await readPublicGitIdentity({
    readLocal: async () => {
      const { publicMainHead, publicMainTree, remote, ...value } = local;
      return value;
    },
    execute: async (executable, args, options) => {
      calls.push({ executable, args, options });
      return { stdout: `${HEAD}\trefs/heads/main\n`, stderr: "" };
    },
  });
  assert.equal(receipt.head, HEAD);
  assert.equal(calls[0].executable, "/usr/bin/git");
  assert.equal(calls[0].options.cwd, "/usr");
  assert.equal(calls[0].args[0], "--no-replace-objects");
  assert.equal(calls[0].options.env.PATH, "/usr/bin:/bin");
  assert.equal("HTTPS_PROXY" in calls[0].options.env, false);
  assert.equal(calls[0].options.env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.ok(calls[0].args.includes("credential.helper="));
});

test("local identity refuses hidden index flags and ignores replacement refs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "e6-identity-repo-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("/usr/bin/git", ["init", "-q", root]);
  await writeFile(join(root, "tracked.txt"), "first\n");
  execFileSync("/usr/bin/git", ["-C", root, "add", "tracked.txt"]);
  execFileSync(
    "/usr/bin/git",
    ["-C", root, "-c", "user.name=E6", "-c", "user.email=e6@example.test", "commit", "-qm", "first"],
  );
  const original = execFileSync(
    "/usr/bin/git",
    ["-C", root, "rev-parse", "HEAD^{tree}"],
    { encoding: "utf8" },
  ).trim();
  await writeFile(join(root, "tracked.txt"), "second\n");
  execFileSync("/usr/bin/git", ["-C", root, "add", "tracked.txt"]);
  execFileSync(
    "/usr/bin/git",
    ["-C", root, "-c", "user.name=E6", "-c", "user.email=e6@example.test", "commit", "-qm", "second"],
  );
  const replacement = execFileSync(
    "/usr/bin/git",
    ["-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const originalCommit = execFileSync(
    "/usr/bin/git",
    ["-C", root, "rev-parse", "HEAD^"],
    { encoding: "utf8" },
  ).trim();
  execFileSync("/usr/bin/git", ["-C", root, "replace", originalCommit, replacement]);
  execFileSync("/usr/bin/git", [
    "--no-replace-objects",
    "-C",
    root,
    "checkout",
    "-q",
    originalCommit,
  ]);
  assert.equal((await readLocalGitIdentity({ repositoryRoot: root })).tree, original);

  execFileSync("/usr/bin/git", ["-C", root, "update-index", "--assume-unchanged", "tracked.txt"]);
  await assert.rejects(
    readLocalGitIdentity({ repositoryRoot: root }),
    /E6_IDENTITY_INDEX_FLAGS_INVALID/u,
  );
});
