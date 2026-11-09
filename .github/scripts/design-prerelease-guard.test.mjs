import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { checkManifests } from "./design-prerelease-guard.mjs";

function repository(t, manifests) {
  const root = mkdtempSync(join(tmpdir(), "transit-design-guard-"));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "--quiet", root]);
  for (const [file, content] of Object.entries(manifests)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
const url = (tag = "0.38.1", pkg = "ui", version = tag) => `https://github.com/mgkdante/yesid.design/releases/download/v${tag}/yesid-${pkg}-${version}.tgz`;

function rejects(t, manifest, field, key, value) {
  const root = repository(t, { "package.json": {}, "apps/new/package.json": manifest });
  assert.throws(() => checkManifests(root), (error) => {
    for (const text of ["apps/new/package.json", field, key, JSON.stringify(value), "stable release"]) {
      assert.ok(error.message.includes(text), `Missing ${text} in ${error.message}`);
    }
    return true;
  });
}

test("exact stable tarballs pass across manifests and dependency fields", (t) => {
  const root = repository(t, {
    "package.json": { devDependencies: { "@yesid/config": url("0.38.1", "config") } },
    "apps/web/package.json": {
      dependencies: { "@yesid/ui": url() }, peerDependencies: { "@yesid/tokens": url("0.38.1", "tokens") },
      optionalDependencies: { "@yesid/motion": url("0.38.1", "motion") },
      overrides: { parent: { "@yesid/ui": url() } }, resolutions: { "parent>@yesid/ui": url() },
    },
    "apps/other/package.json": { dependencies: { other: "0.38.1+build.1.2.3-deadbeef" } },
  });
  assert.doesNotThrow(() => checkManifests(root));
});

for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"]) {
  for (const value of [url("0.39.0-rc.1"), url("0.38.1", "ui", "0.39.0-rc.1"), "^0.38.1", "catalog:", "workspace:*", "file:../ui", "link:../ui", "git+https://github.com/mgkdante/yesid.design.git", "0.38.1+build.1.2.3-deadbeef", url() + "?text=1.2.3-foo", url() + "#stable", url() + "\n", url("0.38.1+build"), url("0.38.1", "ui", "0.38.2"), url("0.38.1", "tokens"), url().replace("github.com", "example.com")]) {
    test(`${field} rejects non-exact reference ${value}`, (t) => {
      rejects(t, { [field]: { "@yesid/ui": value } }, field, "@yesid/ui", value);
    });
  }
}

for (const [field, entries, key, value] of [
  ["overrides", { "@yesid/ui@^0.38": "catalog:" }, "@yesid/ui@^0.38", "catalog:"],
  ["overrides", { parent: { "@yesid/ui@*": "workspace:*" } }, "@yesid/ui@*", "workspace:*"],
  ["resolutions", { "parent>@yesid/ui": "0.39.0-rc.1" }, "parent>@yesid/ui", "0.39.0-rc.1"],
  ["dependencies", { design: "npm:@yesid/ui@0.39.0-rc.1" }, "design", "npm:@yesid/ui@0.39.0-rc.1"],
  ["dependencies", { design: url("0.39.0-rc.1") }, "design", url("0.39.0-rc.1")],
]) {
  test(`detects design targets through ${field} ${key}`, (t) => rejects(t, { [field]: entries }, field, key, value));
}

test("mixed stable versions fail with both reference locations", (t) => {
  const root = repository(t, {
    "package.json": { dependencies: { "@yesid/ui": url() } },
    "apps/web/package.json": { dependencies: { "@yesid/tokens": url("0.38.2", "tokens") } },
  });
  assert.throws(() => checkManifests(root), (error) => {
    for (const text of ["package.json", "apps/web/package.json", "0.38.1", "0.38.2", "lockstep"]) assert.ok(error.message.includes(text));
    return true;
  });
});

test("ignored workspace manifests are scanned", (t) => {
  const root = repository(t, { "package.json": {}, "ignored/package.json": { dependencies: { "@yesid/ui": "catalog:" } } });
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  assert.throws(() => checkManifests(root), /ignored\/package.json/);
});

test("invalid JSON and unreadable tracked manifests fail closed", (t) => {
  const root = repository(t, { "package.json": "{invalid" });
  assert.throws(() => checkManifests(root), /package.json.*cannot read or parse/);
  execFileSync("git", ["add", "package.json"], { cwd: root });
  rmSync(join(root, "package.json"));
  assert.throws(() => checkManifests(root), /package.json.*cannot read or parse/);
});

test("a manifest directory and a missing walk root fail closed", (t) => {
  const root = repository(t, {});
  mkdirSync(join(root, "package.json"));
  assert.throws(() => checkManifests(root), /package.json/);
  assert.throws(() => checkManifests(join(root, "missing")));
});

test("directory walk cycles fail closed", (t) => {
  const root = repository(t, {});
  symlinkSync(root, join(root, "loop"), "junction");
  assert.throws(() => checkManifests(root), /cannot walk manifests.*Directory cycle/);
});
test("object overrides validate stable dot and nested design leaves", (t) => {
  const root = repository(t, {
    "package.json": { overrides: { "@yesid/ui": {
      ".": url(), "@yesid/tokens": url("0.38.1", "tokens"), other: "^1.2.3",
    } } },
  });
  assert.doesNotThrow(() => checkManifests(root));
});

for (const value of [url("0.39.0-rc.1"), url("0.38.1", "tokens")]) {
  test(`object override dot rejects ${value}`, (t) => {
    rejects(t, { overrides: { "@yesid/ui": { ".": value } } }, "overrides", ".", value);
  });
}

test("non-design override children do not inherit design identity", (t) => {
  const root = repository(t, {
    "package.json": { overrides: { "@yesid/ui": { other: "^1.2.3" } } },
  });
  assert.doesNotThrow(() => checkManifests(root));
});

test("non-design override children still detect candidate release URLs", (t) => {
  const value = url("0.39.0-rc.1");
  rejects(t, { overrides: { "@yesid/ui": { other: value } } }, "overrides", "other", value);
});

for (const key of ["@yesid/ui/@yesid/tokens", "@yesid/ui>@yesid/tokens"]) {
  test(`selector ${key} accepts the last design target`, (t) => {
    const root = repository(t, {
      "package.json": { resolutions: { [key]: url("0.38.1", "tokens") } },
    });
    assert.doesNotThrow(() => checkManifests(root));
  });
  test(`selector ${key} rejects an ancestor tarball`, (t) => {
    rejects(t, { resolutions: { [key]: url() } }, "resolutions", key, url());
  });
}
