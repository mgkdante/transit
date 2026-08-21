import { createHash, randomUUID } from "node:crypto";
import { constants, linkSync } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const E6_DURABLE_MARKER_DIRECTORY = "e6-attempts";

function fail(message) {
  throw new Error(message);
}

function isThenable(value) {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function"
  );
}

function canonicalValue(value, ancestors = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    fail("E6_DURABLE_MARKER_JSON_INVALID");
  }
  if (ancestors.has(value)) fail("E6_DURABLE_MARKER_JSON_INVALID");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        !Object.keys(value).every((key, index) => key === String(index)) ||
        Object.keys(value).length !== value.length
      ) {
        fail("E6_DURABLE_MARKER_JSON_INVALID");
      }
      return value.map((item) => canonicalValue(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("E6_DURABLE_MARKER_JSON_INVALID");
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonBytes(value) {
  return Buffer.from(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`,
    "utf8",
  );
}

export function canonicalJsonDigest(value) {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}

export function durableMarkerPath(gitCommonDirectory, filename) {
  if (
    typeof gitCommonDirectory !== "string" ||
    !isAbsolute(gitCommonDirectory) ||
    resolve(gitCommonDirectory) !== gitCommonDirectory ||
    typeof filename !== "string" ||
    basename(filename) !== filename ||
    !/^[a-z0-9][a-z0-9.-]*\.json$/u.test(filename)
  ) {
    fail("E6_DURABLE_MARKER_PATH_INVALID");
  }
  return join(gitCommonDirectory, E6_DURABLE_MARKER_DIRECTORY, filename);
}

export async function assertDurableMarkerAbsent({
  gitCommonDirectory,
  filename,
  existsCode = "E6_DURABLE_MARKER_EXISTS",
} = {}) {
  const markerPath = durableMarkerPath(gitCommonDirectory, filename);
  try {
    await lstat(markerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return markerPath;
    throw error;
  }
  fail(existsCode);
}

async function assertMarkerDirectory(directory) {
  let created = false;
  try {
    await mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const handle = await openMarkerDirectory(directory);
  await handle.close();
  if (created) await syncDurableDirectory(dirname(directory));
}

async function openMarkerDirectory(
  directory,
  invalidCode = "E6_DURABLE_MARKER_DIRECTORY_INVALID",
  { requirePrivate = true } = {},
) {
  let handle;
  try {
    handle = await open(
      directory,
      constants.O_RDONLY |
        (constants.O_DIRECTORY ?? 0) |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const stats = await handle.stat();
    if (
      !stats.isDirectory() ||
      (requirePrivate && (stats.mode & 0o777) !== 0o700)
    ) {
      fail(invalidCode);
    }
    return handle;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error instanceof Error && error.message.startsWith("E6_")) {
      throw error;
    }
    fail(invalidCode);
  }
}

export async function syncDurableDirectory(directory) {
  const handle = await openMarkerDirectory(
    directory,
    "E6_DURABLE_DIRECTORY_INVALID",
    { requirePrivate: false },
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncMarkerDirectory(directory) {
  const handle = await openMarkerDirectory(directory);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function loadDurableMarker({
  gitCommonDirectory,
  filename,
  validate,
  invalidCode = "E6_DURABLE_MARKER_INVALID",
  maximumBytes = 16_384,
} = {}) {
  if (typeof validate !== "function") fail(invalidCode);
  const markerPath = durableMarkerPath(gitCommonDirectory, filename);
  const directoryHandle = await openMarkerDirectory(
    dirname(markerPath),
    invalidCode,
  );
  let handle;
  try {
    handle = await open(
      markerPath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size < 2 ||
      stats.size > maximumBytes
    ) {
      fail(invalidCode);
    }
    const bytes = await handle.readFile();
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
      validate(value);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("E6_")) {
        throw error;
      }
      fail(invalidCode);
    }
    const canonical = canonicalJsonBytes(value);
    if (!bytes.equals(canonical)) fail(invalidCode);
    return {
      value,
      digest: createHash("sha256").update(canonical).digest("hex"),
      markerPath,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("E6_")) {
      throw error;
    }
    fail(invalidCode);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await directoryHandle.close().catch(() => {});
  }
}

export async function publishDurableMarker({
  gitCommonDirectory,
  filename,
  value,
  validate,
  alreadyConsumedCode,
  invalidCode = "E6_DURABLE_MARKER_INVALID",
  maximumBytes = 16_384,
  assertPublicationAllowed = () => {},
  linkCanonical = linkSync,
} = {}) {
  if (typeof linkCanonical !== "function") {
    fail("E6_DURABLE_MARKER_LINK_INVALID");
  }
  if (
    typeof validate !== "function" ||
    typeof assertPublicationAllowed !== "function" ||
    typeof alreadyConsumedCode !== "string" ||
    !alreadyConsumedCode.startsWith("E6_")
  ) {
    fail(invalidCode);
  }
  validate(value);
  const markerPath = durableMarkerPath(gitCommonDirectory, filename);
  const directory = dirname(markerPath);
  await assertMarkerDirectory(directory);
  const bytes = canonicalJsonBytes(value);
  if (bytes.length > maximumBytes) fail(invalidCode);
  const temporary = join(directory, `.${randomUUID()}.marker.tmp`);
  let handle;
  let temporaryCreated = false;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600,
    );
    temporaryCreated = true;
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const admission = assertPublicationAllowed();
    if (isThenable(admission)) {
      fail("E6_DURABLE_MARKER_PUBLICATION_ADMISSION_INVALID");
    }
    try {
      const publication = linkCanonical(temporary, markerPath);
      if (isThenable(publication)) {
        fail("E6_DURABLE_MARKER_LINK_INVALID");
      }
    } catch (error) {
      if (error?.code === "EEXIST") fail(alreadyConsumedCode);
      throw error;
    }
    await syncMarkerDirectory(directory);
    const loaded = await loadDurableMarker({
      gitCommonDirectory,
      filename,
      validate,
      invalidCode,
      maximumBytes,
    });
    if (!canonicalJsonBytes(loaded.value).equals(bytes)) fail(invalidCode);
    return loaded;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (temporaryCreated) {
      const removed = await unlink(temporary)
        .then(() => true)
        .catch(() => false);
      if (removed) await syncMarkerDirectory(directory).catch(() => {});
    }
  }
}
