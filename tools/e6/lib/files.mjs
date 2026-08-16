import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

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
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

export async function writeRecording(directory, { metadata, payloads }) {
  if (!(payloads instanceof Map))
    fail("E6_RECORDING_INVALID payloads must be a Map");
  await mkdir(directory, { recursive: true });
  const files = [];
  for (const path of [...payloads.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    safePayloadPath(path);
    const bytes = bytesFor(payloads.get(path));
    const destination = join(directory, "payloads", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    files.push({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const receipt = { ...metadata, files };
  await writeFile(join(directory, "recording.json"), bytesFor(receipt), {
    flag: "wx",
  });
  return receipt;
}

export async function loadRecording(directory) {
  let metadata;
  try {
    metadata = JSON.parse(
      await readFile(join(directory, "recording.json"), "utf8"),
    );
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
    const bytes = await readFile(join(directory, "payloads", path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      fail(`E6_RECORDING_DIGEST_MISMATCH ${path}`);
    }
    try {
      payloads.set(path, JSON.parse(bytes.toString("utf8")));
    } catch {
      fail(`E6_RECORDING_PAYLOAD_INVALID ${path}`);
    }
  }
  const recording = { metadata, payloads };
  return { ...recording, recordingDigest: recordingContentDigest(recording) };
}
