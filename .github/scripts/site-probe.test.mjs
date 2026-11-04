import assert from "node:assert/strict";
import test from "node:test";
import { probeSites, SITE_CHECKS } from "./site-probe.mjs";

test("a repeated site failure opens the existing alert channel and exits failing", async () => {
  const alerts = [];
  let calls = 0;
  const result = await probeSites({
    checks: [SITE_CHECKS[0]],
    fetchFn: async () => {
      calls++;
      return new Response("down", { status: 503 });
    },
    pause: async () => {},
    alert: (...args) => alerts.push(args),
  });
  assert.equal(result, 1);
  assert.equal(calls, 2);
  assert.equal(alerts[0][0], "fire");
  assert.equal(alerts[0][1], "site-availability");
  assert.match(alerts[0][3], /transit-health.*HTTP 503/);
});

const healthy = () =>
  Response.json({
    status: "ok",
    data: "readable",
    service: "transit-web",
    commit: "b5b283781a6fe6ab12c424dd685bbb854d515962",
    branch: "main",
  });

test("a single transient failure retries once and resolves the outage when recovered", async () => {
  const alerts = [];
  let calls = 0;
  const result = await probeSites({
    checks: [SITE_CHECKS[0]],
    fetchFn: async () =>
      ++calls === 1 ? new Response(null, { status: 502 }) : healthy(),
    pause: async (ms) => assert.equal(ms, 5000),
    alert: (...args) => alerts.push(args),
  });
  assert.equal(result, 0);
  assert.equal(calls, 2);
  assert.equal(alerts[0][0], "resolve");
});

test("all three public targets must pass before resolving the shared outage", async () => {
  const visited = [];
  const alerts = [];
  const result = await probeSites({
    fetchFn: async (url, init) => {
      visited.push(url);
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers["cache-control"], "no-cache");
      assert.ok(init.signal instanceof AbortSignal);
      return url.endsWith("/health")
        ? healthy()
        : new Response("<html><title>Transit | Yesid</title></html>", {
            headers: { "content-type": "text/html" },
          });
    },
    alert: (...args) => alerts.push(args),
  });
  assert.equal(result, 0);
  assert.deepEqual(visited, [
    "https://transit.yesid.dev/health",
    "https://transit.yesid.dev/",
    "https://yesid.dev/",
  ]);
  assert.equal(alerts[0][0], "resolve");
});

for (const [name, response] of [
  ["dishonest health", () => Response.json({ status: "ok" })],
  ["bad JSON", () => new Response("oops")],
  [
    "redirect",
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://example.org" },
      }),
  ],
  [
    "timeout",
    () => {
      throw new DOMException("sensitive detail", "TimeoutError");
    },
  ],
]) {
  test(`${name} alerts without leaking response or exception details`, async () => {
    const alerts = [];
    assert.equal(
      await probeSites({
        checks: [SITE_CHECKS[0]],
        fetchFn: response,
        pause: async () => {},
        alert: (...args) => alerts.push(args),
      }),
      1,
    );
    assert.equal(alerts[0][0], "fire");
    assert.doesNotMatch(alerts[0][3], /sensitive detail|oops|example.org/);
  });
}

test("a 200 error document cannot resolve a home-page outage", async () => {
  const alerts = [];
  assert.equal(
    await probeSites({
      checks: [SITE_CHECKS[1]],
      fetchFn: async () =>
        new Response("<html>Unavailable</html>", {
          headers: { "content-type": "text/html" },
        }),
      pause: async () => {},
      alert: (...args) => alerts.push(args),
    }),
    1,
  );
  assert.match(alerts[0][3], /missing page content/);
});

test("failure to deliver the alert is a failing probe, never a green result", async () => {
  await assert.rejects(
    probeSites({
      checks: [SITE_CHECKS[0]],
      fetchFn: async () => healthy(),
      alert: () => {
        throw new Error("issue delivery failed");
      },
    }),
    /issue delivery failed/,
  );
});
