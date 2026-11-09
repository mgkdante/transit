import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides", "resolutions"];
const RELEASE = /^https:\/\/github\.com\/mgkdante\/yesid\.design\/releases\/download\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/yesid-([a-z0-9][a-z0-9._-]*)-\1\.tgz$/;
const REHEARSAL = "The PR may rehearse on a candidate but can merge only after switching to the stable release.";

function manifests(root) {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "package.json", "**/package.json"], { cwd: root, encoding: "utf8" });
  const files = new Set(listed.split("\0").filter(Boolean));
  function walk(directory, ancestors = new Set()) {
    try {
      const canonical = realpathSync(directory);
      if (ancestors.has(canonical)) throw new Error("Directory cycle");
      const next = new Set([...ancestors, canonical]);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.name === "package.json") files.add(relative(root, path).split("\\").join("/"));
        if (statSync(path).isDirectory()) walk(path, next);
      }
    } catch (error) {
      throw new Error(`${relative(root, directory) || "."}: cannot walk manifests: ${error.message}`);
    }
  }
  walk(root);
  return [...files].sort();
}

function* references(entries, field) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error(`${field}: expected a dependency object`);
  for (const [key, value] of Object.entries(entries)) {
    const names = [...key.matchAll(/@yesid\/([a-z0-9][a-z0-9._-]*)/g)].map((match) => match[1]);
    const alias = typeof value === "string" && value.startsWith("npm:@yesid/");
    const tarball = typeof value === "string" && value.includes("yesid.design/releases/download/");
    if (names.length || alias || tarball) yield { field, key, value, names };
    if (value && typeof value === "object" && !Array.isArray(value))
      yield* references(value, `${field}[${JSON.stringify(key)}]`);
  }
}

function validateReference(reference, file, versions, failures) {
  const { field, key, value, names } = reference;
  const location = `${file}: ${field}: ${JSON.stringify(key)} = ${JSON.stringify(value)}`;
  const match = typeof value === "string" ? RELEASE.exec(value) : null;
  if (!match || match[0] !== value || names.some((name) => name !== match[2])) {
    failures.push(`${location}: expected an exact stable release tarball URL matching the design package`);
    return;
  }
  const version = match[1];
  if (!versions.has(version)) versions.set(version, []);
  versions.get(version).push(location);
}

export function checkManifests(root = process.cwd()) {
  const failures = [];
  const versions = new Map();
  let files;
  try {
    files = manifests(resolve(root));
  } catch (error) {
    throw new Error(`${error.message}\n${REHEARSAL}`);
  }
  for (const file of files) {
    try {
      const manifest = JSON.parse(readFileSync(resolve(root, file), "utf8"));
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
        throw new Error("Expected a manifest object");
      for (const field of FIELDS) {
        if (Object.hasOwn(manifest, field)) {
          for (const reference of references(manifest[field], field))
            validateReference(reference, file, versions, failures);
        }
      }
    } catch (error) {
      failures.push(`${file}: cannot read or parse manifest: ${error.message}`);
    }
  }
  if (versions.size > 1) failures.push(`Design releases must use one stable version in lockstep:\n${[...versions.values()].flat().join("\n")}`);
  if (failures.length) throw new Error(`${failures.join("\n")}\n${REHEARSAL}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkManifests();
}
