import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Git owns the repository file inventory; include new, non-ignored manifests too.
export function checkManifests(root = process.cwd()) {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "package.json", "**/package.json"], { cwd: root, encoding: "utf8" });
  const failures = [];
  for (const file of new Set(files.split("\0").filter(Boolean))) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(root, file), "utf8"));
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
        throw new Error("Expected a manifest object");
    } catch (error) {
      failures.push(`${file}: cannot read or parse manifest: ${error.message}`);
      continue;
    }
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, candidate] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith("@yesid/")) continue;
        if (typeof candidate !== "string") {
          failures.push(`${file}: ${name}: invalid dependency ${JSON.stringify(candidate)}`);
        } else if (/\d+\.\d+\.\d+-[0-9A-Za-z-]/.test(decodeURIComponent(candidate))) {
          failures.push(`${file}: ${name} points at prerelease ${candidate}`);
        }
      }
    }
  }
  if (failures.length) throw new Error(`${failures.join("\n")}\nThe PR may rehearse on a candidate but can merge only after switching to the stable release.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkManifests();
}
