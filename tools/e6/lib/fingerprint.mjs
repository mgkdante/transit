import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const IMMUTABLE_PATH = /^\/_app\/immutable\/.+$/u;

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

export async function fingerprintServedBuild({
  head,
  origin,
  html,
  clientRoot,
  fetchFn = fetch,
  readFileFn = readFile,
} = {}) {
  if (typeof head !== "string" || head.length === 0)
    throw new Error("E6_FINGERPRINT_HEAD_INVALID");
  if (typeof fetchFn !== "function" || typeof readFileFn !== "function") {
    throw new Error("E6_FINGERPRINT_IO_INVALID");
  }
  const normalized = normalizedOrigin(origin);
  const urls = extractServedEntryUrls(html, normalized);
  if (urls.length === 0) throw new Error("E6_FINGERPRINT_NO_ENTRY_ASSETS");
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
  const fingerprint = sha256(
    assets
      .map((asset) => `${asset.path}:${asset.sha256}`)
      .sort()
      .join("\n"),
  );
  return {
    head,
    origin: normalized,
    assetCount: assets.length,
    fingerprint,
    assets,
  };
}
