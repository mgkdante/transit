import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Exact root documentation paths only. Unknown paths always select e2e.
const DOCUMENTATION = new Set(["README.md", "AGENTS.md", "GLOSSARY.md"]);

export function classifyPaths(paths) {
  return !Array.isArray(paths) || paths.length === 0 ||
    paths.some((path) => !DOCUMENTATION.has(path));
}

export function checkRequiredJobs(needs) {
  for (const [job, need] of Object.entries(needs ?? {})) {
    if (["failure", "cancelled"].includes(need?.result)) {
      throw new Error(`${job}: unexpected result ${need.result}`);
    }
  }
  const selected = needs?.classify?.outputs?.run_e2e;
  if (needs?.classify?.result !== "success" ||
      !["true", "false"].includes(selected)) {
    throw new Error("Web path classification did not succeed");
  }
  for (const job of ["prerelease-guard", "ci-work", "unit", "e2e", "layout"]) {
    const result = needs[job]?.result;
    if (result !== "success" &&
        !(["e2e", "layout"].includes(job) && selected === "false" && result === "skipped")) {
      throw new Error(`${job}: unexpected result ${result}`);
    }
  }
}

export function changedPaths(environment) {
  if (environment.GITHUB_EVENT_NAME !== "pull_request") return null;
  try {
    const event = JSON.parse(
      readFileSync(environment.GITHUB_EVENT_PATH, "utf8"),
    );
    const { base, head } = event.pull_request;
    if (![base.sha, head.sha].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
      return null;
    const paths = execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        `${base.sha}...${head.sha}`,
      ],
      { encoding: "utf8" },
    );
    return paths.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "classify") {
    const runE2e = classifyPaths(changedPaths(process.env));
    appendFileSync(process.env.GITHUB_OUTPUT, `run_e2e=${runE2e}\n`);
    console.log(`Run e2e: ${runE2e}`);
  } else if (process.argv[2] === "required") {
    checkRequiredJobs(JSON.parse(process.env.NEEDS_JSON));
  } else {
    throw new Error("Expected classify or required");
  }
}
