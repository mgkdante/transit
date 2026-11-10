import assert from "node:assert/strict";
import test from "node:test";
import { basename } from "node:path";
import { rollback } from "./worker-rollback.mjs";

const version = "12345678-1234-1234-1234-123456789abc";
test("rollback defaults to previous Worker version and records Wranglers actual version", () => {
  assert.equal(
    rollback("", (_node, args, options) => {
      assert.deepEqual(args.slice(1), ["rollback", "--yes"]);
      assert.equal(basename(options.cwd), "web");
      return `Worker Version ${version} has been deployed to 100% of traffic.\nCurrent Version ID: ${version}\n`;
    }),
    version,
  );
});
test("explicit rollback uses an argument array and requires matching confirmation", () => {
  assert.equal(
    rollback(version, (_node, args) => {
      assert.deepEqual(args.slice(1), ["rollback", version, "--yes"]);
      return `Current Version ID: ${version}`;
    }),
    version,
  );
  assert.throws(
    () => rollback("--invalid", () => assert.fail("must not execute")),
    /Invalid/,
  );
  assert.throws(() => rollback(version, () => "Cancelled"), /did not confirm/);
  assert.throws(
    () =>
      rollback(
        version,
        () => "Current Version ID: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ),
    /did not confirm/,
  );
});
