import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkArguments } from "./site-probe-weekly.mjs";

const options = {
  encoding: /** @type {const} */ ("utf8"),
  timeout: 10_000,
  windowsHide: true,
};
const version = execFileSync("lychee", ["--version"], options).trim();
assert.match(version, /^lychee 0\.24\.2(?:\s|$)/);

const directory = mkdtempSync(join(tmpdir(), "transit-lychee-contract-"));
const source = join(directory, "source.html");
try {
  writeFileSync(
    source,
    '<a href="https://transit.yesid.dev/">Transit</a><a href="https://yesid.dev/">Yesid</a>',
  );
  for (const host of ["transit.yesid.dev", "yesid.dev"]) {
    // Exact production options, with only --offline added: no public requests.
    execFileSync(
      "lychee",
      [...linkArguments([source], host), "--offline"],
      options,
    );
    console.log(
      JSON.stringify({
        lychee: version,
        platform: process.platform,
        argumentsParsedFor: host,
        mode: "offline",
      }),
    );
  }
} finally {
  rmSync(source, { force: true });
  rmdirSync(directory);
}
