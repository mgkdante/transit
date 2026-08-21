import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
export const E6_PUBLIC_REPOSITORY = "https://github.com/mgkdante/transit.git";
const GIT_SHA = /^[a-f\d]{40}$/u;

function fail(message) {
  throw new Error(message);
}

export function assertCleanGitStatus(status) {
  if (status !== "") fail("E6_IDENTITY_WORKTREE_DIRTY");
}

export function assertLocalGitIdentity(identity) {
  assertCleanGitStatus(identity?.status);
  if (
    !GIT_SHA.test(identity?.head ?? "") ||
    !GIT_SHA.test(identity?.tree ?? "") ||
    typeof identity?.gitCommonDirectory !== "string" ||
    identity.gitCommonDirectory.length === 0
  ) {
    fail("E6_IDENTITY_GIT_INVALID");
  }
  return identity;
}

export function assertPublicGitIdentity(identity) {
  assertLocalGitIdentity(identity);
  if (
    identity.remote !== E6_PUBLIC_REPOSITORY ||
    identity.publicMainHead !== identity.head ||
    identity.publicMainTree !== identity.tree
  ) {
    fail(
      `E6_IDENTITY_PUBLIC_MAIN_MISMATCH expected=${String(identity?.publicMainHead)} actual=${String(identity?.head)}`,
    );
  }
  return identity;
}

export function assertGitIdentityUnchanged(before, after) {
  assertPublicGitIdentity(before);
  assertLocalGitIdentity(after);
  if (
    after.head !== before.head ||
    after.tree !== before.tree ||
    after.gitCommonDirectory !== before.gitCommonDirectory
  ) {
    fail("E6_IDENTITY_CHANGED_AFTER_ATTEMPT_CONSUMPTION");
  }
  return after;
}

export function sanitizeGitEnvironment() {
  return {
    HOME: "/nonexistent",
    XDG_CONFIG_HOME: "/nonexistent",
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    SSH_ASKPASS: "/bin/false",
  };
}

async function git(
  args,
  {
    repositoryRoot = REPOSITORY_ROOT,
    cwd = repositoryRoot,
    execute = execFileAsync,
  } = {},
) {
  return execute(GIT_EXECUTABLE, ["--no-replace-objects", ...args], {
    cwd,
    env: sanitizeGitEnvironment(),
    encoding: "utf8",
  });
}

function assertNoHiddenIndexFlags(output) {
  if (
    typeof output !== "string" ||
    output.split("\n").some((line) => /^(?:[a-z]|S) /u.test(line))
  ) {
    fail("E6_IDENTITY_INDEX_FLAGS_INVALID");
  }
}

export async function readLocalGitIdentity({
  repositoryRoot = REPOSITORY_ROOT,
  execute = execFileAsync,
} = {}) {
  const run = (args) => git(args, { repositoryRoot, execute });
  const { stdout: topLevel } = await run(["rev-parse", "--show-toplevel"]);
  if (resolve(topLevel.trim()) !== resolve(repositoryRoot))
    fail("E6_IDENTITY_GIT_INVALID");
  const { stdout: headBefore } = await run([
    "rev-parse",
    "--verify",
    "HEAD",
  ]);
  const head = headBefore.trim();
  const { stdout: tree } = await run(["rev-parse", `${head}^{tree}`]);
  const { stdout: status } = await run([
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
  ]);
  const [{ stdout: flags }, { stdout: headAfter }, { stdout: common }] =
    await Promise.all([
      run(["ls-files", "-v"]),
      run(["rev-parse", "--verify", "HEAD"]),
      run(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ]);
  assertNoHiddenIndexFlags(flags);
  if (headAfter.trim() !== head) fail("E6_IDENTITY_GIT_CHANGED");
  return assertLocalGitIdentity({
    status,
    head,
    tree: tree.trim(),
    gitCommonDirectory: common.trim(),
  });
}

export async function readGitCommonDirectory({
  repositoryRoot = REPOSITORY_ROOT,
  execute = execFileAsync,
} = {}) {
  const { stdout: topLevel } = await git(
    ["rev-parse", "--show-toplevel"],
    { repositoryRoot, execute },
  );
  if (resolve(topLevel.trim()) !== resolve(repositoryRoot)) {
    fail("E6_IDENTITY_GIT_INVALID");
  }
  const { stdout } = await git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { repositoryRoot, execute },
  );
  const directory = stdout.trim();
  if (!directory.startsWith("/")) fail("E6_IDENTITY_GIT_INVALID");
  return directory;
}

export async function readPublicGitIdentity({
  readLocal = readLocalGitIdentity,
  execute = execFileAsync,
} = {}) {
  const local = await readLocal();
  const { stdout } = await git(
    [
      "-c",
      "credential.helper=",
      "-c",
      "protocol.file.allow=never",
      "ls-remote",
      "--refs",
      E6_PUBLIC_REPOSITORY,
      "refs/heads/main",
    ],
    {
      cwd: "/usr",
      execute,
    },
  );
  const match = /^([a-f\d]{40})\s+refs\/heads\/main\n?$/u.exec(stdout);
  if (!match) fail("E6_IDENTITY_PUBLIC_MAIN_INVALID");
  return assertPublicGitIdentity({
    ...local,
    remote: E6_PUBLIC_REPOSITORY,
    publicMainHead: match[1],
    publicMainTree: local.tree,
  });
}
