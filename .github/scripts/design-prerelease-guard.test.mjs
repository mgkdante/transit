import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { checkManifests } from "./design-prerelease-guard.mjs";

function repository(t, manifests) {
  const root = mkdtempSync(join(tmpdir(), "transit-design-guard-"));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")));
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "--quiet", root]);
  for (const [file, content] of Object.entries(manifests)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
const url = (tag, version = tag) => `https://github.com/mgkdante/yesid.design/releases/download/v${tag}/yesid-ui-${version}.tgz`;

test("stable releases and manifests without design packages pass", (t) => {
  const root = repository(t, {
    "package.json": { devDependencies: { "@yesid/config": url("1.2.3") } },
    "apps/web/package.json": { dependencies: { "@yesid/ui": "^1.2.3" } },
    "apps/other/package.json": { dependencies: { other: "1.2.3-rc.1" } },
  });
  assert.doesNotThrow(() => checkManifests(root));
});

for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  for (const candidate of [url("1.2.3-rc.1"), url("1.2.3-beta.2", "1.2.3"), url("1.2.3", "1.2.3-preview.4"), "^1.2.3-alpha.1", "1.2.3-0", "1.2.3--preview"]) {
    test(`${section} rejects ${candidate} in a nested manifest`, (t) => {
      const root = repository(t, { "package.json": {}, "new/app/package.json": { [section]: { "@yesid/ui": candidate } } });
      assert.throws(() => checkManifests(root), (error) => {
        for (const value of ["new/app/package.json", "@yesid/ui", candidate, "stable release"]) assert.ok(error.message.includes(value));
        return true;
      });
    });
  }
}

test("invalid JSON and unreadable tracked manifests fail closed", (t) => {
  const root = repository(t, { "package.json": "{invalid" });
  assert.throws(() => checkManifests(root), /package.json.*cannot read or parse/);
  execFileSync("git", ["add", "package.json"], { cwd: root });
  rmSync(join(root, "package.json"));
  assert.throws(() => checkManifests(root), /package.json.*cannot read or parse/);
});
