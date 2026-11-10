import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Ubuntu Noble's package metadata and downloaded payload have this exact digest.
export const UNZIP_ARCHIVE = Object.freeze({
  url: "https://archive.ubuntu.com/ubuntu/pool/main/u/unzip/unzip_6.0-28ubuntu4.1_amd64.deb",
  bytes: 174454,
  sha256: "a505b9d491386167bd8e14e3383315a4a7d6539e4406745901ccf009a7988271",
});

async function verifiedArchive(archive, fetcher) {
  const response = await fetcher(archive.url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Layout unzip download failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > archive.bytes)
      throw new Error("Layout unzip archive exceeds pinned size");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (
    size !== archive.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== archive.sha256
  ) {
    throw new Error("Layout unzip archive authentication failed");
  }
  return bytes;
}

export async function installUnzip({
  root = process.env.RUNNER_TEMP,
  platform = process.platform,
  arch = process.arch,
  archive = UNZIP_ARCHIVE,
  fetcher = fetch,
  execute = execFileSync,
} = {}) {
  if (platform !== "linux" || arch !== "x64")
    throw new Error("Layout unzip requires the Linux x64 Noble container");
  if (typeof root !== "string" || !isAbsolute(root))
    throw new Error("Layout tool root must be absolute");
  const bytes = await verifiedArchive(archive, fetcher);
  const work = await mkdtemp(join(root, "transit-layout-unzip-"));
  const packagePath = join(work, "unzip.deb");
  const install = join(work, "tool");
  await writeFile(packagePath, bytes, { mode: 0o600 });
  await mkdir(install, { mode: 0o700 });
  // Extract only: dpkg-deb does not run package maintainer scripts or configure the host.
  execute("dpkg-deb", ["--extract", packagePath, install], {
    encoding: "utf8",
  });
  const bin = join(install, "usr", "bin");
  execute(join(bin, "unzip"), ["-v"], { encoding: "utf8" });
  return bin;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const bin = await installUnzip();
  await appendFile(process.env.GITHUB_PATH, `${bin}\n`);
  process.stdout.write(
    "Provisioned checksum-verified layout ZIP extractor before Bun setup.\n",
  );
}
