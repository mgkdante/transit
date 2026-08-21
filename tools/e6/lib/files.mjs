import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function safePayloadPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    posix.normalize(path) !== path ||
    path.split("/").includes("..")
  ) {
    fail(`E6_RECORDING_PATH_INVALID ${String(path)}`);
  }
  return path;
}

function bytesFor(payload) {
  return Buffer.from(
    `${JSON.stringify(canonicalValue(payload), null, 2)}\n`,
    "utf8",
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

async function assertPathAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  fail("E6_RECORDING_OUTPUT_EXISTS");
}

async function assertDirectory(directory, errorCode) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(errorCode);
  return stats;
}

async function syncDirectory(directory) {
  const handle = await open(
    directory,
    constants.O_RDONLY |
      (constants.O_DIRECTORY ?? 0) |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stats = await handle.stat();
    if (!stats.isDirectory()) fail("E6_RECORDING_DIRECTORY_INVALID");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await assertDirectory(
    directory,
    "E6_RECORDING_DIRECTORY_INVALID",
  );
  if ((stats.mode & 0o777) !== 0o700) await chmod(directory, 0o700);
}

async function writeDurableFile(destination, bytes) {
  const parent = dirname(destination);
  await ensurePrivateDirectory(parent);
  let handle;
  try {
    handle = await open(
      destination,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
      0o600,
    );
    await handle.chmod(0o600);
    const created = await handle.stat();
    if (
      !created.isFile() ||
      created.nlink !== 1 ||
      (created.mode & 0o777) !== 0o600
    ) {
      fail("E6_RECORDING_FILE_INVALID");
    }
    await handle.writeFile(bytes);
    const written = await handle.stat();
    if (!written.isFile() || written.size !== bytes.byteLength) {
      fail("E6_RECORDING_FILE_INVALID");
    }
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  await syncDirectory(parent);
}

async function readRegularFile(path) {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const stats = await handle.stat();
    if (!stats.isFile()) fail("E6_RECORDING_FILE_INVALID");
    return await handle.readFile();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function syncDirectoryTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await syncDirectoryTree(path);
    } else if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("E6_RECORDING_FILE_INVALID");
    }
  }
  await syncDirectory(directory);
}

export function recordingContentDigest({ metadata, payloads } = {}) {
  if (!metadata || !(payloads instanceof Map)) {
    fail("E6_RECORDING_DIGEST_INPUT_INVALID");
  }
  const normalizedMetadata = { ...metadata };
  delete normalizedMetadata.files;
  delete normalizedMetadata.recordingDigest;
  const hash = createHash("sha256");
  const update = (label, value) => {
    const bytes = Buffer.from(JSON.stringify(canonicalValue(value)), "utf8");
    hash.update(`${label.length}:${label}:${bytes.byteLength}:`);
    hash.update(bytes);
  };
  update("metadata", normalizedMetadata);
  for (const path of [...payloads.keys()].sort()) {
    safePayloadPath(path);
    update(path, payloads.get(path));
  }
  return hash.digest("hex");
}

export async function writeRecording(
  directory,
  { metadata, payloads },
  { beforeInstall = async () => {} } = {},
) {
  if (!(payloads instanceof Map))
    fail("E6_RECORDING_INVALID payloads must be a Map");
  const finalDirectory = resolve(directory);
  const parent = dirname(finalDirectory);
  const finalBasename = basename(finalDirectory);
  if (!finalBasename || finalDirectory === parent) {
    fail("E6_RECORDING_OUTPUT_INVALID");
  }
  await mkdir(parent, { recursive: true });
  await assertDirectory(parent, "E6_RECORDING_DIRECTORY_INVALID");
  await assertPathAbsent(finalDirectory);
  const temporaryDirectory = await mkdtemp(
    join(parent, `.${finalBasename}.partial-`),
  );
  let installed = false;
  try {
    await chmod(temporaryDirectory, 0o700);
    const temporaryStats = await assertDirectory(
      temporaryDirectory,
      "E6_RECORDING_DIRECTORY_INVALID",
    );
    const files = [];
    for (const path of [...payloads.keys()].sort((left, right) =>
      left.localeCompare(right),
    )) {
      safePayloadPath(path);
      const bytes = bytesFor(payloads.get(path));
      const destination = join(temporaryDirectory, "payloads", path);
      await writeDurableFile(destination, bytes);
      files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    const receipt = { ...metadata, files };
    const metadataBytes = bytesFor(receipt);
    await writeDurableFile(
      join(temporaryDirectory, "recording.json"),
      metadataBytes,
    );
    await syncDirectoryTree(temporaryDirectory);

    const loaded = await loadRecording(temporaryDirectory);
    const expectedDigest = recordingContentDigest({
      metadata: receipt,
      payloads,
    });
    const storedMetadataBytes = await readFile(
      join(temporaryDirectory, "recording.json"),
    );
    if (
      !storedMetadataBytes.equals(metadataBytes) ||
      loaded.recordingDigest !== expectedDigest
    ) {
      fail("E6_RECORDING_WRITE_VERIFY_FAILED");
    }

    await assertPathAbsent(finalDirectory);
    await beforeInstall();
    await assertPathAbsent(finalDirectory);
    await rename(temporaryDirectory, finalDirectory);
    installed = true;
    await syncDirectory(parent);
    const finalStats = await assertDirectory(
      finalDirectory,
      "E6_RECORDING_DIRECTORY_INVALID",
    );
    if (
      finalStats.dev !== temporaryStats.dev ||
      finalStats.ino !== temporaryStats.ino ||
      (finalStats.mode & 0o777) !== 0o700
    ) {
      fail("E6_RECORDING_DIRECTORY_INVALID");
    }
    const verified = await loadRecording(finalDirectory);
    if (verified.recordingDigest !== expectedDigest) {
      fail("E6_RECORDING_WRITE_VERIFY_FAILED");
    }
    return verified.metadata;
  } finally {
    if (!installed) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => {},
      );
      await syncDirectory(parent).catch(() => {});
    }
  }
}

export async function loadRecording(directory) {
  let metadata;
  try {
    const metadataBytes = await readRegularFile(
      join(directory, "recording.json"),
    );
    metadata = JSON.parse(metadataBytes.toString("utf8"));
    if (!metadataBytes.equals(bytesFor(metadata))) {
      fail("E6_RECORDING_METADATA_INVALID non-canonical bytes");
    }
  } catch (error) {
    fail(
      `E6_RECORDING_METADATA_INVALID ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(metadata.files))
    fail("E6_RECORDING_METADATA_INVALID files must be an array");
  const payloads = new Map();
  for (const file of metadata.files) {
    const path = safePayloadPath(file?.path);
    if (payloads.has(path))
      fail(`E6_RECORDING_METADATA_INVALID duplicate path ${path}`);
    const bytes = await readRegularFile(join(directory, "payloads", path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      fail(`E6_RECORDING_DIGEST_MISMATCH ${path}`);
    }
    try {
      const payload = JSON.parse(bytes.toString("utf8"));
      if (!bytes.equals(bytesFor(payload))) {
        fail(`E6_RECORDING_PAYLOAD_INVALID ${path}`);
      }
      payloads.set(path, payload);
    } catch {
      fail(`E6_RECORDING_PAYLOAD_INVALID ${path}`);
    }
  }
  const recording = { metadata, payloads };
  return { ...recording, recordingDigest: recordingContentDigest(recording) };
}
