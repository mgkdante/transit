import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_TREES = [
  "apps/web/.svelte-kit/cloudflare",
  "apps/web/.svelte-kit/cloudflare-tmp",
  "apps/web/.svelte-kit/output/server",
];
export const BUILD_INPUTS = [
  ".github/workflows/web.yml",
  ".github/actions/setup/action.yml",
  ".github/scripts/web-build-artifact.mjs",
  ".github/scripts/materialize-shared-config.mjs",
  ".github/shared-tooling.json",
  ".github/shared-tooling/turbo.overlay.json",
  ".nvmrc",
  ".bun-version",
  ".npmrc",
  "bun.lock",
  "package.json",
  "turbo.json",
  "apps/web/package.json",
  "apps/web/svelte.config.js",
  "apps/web/vite.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/wrangler.toml",
].sort();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label} mismatch`);
};
const required = (env, name, pattern) => {
  const value = env[name];
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
};

function publicEnvironment(target) {
  if (!["dev", "production"].includes(target))
    throw new Error("Invalid TRANSIT_BUILD_TARGET");
  return {
    PUBLIC_SITE_ORIGIN:
      target === "production"
        ? "https://transit.yesid.dev"
        : "https://dev.transit.yesid.dev",
    PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
    PUBLIC_INDEXING: target === "production" ? "true" : "false",
  };
}

function targetFor(env) {
  if (env.GITHUB_EVENT_NAME === "push") {
    if (env.GITHUB_REF === "refs/heads/main") return "production";
    if (env.GITHUB_REF === "refs/heads/develop") return "dev";
  }
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    if (env.TRANSIT_DEPLOY_TARGET === "dev") return "dev";
    if (
      env.TRANSIT_DEPLOY_TARGET === "production" &&
      env.GITHUB_REF === "refs/heads/main"
    )
      return "production";
  }
  return "verification";
}

function emit(path, values) {
  if (!path) throw new Error("Missing GitHub output file");
  appendFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

export function configure({ env = process.env } = {}) {
  const target = targetFor(env);
  if (target !== "verification")
    emit(env.GITHUB_ENV, publicEnvironment(target));
  emit(env.GITHUB_OUTPUT, { target });
  return target;
}

function safeRelative(path) {
  if (
    isAbsolute(path) ||
    /[\\:\x00-\x1f\x7f]/.test(path) ||
    path.split("/").some((part) => ["", ".", ".."].includes(part))
  ) {
    throw new Error(`Unsafe artifact path: ${JSON.stringify(path)}`);
  }
}

// Check every ancestor: lstat of the leaf alone would follow a parent symlink.
function plainDirectories(path, allowMissing = false) {
  const parent = dirname(path);
  if (parent !== path) plainDirectories(parent, allowMissing);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat && allowMissing) return;
  if (!stat?.isDirectory()) throw new Error(`Not a plain directory: ${path}`);
}

function fileRecord(root, path) {
  safeRelative(path);
  const full = join(root, path);
  plainDirectories(dirname(full));
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.nlink !== 1)
    throw new Error(`Not a regular unlinked file: ${path}`);
  const bytes = readFileSync(full);
  return { path, size: bytes.length, sha256: sha256(bytes) };
}

function walk(root, path, files, directories) {
  safeRelative(path);
  const full = join(root, path);
  const stat = lstatSync(full);
  if (stat.isDirectory()) {
    directories.push(path);
    for (const name of readdirSync(full).sort())
      walk(root, `${path}/${name}`, files, directories);
  } else if (stat.isFile()) {
    files.push(fileRecord(root, path));
  } else {
    throw new Error(`Not a regular file or directory: ${path}`);
  }
}

function inventory(root, staging = false) {
  plainDirectories(root);
  const files = [];
  const directories = [];
  for (const path of staging ? readdirSync(root).sort() : BUILD_TREES) {
    plainDirectories(dirname(join(root, path)));
    walk(root, path, files, directories);
  }
  const buildFiles = files.filter(
    ({ path }) => !(staging && path === "manifest.json"),
  );
  for (const { path } of buildFiles) {
    if (!BUILD_TREES.some((tree) => path.startsWith(`${tree}/`)))
      throw new Error(`Unexpected artifact file: ${path}`);
  }
  for (const tree of BUILD_TREES) {
    if (!buildFiles.some(({ path }) => path.startsWith(`${tree}/`)))
      throw new Error(`Missing build tree: ${tree}`);
  }
  if (staging) {
    for (const directory of directories) {
      if (!buildFiles.some(({ path }) => path.startsWith(`${directory}/`)))
        throw new Error(`Unexpected artifact directory: ${directory}`);
    }
  }
  return buildFiles.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

function context(root, env, producerAttempt) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const sha = required(env, "GITHUB_SHA", /^[a-f0-9]{40}$/);
  same(git("rev-parse", "HEAD"), sha, "Checkout HEAD");
  same(
    git("status", "--porcelain", "--untracked-files=all"),
    "",
    "Checkout contents",
  );
  const target = env.TRANSIT_BUILD_TARGET;
  const publicEnv = publicEnvironment(target);
  for (const [key, value] of Object.entries(publicEnv))
    same(env[key], value, key);
  const inputs = BUILD_INPUTS.map((path) => fileRecord(root, path));
  const node = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  const bun = readFileSync(join(root, ".bun-version"), "utf8").trim();
  const wrangler = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    .devDependencies.wrangler;
  for (const version of [node, bun, wrangler]) {
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))
      throw new Error("Tool versions must be pinned");
  }
  same(process.versions.node, node, "Node version");
  same(
    execFileSync("bun", ["--version"], {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim(),
    bun,
    "Bun version",
  );
  same(
    JSON.parse(
      readFileSync(join(root, "node_modules/wrangler/package.json"), "utf8"),
    ).version,
    wrangler,
    "Wrangler version",
  );
  return {
    repository: required(
      env,
      "GITHUB_REPOSITORY",
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    ),
    sha,
    run_id: required(env, "GITHUB_RUN_ID", /^[1-9][0-9]*$/),
    producer_attempt: required(
      { producerAttempt },
      "producerAttempt",
      /^[1-9][0-9]*$/,
    ),
    target,
    public_env: publicEnv,
    tools: { node, bun, wrangler },
    inputs,
  };
}

function paths(root, stage) {
  root = resolve(root);
  if (typeof stage !== "string" || !stage)
    throw new Error("Missing artifact stage directory");
  stage = resolve(root, stage);
  const within = (child, parent) => {
    const path = relative(parent, child);
    return (
      path === "" ||
      (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
    );
  };
  if (within(root, stage) || within(stage, root)) {
    throw new Error("Artifact stage overlaps the checkout");
  }
  plainDirectories(root);
  plainDirectories(stage, true);
  return { root, stage };
}

export function prepare(
  stage,
  { root = process.cwd(), env = process.env } = {},
) {
  ({ root, stage } = paths(root, stage));
  if (lstatSync(stage, { throwIfNoEntry: false }) && readdirSync(stage).length)
    throw new Error("Artifact stage must be empty");
  const manifest = {
    schema: 1,
    context: context(
      root,
      env,
      required(env, "GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/),
    ),
    files: inventory(root),
  };
  for (const { path } of manifest.files) {
    mkdirSync(dirname(join(stage, path)), { recursive: true });
    copyFileSync(join(root, path), join(stage, path));
  }
  same(inventory(stage, true), manifest.files, "Staged build");
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(stage, "manifest.json"), bytes, { flag: "wx" });
  const outputs = {
    manifest_sha256: sha256(bytes),
    producer_attempt: manifest.context.producer_attempt,
  };
  emit(env.GITHUB_OUTPUT, outputs);
  return outputs;
}

function verify(stage, root, env, attempt) {
  const expectedHash = required(
    env,
    "TRANSIT_EXPECTED_MANIFEST_SHA256",
    /^[a-f0-9]{64}$/,
  );
  const record = fileRecord(stage, "manifest.json");
  same(record.sha256, expectedHash, "Manifest seal");
  const manifest = JSON.parse(
    readFileSync(join(stage, "manifest.json"), "utf8"),
  );
  same(manifest.schema, 1, "Manifest schema");
  same(manifest.context, context(root, env, attempt), "Build context");
  same(inventory(stage, true), manifest.files, "Artifact inventory");
  return manifest;
}

export function verifySource(
  stage,
  { root = process.cwd(), env = process.env } = {},
) {
  ({ root, stage } = paths(root, stage));
  const manifest = verify(
    stage,
    root,
    env,
    required(env, "GITHUB_RUN_ATTEMPT", /^[1-9][0-9]*$/),
  );
  same(inventory(root), manifest.files, "Source build");
  return manifest;
}

export function restore(
  stage,
  { root = process.cwd(), env = process.env } = {},
) {
  ({ root, stage } = paths(root, stage));
  const manifest = verify(
    stage,
    root,
    env,
    required(env, "TRANSIT_PRODUCER_ATTEMPT", /^[1-9][0-9]*$/),
  );
  // Validate every destination before deleting any build output.
  for (const tree of BUILD_TREES) plainDirectories(join(root, tree), true);
  for (const tree of BUILD_TREES)
    rmSync(join(root, tree), { recursive: true, force: true });
  for (const { path } of manifest.files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(stage, path), join(root, path));
  }
  same(inventory(root), manifest.files, "Restored build");
  return manifest;
}

export function main(args = process.argv.slice(2), options = {}) {
  const [command, stage] = args;
  if (command === "configure" && args.length === 1) return configure(options);
  const commands = { prepare, "verify-source": verifySource, restore };
  if (!Object.hasOwn(commands, command) || args.length !== 2)
    throw new Error(
      "Usage: web-build-artifact.mjs configure | prepare|verify-source|restore STAGE",
    );
  return commands[command](stage, options);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`Web build artifact: ${error.message}`);
    process.exitCode = 1;
  }
}
