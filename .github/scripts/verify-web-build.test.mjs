import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { verifyHttp } from "./verify-web-build.mjs";

const version = '{"version":"sealed-build"}';
const profile = (production) => ({
  PUBLIC_SITE_ORIGIN: `https://${production ? "" : "dev."}transit.yesid.dev`,
  PUBLIC_V1_BASE: "https://data.yesid.dev/v1",
  PUBLIC_INDEXING: String(production),
});

async function server(t, production, mutate = () => {}) {
  const env = profile(production);
  const paths = [];
  const app = createServer((request, response) => {
    paths.push(request.url);
    const path = request.url;
    let body;
    const headers = {};
    if (path === "/_app/version.json") body = version;
    else if (path === "/_app/env.js")
      body = `export const env=${JSON.stringify(env)}`;
    else if (path === "/robots.txt")
      body = production
        ? `User-agent: *\nAllow: /\nDisallow: /_kit\nDisallow: /fr/_kit\nDisallow: /api/\n\nSitemap: ${env.PUBLIC_SITE_ORIGIN}/sitemap.xml\n`
        : "User-agent: *\nDisallow: /\n";
    else if (path === "/sitemap.xml")
      body = production
        ? `<urlset><url><loc>${env.PUBLIC_SITE_ORIGIN}/privacy</loc></url><url><loc>${env.PUBLIC_SITE_ORIGIN}/fr/privacy</loc></url></urlset>`
        : "<urlset/>";
    else {
      headers["content-type"] = "text/html";
      if (!production) headers["x-robots-tag"] = "noindex, nofollow";
      body = `<html lang="${path.startsWith("/fr/") ? "fr" : "en"}"><head><link href="${env.PUBLIC_SITE_ORIGIN}${path}" rel="canonical">${production ? "" : '<meta content="noindex,nofollow" name="robots">'}</head></html>`;
    }
    const result = { status: 200, body, headers };
    mutate(path, result);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  return { base: `http://127.0.0.1:${app.address().port}`, env, paths };
}

for (const production of [false, true]) {
  test(`validates ${production ? "production" : "dev"} HTTP behavior`, async (t) => {
    const f = await server(t, production);
    const result = await verifyHttp(f.base, f.env, version);
    assert.equal(result.indexing, production);
    assert.equal(result.v1_base, "https://data.yesid.dev/v1");
    assert.equal(new Set(f.paths).size, 6);
  });
}

for (const [name, path, change, message] of [
  [
    "wrong build",
    "/_app/version.json",
    (r) => {
      r.body = "{}";
    },
    /Restored build version/,
  ],
  [
    "wrong runtime base",
    "/_app/env.js",
    (r) => {
      r.body = r.body.replace("data.yesid.dev", "wrong.example");
    },
    /Runtime PUBLIC_V1_BASE/,
  ],
  [
    "wrong static policy",
    "/robots.txt",
    (r) => {
      r.body = "User-agent: *\nDisallow: /\n";
    },
    /Target robots policy/,
  ],
  [
    "wrong sitemap",
    "/sitemap.xml",
    (r) => {
      r.body = "<urlset/>";
    },
    /Production sitemap origin/,
  ],
  [
    "wrong canonical",
    "/privacy",
    (r) => {
      r.body = r.body.replace(
        "https://transit.yesid.dev",
        "https://wrong.example",
      );
    },
    /https:\/\/wrong/,
  ],
  [
    "wrong meta",
    "/fr/privacy",
    (r) => {
      r.body = r.body.replace(
        "</head>",
        '<meta name="robots" content="noindex,nofollow"></head>',
      );
    },
    /robots meta/,
  ],
  [
    "wrong header",
    "/privacy",
    (r) => {
      r.headers["x-robots-tag"] = "noindex, nofollow";
    },
    /robots header/,
  ],
  [
    "failed request",
    "/privacy",
    (r) => {
      r.status = 500;
    },
    /privacy status/,
  ],
]) {
  test(`rejects ${name}`, async (t) => {
    const f = await server(t, true, (url, result) => {
      if (url === path) change(result);
    });
    await assert.rejects(verifyHttp(f.base, f.env, version), message);
  });
}

test("refuses to probe a remote origin", async () => {
  await assert.rejects(
    verifyHttp("https://transit.yesid.dev", profile(true), version),
    /local HTTP/,
  );
});
