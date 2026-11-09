import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { probeSites, SITE_CHECKS } from "./site-probe.mjs";

const { examples } = JSON.parse(
  await readFile(
    new URL("../../contracts/kpis-v1.examples.json", import.meta.url),
    "utf8",
  ),
);
const kpiCheck = {
  name: "transit-kpis",
  url: "https://transit.yesid.dev/api/v1/kpis",
  kind: "kpis",
};

for (const example of examples) {
  test(`real endpoint probe accepts v1 example and counts hero state: ${example.name}`, async () => {
    const alerts = [];
    const logs = [];
    assert.equal(
      await probeSites({
        checks: [kpiCheck],
        fetchFn: async (url) => {
          assert.equal(url, kpiCheck.url);
          return Response.json(example.body, {
            status: example.status,
            headers: example.headers,
          });
        },
        alert: (...args) => alerts.push(args),
        log: (value) => logs.push(value),
      }),
      0,
    );
    assert.equal(alerts[0][0], "resolve");
    assert.deepEqual(logs, [
      {
        kpis: {
          samples: 1,
          live: example.hero.mode === "live" ? 1 : 0,
          demo: example.hero.mode === "demo" ? 1 : 0,
          invalid: 0,
        },
      },
    ]);
  });
}

for (const field of Object.keys(examples[0].body)) {
  test(`KPI field drift (${field}) retries and reaches existing alert path`, async () => {
    const alerts = [];
    const broken = { ...examples[0].body };
    delete broken[field];
    let calls = 0;
    assert.equal(
      await probeSites({
        checks: [kpiCheck],
        fetchFn: async () => {
          calls++;
          return Response.json(broken);
        },
        pause: async () => {},
        alert: (...args) => alerts.push(args),
        log() {},
      }),
      1,
    );
    assert.equal(calls, 2);
    assert.equal(alerts[0][0], "fire");
    assert.equal(alerts[0][1], "site-availability");
    assert.match(alerts[0][3], /transit-kpis.*invalid KPI v1 response/);
  });
}

test("KPI schema is additive, accepts zero and negative delay, rejects wrong types and bad cold response", async () => {
  for (const [body, status, headers, expected] of [
    [{ ...examples[0].body, futureField: true }, 200, {}, 0],
    [
      { ...examples[0].body, avgDelayS: 0, coverage: 0, routesTotal: 0 },
      200,
      {},
      0,
    ],
    [{ ...examples[0].body, freshnessS: 90 }, 200, {}, 1],
    [{ ...examples[0].body, vehicles: "10" }, 200, {}, 1],
    [
      { ...examples[0].body, topRoutes: [{ route: "10", vehicles: 1 }] },
      200,
      {},
      1,
    ],
    [{ error: "pipeline_cold" }, 503, {}, 1],
    [{ error: "something_else" }, 503, { "retry-after": "30" }, 1],
  ]) {
    assert.equal(
      await probeSites({
        checks: [kpiCheck],
        fetchFn: async () => Response.json(body, { status, headers }),
        pause: async () => {},
        alert() {},
        log() {},
      }),
      expected,
    );
  }
});

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

test("all public targets must pass before resolving the shared outage", async () => {
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
        : url.endsWith("/api/v1/kpis")
          ? Response.json(examples[0].body)
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
    "https://transit.yesid.dev/api/v1/kpis",
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

test("a broken KPI response recovers on retry and invalid JSON is counted without leaking content", async () => {
  const logs = [];
  const alerts = [];
  let calls = 0;
  assert.equal(
    await probeSites({
      checks: [kpiCheck],
      fetchFn: async () =>
        ++calls === 1
          ? new Response("private failure detail")
          : Response.json(examples[0].body),
      pause: async () => {},
      alert: (...args) => alerts.push(args),
      log: (value) => logs.push(value),
    }),
    0,
  );
  assert.deepEqual(logs, [
    { kpis: { samples: 2, live: 1, demo: 0, invalid: 1 } },
  ]);
  assert.equal(alerts[0][0], "resolve");
  assert.doesNotMatch(
    JSON.stringify({ logs, alerts }),
    /private failure detail/,
  );
});
