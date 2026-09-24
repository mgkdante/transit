import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory, restore } from "./web-build-artifact.mjs";

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const attribute = (tag, name) =>
  tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1];

function headValues(html, tag, selector, value, field) {
  const matches = (
    html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? []
  ).filter((entry) => attribute(entry, selector) === value);
  return matches.map((entry) => attribute(entry, field));
}

export async function verifyHttp(base, publicEnv, expectedVersion) {
  const address = new URL(base);
  assert.equal(address.protocol, "http:", "Probe must use local HTTP");
  assert.equal(address.hostname, "127.0.0.1", "Probe must stay on loopback");
  const paths = [
    "/_app/version.json",
    "/_app/env.js",
    "/robots.txt",
    "/sitemap.xml",
    "/privacy",
    "/fr/privacy",
  ];
  const replies = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(new URL(path, address), {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 200, `${path} status`);
      return { path, response, body: await response.text() };
    }),
  );
  const [version, environment, robots, sitemap, ...pages] = replies;
  assert.equal(
    version.body.trim(),
    expectedVersion.trim(),
    "Restored build version",
  );
  for (const [key, value] of Object.entries(publicEnv)) {
    assert.match(
      environment.body,
      new RegExp(
        `(?:^|[,{])\\s*["']?${key}["']?\\s*:\\s*${escape(JSON.stringify(value))}\\s*(?:[,}])`,
      ),
      `Runtime ${key}`,
    );
  }
  const origin = publicEnv.PUBLIC_SITE_ORIGIN;
  const indexing = publicEnv.PUBLIC_INDEXING === "true";
  assert.equal(
    robots.body,
    indexing
      ? `User-agent: *\nAllow: /\nDisallow: /_kit\nDisallow: /fr/_kit\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n",
    "Target robots policy",
  );
  if (indexing) {
    assert.ok(
      sitemap.body.includes(`<loc>${origin}/privacy</loc>`),
      "Production sitemap origin",
    );
    assert.ok(
      sitemap.body.includes(`<loc>${origin}/fr/privacy</loc>`),
      "French sitemap origin",
    );
  } else {
    assert.ok(
      !sitemap.body.includes("<loc>"),
      "Verification dev sitemap must not advertise URLs",
    );
  }
  for (const { path, response, body } of pages) {
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.deepEqual(
      headValues(body, "link", "rel", "canonical", "href"),
      [`${origin}${path}`],
      `${path} canonical`,
    );
    assert.deepEqual(
      headValues(body, "meta", "name", "robots", "content"),
      indexing ? [] : ["noindex,nofollow"],
      `${path} robots meta`,
    );
    assert.equal(
      response.headers.get("x-robots-tag"),
      indexing ? null : "noindex, nofollow",
      `${path} robots header`,
    );
    assert.match(
      body,
      new RegExp(`<html[^>]*lang="${path.startsWith("/fr/") ? "fr" : "en"}"`),
    );
  }
  return { paths, origin, indexing, v1_base: publicEnv.PUBLIC_V1_BASE };
}

export async function verifyBuiltWorker(root, target, publicEnv) {
  assert.ok(["dev", "production"].includes(target), "Unknown build target");
  const { unstable_startWorker } = await import("wrangler");
  const web = join(root, "apps/web");
  const worker = await unstable_startWorker({
    config: join(web, "wrangler.toml"),
    env: target === "dev" ? "dev" : "",
    entrypoint: join(web, ".svelte-kit/cloudflare/_worker.js"),
    // Data-independent pages use empty local R2; the compatibility service is offline too.
    bindings: {
      DATA: {
        type: "fetcher",
        fetcher: () => new Response("No snapshot fixture", { status: 404 }),
      },
    },
    dev: {
      remote: false,
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: false,
      watch: false,
      registry: undefined,
      enableContainers: false,
      logLevel: "error",
      outboundService: () => {
        throw new Error("Restored-build probe must not make external requests");
      },
    },
  });
  try {
    return await verifyHttp(
      await worker.url,
      publicEnv,
      readFileSync(
        join(web, ".svelte-kit/cloudflare/_app/version.json"),
        "utf8",
      ),
    );
  } finally {
    await worker.dispose();
  }
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 1, "Usage: verify-web-build.mjs STAGE");
  const started = performance.now();
  const root = process.cwd();
  const manifest = restore(args[0]);
  const http = await verifyBuiltWorker(
    root,
    manifest.context.target,
    manifest.context.public_env,
  );
  assert.deepEqual(
    inventory(root),
    manifest.files,
    "Restored build changed during HTTP verification",
  );
  console.log(
    JSON.stringify({
      ...http,
      sha: manifest.context.sha,
      producer_attempt: manifest.context.producer_attempt,
      artifact_files: manifest.files.length,
      seconds: (performance.now() - started) / 1000,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Restored web build: ${error.message}`);
    process.exitCode = 1;
  });
}
