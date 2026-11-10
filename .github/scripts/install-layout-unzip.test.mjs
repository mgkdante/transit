import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { installUnzip, UNZIP_ARCHIVE } from "./install-layout-unzip.mjs";

const bytes = Buffer.from("authenticated package fixture");
const archive = {
  ...UNZIP_ARCHIVE,
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

test("cold setup authenticates before extraction and probes the executable before exposing its path", async () => {
  const root = await mkdtemp(join(tmpdir(), "transit-unzip-test-"));
  const calls = [];
  try {
    const bin = await installUnzip({
      root,
      platform: "linux",
      arch: "x64",
      archive,
      fetcher: async (url, options) => {
        assert.equal(url, UNZIP_ARCHIVE.url);
        assert.equal(options.redirect, "error");
        return new Response(bytes);
      },
      execute: (command, args) => {
        calls.push([command, args]);
        return "";
      },
    });
    assert.equal(calls[0][0], "dpkg-deb");
    assert.equal(calls[0][1][0], "--extract");
    assert.deepEqual(await readFile(calls[0][1][1]), bytes);
    assert.ok(!relative(root, bin).startsWith(".."));
    assert.deepEqual(calls[1], [join(bin, "unzip"), ["-v"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bad size or digest cannot extract or execute an archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "transit-unzip-reject-"));
  try {
    for (const payload of [
      Buffer.from("short"),
      Buffer.alloc(bytes.length),
      Buffer.alloc(bytes.length + 1),
    ]) {
      await assert.rejects(
        installUnzip({
          root,
          platform: "linux",
          arch: "x64",
          archive,
          fetcher: async () => new Response(payload),
          execute: () => assert.fail("must not extract"),
        }),
        /pinned size|authentication failed/,
      );
    }
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(
      installUnzip({
        root,
        platform: "win32",
        arch: "x64",
        fetcher: () => assert.fail("must not download"),
      }),
      /Linux x64/,
    );
    await assert.rejects(
      installUnzip({
        root,
        platform: "linux",
        arch: "arm64",
        fetcher: () => assert.fail("must not download"),
      }),
      /Linux x64/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing extraction capability fails rather than hiding setup failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "transit-unzip-capability-"));
  try {
    await assert.rejects(
      installUnzip({
        root,
        platform: "linux",
        arch: "x64",
        archive,
        fetcher: async () => new Response(bytes),
        execute: () => {
          throw new Error("dpkg-deb unavailable");
        },
      }),
      /dpkg-deb unavailable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
