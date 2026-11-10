import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const candidates = process.platform === "win32"
  ? [join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe"), "bash"]
  : ["bash"];
const bash = candidates.find((candidate) =>
  spawnSync(candidate, ["-c", "exit 0"], { timeout: 5000 }).status === 0,
);
const smoke = readFileSync(new URL("../smoke.sh", import.meta.url), "utf8");
// Load the real definitions, without running production network checks.
const definitions = smoke.slice(0, smoke.indexOf("# --- direct R2 custom domain:"));
const options = { skip: bash ? false : "Bash is unavailable or cannot execute on this platform" };

function probe(t, call, outcomes) {
  const directory = mkdtempSync(join(tmpdir(), "transit-smoke-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "curl"), `#!/usr/bin/env bash
count=0
[[ ! -f count ]] || read -r count < count
count=$((count + 1))
echo "$count" > count
case "$count" in
${outcomes.map((outcome, index) => `${index + 1}) ${outcome} ;;`).join("\n")}
*) exit 56 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync(bash, ["-c", `export PATH="$PWD:$PATH"\n${definitions}\n${call}`], {
    cwd: directory,
    env: { ...process.env, EDGE_MAX_ATTEMPTS: "3", EDGE_RETRY_DELAY_S: "0" },
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  return { ...result, attempts: Number(readFileSync(join(directory, "count"), "utf8")) };
}

test("retired provider reports the last HTTP status after a transport failure", options, (t) => {
  const result = probe(t, 'assert_retired_provider "https://example.test/retired" 404',
    ["exit 56", "printf 503", "printf 502"]);
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 3);
  assert.match(result.stderr, /FAIL: .*last status 502/);
});

for (const [name, response] of [
  ["wrong status", "HTTP/2 200\\n"],
  ["cache HIT", "HTTP/2 404\\nCF-Cache-Status: HIT\\n"],
  ["positive Age", "HTTP/2 404\\nAge: 1\\n"],
]) {
  test(`missing object still rejects ${name} after a transport failure`, options, (t) => {
    const result = probe(t, 'assert_missing_edge_bypass "https://example.test/missing"',
      ["exit 56", `printf '${response}'`]);
    assert.equal(result.status, 1);
    assert.equal(result.attempts, 2);
    assert.match(result.stderr, /FAIL:/);
  });
}

test("missing object fails if its last probe has a transport error", options, (t) => {
  const result = probe(t, 'assert_missing_edge_bypass "https://example.test/missing"',
    ["printf 'HTTP/2 404\\n'", "exit 56"]);
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 2);
  assert.match(result.stderr, /FAIL: .*last curl exit 56/);
});

for (const [name, call, success, maximum] of [
  ["retired provider", 'assert_retired_provider "https://example.test/retired" 404', "printf 404", 3],
  ["missing object", 'assert_missing_edge_bypass "https://example.test/missing"', "printf 'HTTP/2 404\\n'", 2],
]) {
  test(`${name} absorbs a transport failure then accepts 404`, options, (t) => {
    const result = probe(t, call, ["exit 56", success]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.attempts, 2);
    assert.match(result.stderr, /wait: https:\/\/example\.test\/\w+.*curl exit 56.*attempt 1\//);
  });

  test(`${name} fails with diagnostics after exactly its attempt limit`, options, (t) => {
    const result = probe(t, call, []);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.attempts, maximum);
    assert.match(result.stderr, /FAIL: .*curl exit 56/);
    assert.equal((result.stderr.match(/wait: .*curl exit 56/g) || []).length, maximum);
  });
}
