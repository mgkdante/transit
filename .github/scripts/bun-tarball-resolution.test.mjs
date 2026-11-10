import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

function tarEntry(name, content) {
  const bytes = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name);
  for (const [offset, length, number] of [
    [100, 8, 0o644],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, bytes.length],
    [136, 12, 0],
  ])
    header.write(number.toString(8).padStart(length - 1, "0") + "\0", offset);
  header.fill(32, 148, 156);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}

function packageTarball(name, peers) {
  return gzipSync(
    Buffer.concat([
      tarEntry(
        "package/package.json",
        JSON.stringify({
          name,
          version: "1.0.0",
          main: "index.js",
          peerDependencies: peers,
        }),
      ),
      tarEntry(
        "package/index.js",
        "module.exports = " + JSON.stringify(name) + ";\n",
      ),
      Buffer.alloc(1024),
    ]),
  );
}

function install(directory, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bun",
      [
        "install",
        "--frozen-lockfile",
        "--verbose",
        "--cache-dir",
        join(directory, "cache"),
      ],
      {
        cwd: directory,
        signal,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (bytes) => {
        output += bytes.toString();
      });
    let failure;
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error("Frozen tarball install failed: " + output));
      else resolve(output);
    });
  });
}

function graph(directory, base, assets) {
  const dependencies = Object.fromEntries(
    Array.from({ length: 16 }, (_, id) => [
      "@fixture/package-" + id,
      base + "/canonical/" + id + ".tgz",
    ]),
  );
  const peers = Object.fromEntries(
    [1, 2, 3].map((id) => [
      "@fixture/package-" + id,
      base + "/former/" + id + ".tgz",
    ]),
  );
  const overrides = Object.fromEntries(
    [1, 2, 3].map((id) => [
      "@fixture/package-" + id,
      dependencies["@fixture/package-" + id],
    ]),
  );
  const packages = {};
  for (let id = 0; id < 16; id++) {
    const name = "@fixture/package-" + id;
    const metadata = id === 0 ? { peerDependencies: peers } : {};
    const bytes = packageTarball(name, metadata.peerDependencies);
    assets.set(id, bytes);
    packages[name] = [
      name + "@" + dependencies[name],
      metadata,
      "sha512-" + createHash("sha512").update(bytes).digest("base64"),
    ];
  }
  const manifest = {
    name: "tarball-resolution-regression",
    private: true,
    dependencies,
    overrides,
  };
  const lock = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: { "": { name: manifest.name, dependencies } },
    overrides,
    packages,
  });
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "bun.lock"), lock);
  return { dependencies, lock };
}

function fixtureServer(assets) {
  const requested = new Set();
  let held;
  const server = createServer((request, response) => {
    const match = /^\/(canonical|former)\/(\d+)\.tgz$/.exec(request.url);
    if (!match) {
      response.writeHead(404).end();
      return;
    }
    const id = Number(match[2]);
    if (match[1] === "former") {
      response.writeHead(302, { Location: "/canonical/" + id + ".tgz" }).end();
      return;
    }
    if (id === 0 && requested.size < 15) {
      held = response;
      return;
    }
    response.end(assets.get(id));
    if (id > 0) requested.add(id);
    if (requested.size === 15 && held) {
      held.end(assets.get(0));
      held = undefined;
    }
  });
  return server;
}

test(
  "a frozen cold install resolves direct and redirected transitive tarballs",
  {
    timeout: 15_000,
  },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "transit-tarball-graph-"));
    const assets = new Map();
    const server = fixtureServer(assets);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = "http://127.0.0.1:" + server.address().port;
      const { dependencies, lock } = graph(directory, base, assets);
      await install(directory, t.signal);
      assert.equal(readFileSync(join(directory, "bun.lock"), "utf8"), lock);
      const consume = createRequire(join(directory, "package.json"));
      for (const name of Object.keys(dependencies)) {
        const installed = JSON.parse(
          readFileSync(
            join(directory, "node_modules", name, "package.json"),
            "utf8",
          ),
        );
        assert.equal(installed.name, name);
        assert.equal(installed.version, "1.0.0");
        assert.equal(consume(name), name);
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
