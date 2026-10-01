import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checkout = fileURLToPath(new URL("../../", import.meta.url));
const rootPackage = JSON.parse(
  readFileSync(join(checkout, "package.json"), "utf8"),
);
const proxyPackage = JSON.parse(
  readFileSync(join(checkout, "apps/data-proxy/package.json"), "utf8"),
);
const fixtureParent = resolve(tmpdir(), "transit-deploy-commands");
const forwardedArgs = [
  "--env",
  "preview environment",
  "--name",
  "worker with spaces",
];
const sentinel = "environment value with spaces";

const localDeploy =
  /^(?:\.\.\/\.\.\/node_modules\/\.bin\/wrangler|node \.\.\/\.\.\/node_modules\/wrangler\/bin\/wrangler\.js) deploy$/;

function fixture(t) {
  assert.match(proxyPackage.scripts.deploy, localDeploy);
  assert.equal(
    rootPackage.scripts["deploy:data-proxy"],
    "bun run --cwd apps/data-proxy deploy",
  );
  const webPrefix = "cd apps/web && bun run build && ";
  assert.ok(rootPackage.scripts["deploy:web"].startsWith(webPrefix));
  assert.match(
    rootPackage.scripts["deploy:web"].slice(webPrefix.length),
    localDeploy,
  );

  mkdirSync(fixtureParent, { recursive: true });
  const root = mkdtempSync(join(fixtureParent, "checkout with spaces-"));
  t.after(() => {
    const target = resolve(root);
    const withinParent = relative(fixtureParent, target);
    assert.ok(isAbsolute(target));
    assert.ok(
      withinParent &&
        !isAbsolute(withinParent) &&
        withinParent !== ".." &&
        !withinParent.startsWith(
          `..${process.platform === "win32" ? "\\" : "/"}`,
        ),
      `Refusing cleanup outside ${fixtureParent}: ${target}`,
    );
    rmSync(target, { recursive: true, force: true });
  });
  const write = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  write(
    "package.json",
    JSON.stringify({
      name: "transit-deploy-command-fixture",
      private: true,
      scripts: {
        "deploy:web": rootPackage.scripts["deploy:web"],
        "deploy:data-proxy": rootPackage.scripts["deploy:data-proxy"],
      },
      devDependencies: { wrangler: rootPackage.devDependencies.wrangler },
    }),
  );
  write(
    "apps/data-proxy/package.json",
    JSON.stringify({
      name: "transit-data-proxy-fixture",
      private: true,
      scripts: { deploy: proxyPackage.scripts.deploy },
    }),
  );
  write(
    "apps/web/package.json",
    JSON.stringify({
      name: "transit-web-fixture",
      private: true,
      scripts: { build: "node build.cjs" },
    }),
  );
  write(
    "node_modules/wrangler/package.json",
    JSON.stringify({
      name: "wrangler",
      version: rootPackage.devDependencies.wrangler,
      bin: { wrangler: "./bin/wrangler.js" },
    }),
  );
  const recorder = (kind, exitVariable) => `
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.DEPLOY_COMMAND_TEST_EVENTS, JSON.stringify({
  kind: ${JSON.stringify(kind)},
  cwd: process.cwd(),
  args: process.argv.slice(2),
  sentinel: process.env.DEPLOY_COMMAND_TEST_SENTINEL,
}) + "\\n");
process.exit(Number(process.env.${exitVariable} || 0));
`;
  write(
    "node_modules/wrangler/bin/wrangler.js",
    recorder("wrangler", "DEPLOY_COMMAND_TEST_WRANGLER_EXIT"),
  );
  write(
    "apps/web/build.cjs",
    recorder("build", "DEPLOY_COMMAND_TEST_BUILD_EXIT"),
  );
  assert.equal(existsSync(join(root, "node_modules/.bin")), false);
  const eventsPath = join(root, "events.jsonl");
  const env = {};
  for (const name of [
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    DEPLOY_COMMAND_TEST_EVENTS: eventsPath,
    DEPLOY_COMMAND_TEST_SENTINEL: sentinel,
    BUN_CONFIG_NO_CLEAR_TERMINAL: "1",
  });
  return {
    root,
    run(cwd, script, extraEnv = {}) {
      return spawnSync("bun", ["run", script, ...forwardedArgs], {
        cwd: join(root, cwd),
        env: { ...env, ...extraEnv },
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
      });
    },
    events() {
      return existsSync(eventsPath)
        ? readFileSync(eventsPath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
        : [];
    },
  };
}

function expectedEvent(f, kind, app) {
  return {
    kind,
    cwd: join(f.root, "apps", app),
    args: kind === "build" ? [] : ["deploy", ...forwardedArgs],
    sentinel,
  };
}

function expectStatus(result, status) {
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
}

test("proxy deploy launches root Wrangler with its cwd, environment and spaced arguments", (t) => {
  const f = fixture(t);
  expectStatus(f.run("apps/data-proxy", "deploy"), 0);
  assert.deepEqual(f.events(), [expectedEvent(f, "wrangler", "data-proxy")]);
});

test("root proxy delegation preserves the app cwd, environment and spaced arguments", (t) => {
  const f = fixture(t);
  expectStatus(f.run("", "deploy:data-proxy"), 0);
  assert.deepEqual(f.events(), [expectedEvent(f, "wrangler", "data-proxy")]);
});

test("web deploy completes its build before launching root Wrangler in the web cwd", (t) => {
  const f = fixture(t);
  expectStatus(f.run("", "deploy:web"), 0);
  assert.deepEqual(f.events(), [
    expectedEvent(f, "build", "web"),
    expectedEvent(f, "wrangler", "web"),
  ]);
});

for (const [label, cwd, script, app] of [
  ["direct proxy deploy", "apps/data-proxy", "deploy", "data-proxy"],
  ["root proxy delegation", "", "deploy:data-proxy", "data-proxy"],
  ["web deploy", "", "deploy:web", "web"],
]) {
  test(`${label} propagates Wrangler's failing exit status`, (t) => {
    const f = fixture(t);
    expectStatus(
      f.run(cwd, script, { DEPLOY_COMMAND_TEST_WRANGLER_EXIT: "37" }),
      37,
    );
    assert.deepEqual(f.events(), [
      ...(app === "web" ? [expectedEvent(f, "build", "web")] : []),
      expectedEvent(f, "wrangler", app),
    ]);
  });
}

test("a failing web build prevents Wrangler from launching and propagates its exit status", (t) => {
  const f = fixture(t);
  expectStatus(
    f.run("", "deploy:web", { DEPLOY_COMMAND_TEST_BUILD_EXIT: "29" }),
    29,
  );
  assert.deepEqual(f.events(), [expectedEvent(f, "build", "web")]);
});
