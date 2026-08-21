import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const IMMUTABLE_PATH = /^\/_app\/immutable\/.+$/u;
const SHA_40 = /^[a-f\d]{40}$/u;
const SHA_256 = /^[a-f\d]{64}$/u;

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function normalizedOrigin(origin) {
  if (typeof origin !== "string")
    throw new Error("E6_FINGERPRINT_ORIGIN_INVALID");
  try {
    const url = new URL(origin);
    if (!/^https?:$/u.test(url.protocol))
      throw new Error("unsupported protocol");
    return url.origin;
  } catch {
    throw new Error(`E6_FINGERPRINT_ORIGIN_INVALID ${String(origin)}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fingerprintDigest(htmlSha256, assets) {
  return sha256(
    [
      `html:${htmlSha256}`,
      ...assets.map((asset) => `${asset.path}:${asset.sha256}`),
    ].join("\n"),
  );
}

export function assertServedBuildFingerprint(receipt) {
  if (
    !exactKeys(receipt, [
      "head",
      "origin",
      "htmlSha256",
      "assetCount",
      "fingerprint",
      "assets",
    ]) ||
    !SHA_40.test(receipt.head ?? "") ||
    normalizedOrigin(receipt.origin) !== receipt.origin ||
    !SHA_256.test(receipt.htmlSha256 ?? "") ||
    !Number.isSafeInteger(receipt.assetCount) ||
    receipt.assetCount < 1 ||
    !SHA_256.test(receipt.fingerprint ?? "") ||
    !Array.isArray(receipt.assets) ||
    receipt.assets.length !== receipt.assetCount
  ) {
    throw new Error("E6_FINGERPRINT_RECEIPT_INVALID");
  }
  const seen = new Set();
  for (const [index, asset] of receipt.assets.entries()) {
    if (
      !exactKeys(asset, ["path", "url", "sha256"]) ||
      !IMMUTABLE_PATH.test(asset.path ?? "") ||
      asset.url !== new URL(asset.path, receipt.origin).href ||
      !SHA_256.test(asset.sha256 ?? "") ||
      seen.has(asset.path) ||
      (index > 0 && receipt.assets[index - 1].path >= asset.path)
    ) {
      throw new Error("E6_FINGERPRINT_RECEIPT_INVALID");
    }
    seen.add(asset.path);
  }
  if (
    fingerprintDigest(receipt.htmlSha256, receipt.assets) !==
    receipt.fingerprint
  ) {
    throw new Error("E6_FINGERPRINT_RECEIPT_INVALID");
  }
  return receipt;
}

export function assertServedAssetBytes(receipt, url, bytes) {
  assertServedBuildFingerprint(receipt);
  const asset = receipt.assets.find((entry) => entry.url === url);
  if (!asset || sha256(bytes) !== asset.sha256) {
    throw new Error(`E6_FINGERPRINT_BROWSER_ASSET_MISMATCH url=${String(url)}`);
  }
  return asset;
}

export function assertServedHtmlBytes(receipt, bytes) {
  assertServedBuildFingerprint(receipt);
  if (sha256(bytes) !== receipt.htmlSha256) {
    throw new Error("E6_FINGERPRINT_BROWSER_HTML_MISMATCH");
  }
  return receipt.htmlSha256;
}

export function assertSameServedBuildFingerprint(before, after) {
  assertServedBuildFingerprint(before);
  assertServedBuildFingerprint(after);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("E6_FINGERPRINT_CHANGED");
  }
  return after;
}

function localAssetPath(clientRoot, pathname) {
  if (
    typeof clientRoot !== "string" ||
    clientRoot.length === 0 ||
    !IMMUTABLE_PATH.test(pathname)
  ) {
    throw new Error(`E6_FINGERPRINT_PATH_INVALID ${String(pathname)}`);
  }
  return join(clientRoot, pathname.slice(1));
}

export function extractServedEntryUrls(html, origin) {
  if (typeof html !== "string") throw new Error("E6_FINGERPRINT_HTML_INVALID");
  const expectedOrigin = normalizedOrigin(origin);
  const urls = new Set();
  for (const match of html.matchAll(/(\/_app\/immutable\/[^"')\s]+)/g)) {
    try {
      const url = new URL(match[1], expectedOrigin);
      if (url.origin === expectedOrigin && IMMUTABLE_PATH.test(url.pathname))
        urls.add(url.href);
    } catch {
      // Malformed references are not served same-origin entry assets.
    }
  }
  return [...urls].sort();
}

async function servedBytes(fetchFn, url) {
  let response;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new Error(
      `E6_FINGERPRINT_FETCH_FAILED url=${url} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response?.ok)
    throw new Error(
      `E6_FINGERPRINT_FETCH_FAILED url=${url} status=${response?.status}`,
    );
  return Buffer.from(await response.arrayBuffer());
}

async function immutableBuildPaths(clientRoot, readdirFn) {
  const root = join(clientRoot, "_app", "immutable");
  const paths = [];
  const walk = async (directory, prefix) => {
    const entries = await readdirFn(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error("E6_FINGERPRINT_LOCAL_INVALID");
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
      else if (entry.isFile()) paths.push(`/_app/immutable/${relative}`);
      else throw new Error("E6_FINGERPRINT_LOCAL_INVALID");
    }
  };
  await walk(root, "");
  return paths.sort();
}

export async function fingerprintServedBuild({
  head,
  origin,
  html,
  clientRoot,
  fetchFn = fetch,
  readFileFn = readFile,
  readdirFn = readdir,
} = {}) {
  if (!SHA_40.test(head ?? ""))
    throw new Error("E6_FINGERPRINT_HEAD_INVALID");
  if (
    typeof fetchFn !== "function" ||
    typeof readFileFn !== "function" ||
    typeof readdirFn !== "function"
  ) {
    throw new Error("E6_FINGERPRINT_IO_INVALID");
  }
  const normalized = normalizedOrigin(origin);
  const entryUrls = extractServedEntryUrls(html, normalized);
  if (entryUrls.length === 0)
    throw new Error("E6_FINGERPRINT_NO_ENTRY_ASSETS");
  let paths;
  try {
    paths = await immutableBuildPaths(clientRoot, readdirFn);
  } catch (error) {
    throw new Error(
      `E6_FINGERPRINT_LOCAL_MISSING error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const urls = paths.map((path) => new URL(path, normalized).href);
  if (entryUrls.some((url) => !urls.includes(url)) || urls.length === 0) {
    throw new Error("E6_FINGERPRINT_LOCAL_MISSING");
  }
  const assets = [];
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    const served = await servedBytes(fetchFn, url);
    let local;
    try {
      local = await readFileFn(localAssetPath(clientRoot, pathname));
    } catch (error) {
      throw new Error(
        `E6_FINGERPRINT_LOCAL_MISSING path=${pathname} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const servedHash = sha256(served);
    const localHash = sha256(local);
    if (!served.equals(local)) {
      throw new Error(
        `E6_FINGERPRINT_MISMATCH path=${pathname} served=${servedHash} local=${localHash}`,
      );
    }
    assets.push({ path: pathname, url, sha256: servedHash });
  }
  const htmlSha256 = sha256(Buffer.from(html, "utf8"));
  const fingerprint = fingerprintDigest(htmlSha256, assets);
  return assertServedBuildFingerprint({
    head,
    origin: normalized,
    htmlSha256,
    assetCount: assets.length,
    fingerprint,
    assets,
  });
}
