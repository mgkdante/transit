import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CACHE_RULE,
  CACHE_RULE_REF,
  configureDataEdge,
} from "../scripts/configure-data-edge.mjs";

const ZONE_ID = "zone-123";
const API_TOKEN = "test-token";
const API_ROOT = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}`;
const deployWorkflow = readFileSync(
  new URL("../../../.github/workflows/deploy-data-proxy.yml", import.meta.url),
  "utf8",
);
const edgeWorkflow = readFileSync(
  new URL(
    "../../../.github/workflows/configure-data-edge.yml",
    import.meta.url,
  ),
  "utf8",
);
const smokeScript = readFileSync(
  new URL("../smoke.sh", import.meta.url),
  "utf8",
);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successful(result = {}) {
  return jsonResponse({ success: true, errors: [], messages: [], result });
}

function requestBody(call) {
  return JSON.parse(call.init.body);
}

test("unchanged managed policy and enabled topology preserve the warm cache", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init: { method: "GET", ...init } });
    if (String(url).includes("/rulesets/phases/")) {
      return successful({
        id: "ruleset-1",
        rules: [{ ...CACHE_RULE, id: "owned-rule", version: "7" }],
      });
    }
    return successful({ value: "on", editable: true });
  };
  const result = await configureDataEdge({
    apiToken: API_TOKEN,
    zoneId: ZONE_ID,
    fetch,
  });
  assert.equal(result.ruleAction, "unchanged");
  assert.equal(result.purgedPrefix, null);
  assert.deepEqual(
    calls.map(({ url, init }) => [url, init.method]),
    [
      [
        `${API_ROOT}/rulesets/phases/http_request_cache_settings/entrypoint`,
        "GET",
      ],
      [`${API_ROOT}/argo/tiered_caching`, "GET"],
      [`${API_ROOT}/cache/tiered_cache_smart_topology_enable`, "GET"],
    ],
  );
});

test("creates the scoped JSON cache rule and enables both tiered-cache settings", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init: { method: "GET", ...init } };
    calls.push(call);
    if (
      call.url.endsWith(
        "/rulesets/phases/http_request_cache_settings/entrypoint",
      )
    ) {
      return successful({
        id: "ruleset-1",
        rules: [{ id: "keep-me", ref: "another-rule" }],
      });
    }
    if (call.url.endsWith("/rulesets/ruleset-1/rules")) {
      return successful({ id: "created-rule" });
    }
    if (call.init.method === "GET") return successful({ value: "off" });
    return successful();
  };

  const result = await configureDataEdge({
    apiToken: API_TOKEN,
    zoneId: ZONE_ID,
    fetch,
  });

  assert.equal(result.ruleAction, "created");
  assert.deepEqual(
    calls.map(({ url, init }) => [url, init.method]),
    [
      [
        `${API_ROOT}/rulesets/phases/http_request_cache_settings/entrypoint`,
        "GET",
      ],
      [`${API_ROOT}/argo/tiered_caching`, "GET"],
      [`${API_ROOT}/cache/tiered_cache_smart_topology_enable`, "GET"],
      [`${API_ROOT}/rulesets/ruleset-1/rules`, "POST"],
      [`${API_ROOT}/argo/tiered_caching`, "PATCH"],
      [`${API_ROOT}/cache/tiered_cache_smart_topology_enable`, "PATCH"],
      [`${API_ROOT}/purge_cache`, "POST"],
    ],
  );
  assert.deepEqual(requestBody(calls[3]), CACHE_RULE);
  assert.deepEqual(requestBody(calls[4]), { value: "on" });
  assert.deepEqual(requestBody(calls[5]), { value: "on" });
  assert.deepEqual(requestBody(calls[6]), { prefixes: ["data.yesid.dev"] });
  assert.deepEqual(CACHE_RULE.action_parameters, {
    cache: true,
    edge_ttl: { mode: "bypass_by_default" },
    browser_ttl: { mode: "respect_origin" },
  });
  assert.equal(CACHE_RULE.ref, CACHE_RULE_REF);
});

test("updates the owned rule in place without disturbing sibling cache rules", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init: { method: "GET", ...init } };
    calls.push(call);
    if (
      call.url.endsWith(
        "/rulesets/phases/http_request_cache_settings/entrypoint",
      )
    ) {
      return successful({
        id: "ruleset-1",
        rules: [
          { id: "keep-me", ref: "another-rule" },
          { id: "owned-rule", ref: CACHE_RULE_REF },
        ],
      });
    }
    if (call.init.method === "GET") return successful({ value: "on" });
    return successful();
  };

  const result = await configureDataEdge({
    apiToken: API_TOKEN,
    zoneId: ZONE_ID,
    fetch,
  });

  assert.equal(result.ruleAction, "updated");
  const ruleWrites = calls.filter(({ url }) =>
    url.includes("/rulesets/ruleset-1/rules"),
  );
  assert.equal(ruleWrites.length, 1);
  assert.equal(ruleWrites[0].init.method, "PATCH");
  assert.equal(
    ruleWrites[0].url,
    `${API_ROOT}/rulesets/ruleset-1/rules/owned-rule`,
  );
  assert.deepEqual(requestBody(ruleWrites[0]), CACHE_RULE);
  assert.equal(calls.filter(({ init }) => init.method !== "GET").length, 2);
  assert.deepEqual(requestBody(calls.at(-1)), { prefixes: ["data.yesid.dev"] });
});

test("creates the phase ruleset when the zone has no cache-settings entrypoint", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init: { method: "GET", ...init } };
    calls.push(call);
    if (
      call.url.endsWith(
        "/rulesets/phases/http_request_cache_settings/entrypoint",
      )
    ) {
      return jsonResponse(
        { success: false, errors: [{ code: 10003, message: "not found" }] },
        404,
      );
    }
    if (call.url.endsWith("/rulesets") && call.init.method === "POST") {
      return successful({
        id: "new-ruleset",
        rules: [{ id: "new-rule", ref: CACHE_RULE_REF }],
      });
    }
    if (call.init.method === "GET") return successful({ value: "on" });
    return successful();
  };

  const result = await configureDataEdge({
    apiToken: API_TOKEN,
    zoneId: ZONE_ID,
    fetch,
  });

  assert.equal(result.ruleAction, "ruleset-created");
  const create = calls.find(
    ({ url, init }) => url === `${API_ROOT}/rulesets` && init.method === "POST",
  );
  assert.ok(create);
  assert.deepEqual(requestBody(create), {
    name: "Transit direct R2 JSON cache",
    description:
      "Cache public Transit JSON snapshots while respecting publisher Cache-Control",
    kind: "zone",
    phase: "http_request_cache_settings",
    rules: [CACHE_RULE],
  });
});

test("fails closed when Cloudflare rejects a mutation", async () => {
  const fetch = async (url, init = {}) => {
    if (
      String(url).endsWith(
        "/rulesets/phases/http_request_cache_settings/entrypoint",
      )
    ) {
      return successful({ id: "ruleset-1", rules: [] });
    }
    if (init.method === "GET") return successful({ value: "on" });
    return jsonResponse(
      {
        success: false,
        errors: [{ code: 10000, message: "permission denied" }],
      },
      403,
    );
  };

  await assert.rejects(
    configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch }),
    /Cloudflare API POST .*permission denied/,
  );
});

for (const disabled of [
  "argo/tiered_caching",
  "cache/tiered_cache_smart_topology_enable",
]) {
  test(`enables only disabled ${disabled} without evicting unchanged snapshots`, async () => {
    const calls = [];
    const fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init: { method: "GET", ...init } });
      if (String(url).includes("/rulesets/phases/")) {
        return successful({
          id: "ruleset-1",
          rules: [{ ...CACHE_RULE, id: "owned-rule" }],
        });
      }
      return successful({
        value: String(url).endsWith(disabled) ? "off" : "on",
      });
    };
    const result = await configureDataEdge({
      apiToken: API_TOKEN,
      zoneId: ZONE_ID,
      fetch,
    });
    const writes = calls.filter(({ init }) => init.method !== "GET");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, `${API_ROOT}/${disabled}`);
    assert.equal(writes[0].init.method, "PATCH");
    assert.deepEqual(requestBody(writes[0]), { value: "on" });
    assert.equal(result.purgedPrefix, null);
  });
}

test("managed policy comparison ignores object key order and API metadata", async () => {
  const writes = [];
  const fetch = async (url, init = {}) => {
    if (init.method !== "GET") writes.push(String(url));
    if (String(url).includes("/rulesets/phases/")) {
      return successful({
        id: "ruleset-1",
        rules: [
          {
            ...CACHE_RULE,
            id: "owned-rule",
            version: "4",
            description: "Operator annotation",
            action_parameters: {
              browser_ttl: { mode: "respect_origin" },
              edge_ttl: { mode: "bypass_by_default" },
              cache: true,
            },
          },
        ],
      });
    }
    return successful({ value: "on" });
  };
  await configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch });
  assert.deepEqual(writes, []);
});

for (const change of [
  { enabled: false },
  { expression: '(http.host eq "data.yesid.dev")' },
  {
    action_parameters: {
      ...CACHE_RULE.action_parameters,
      edge_ttl: { mode: "override", default: 3600 },
    },
  },
]) {
  test(`repairs changed cache policy ${JSON.stringify(change)} and purges once`, async () => {
    const writes = [];
    const fetch = async (url, init = {}) => {
      if (init.method !== "GET") writes.push({ url: String(url), init });
      return String(url).includes("/rulesets/phases/")
        ? successful({
            id: "ruleset-1",
            rules: [{ ...CACHE_RULE, ...change, id: "owned-rule" }],
          })
        : successful({ value: "on" });
    };
    await configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch });
    assert.deepEqual(
      writes.map(({ url, init }) => [url, init.method]),
      [
        [`${API_ROOT}/rulesets/ruleset-1/rules/owned-rule`, "PATCH"],
        [`${API_ROOT}/purge_cache`, "POST"],
      ],
    );
    assert.deepEqual(requestBody(writes[0]), CACHE_RULE);
    assert.deepEqual(requestBody(writes[1]), { prefixes: ["data.yesid.dev"] });
  });
}

test("ambiguous owned rules fail without overwriting either rule", async () => {
  const writes = [];
  const fetch = async (url, init = {}) => {
    if (init.method !== "GET") writes.push(String(url));
    return String(url).includes("/rulesets/phases/")
      ? successful({
          id: "ruleset-1",
          rules: [
            { ...CACHE_RULE, id: "owned-one" },
            { ...CACHE_RULE, id: "owned-two" },
          ],
        })
      : successful({ value: "on" });
  };
  await assert.rejects(
    configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch }),
    /ownership is ambiguous/,
  );
  assert.deepEqual(writes, []);
});

for (const result of [null, {}, { value: "unknown" }]) {
  test(`malformed setting ${JSON.stringify(result)} fails before any mutation`, async () => {
    const writes = [];
    const fetch = async (url, init = {}) => {
      if (init.method !== "GET") writes.push(String(url));
      return String(url).includes("/rulesets/phases/")
        ? successful({ id: "ruleset-1", rules: [] })
        : successful(result);
    };
    await assert.rejects(
      configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch }),
      /invalid cache setting/,
    );
    assert.deepEqual(writes, []);
  });
}

test("failed settings read prevents bootstrap mutations", async () => {
  const writes = [];
  const fetch = async (url, init = {}) => {
    if (init.method !== "GET") writes.push(String(url));
    return String(url).includes("/rulesets/phases/")
      ? successful({ id: "ruleset-1", rules: [] })
      : jsonResponse(
          { success: false, errors: [{ message: "permission denied" }] },
          403,
        );
  };
  await assert.rejects(
    configureDataEdge({ apiToken: API_TOKEN, zoneId: ZONE_ID, fetch }),
    /Cloudflare API GET .*permission denied/,
  );
  assert.deepEqual(writes, []);
});

test("production deploys and the manual edge lane use the same owned configuration", () => {
  assert.doesNotMatch(deployWorkflow, /^\s*workflow_dispatch:/m);
  assert.match(
    deployWorkflow,
    /r2 bucket cors set transit-snapshots --file r2-cors\.json --force/,
  );
  assert.match(deployWorkflow, /node scripts\/configure-data-edge\.mjs/);
  assert.match(
    deployWorkflow,
    /CLOUDFLARE_ZONE_ID: 8a4ad7999bd6c2259b5b4acd52f39015/,
  );
  assert.match(edgeWorkflow, /^\s*workflow_dispatch:/m);
  assert.match(
    edgeWorkflow,
    /r2 bucket cors set transit-snapshots --file r2-cors\.json --force/,
  );
  assert.match(edgeWorkflow, /node scripts\/configure-data-edge\.mjs/);
  assert.match(edgeWorkflow, /bash smoke\.sh/);
  assert.match(
    deployWorkflow,
    /deploy-data-proxy:[\s\S]*?concurrency:[\s\S]*?group: transit-data-edge-production/,
  );
  assert.match(
    edgeWorkflow,
    /concurrency:[\s\S]*?group: transit-data-edge-production/,
  );
});

test("the production smoke pins browser freshness and rejects edge-cached 404s", () => {
  assert.match(
    smokeScript,
    /assert_edge_hit "\$CANONICAL_BASE\/v1\/stm\/manifest\.json" "public, max-age=30"/,
  );
  assert.match(smokeScript, /expected_cache_control/);
  assert.match(smokeScript, /cache-control.*expected_cache_control/i);
  assert.match(smokeScript, /assert_missing_edge_bypass/);
  assert.match(
    smokeScript,
    /CF-Cache-Status: HIT on a missing direct-R2 object/,
  );
  assert.match(smokeScript, /Age on a missing direct-R2 object/);
  assert.match(smokeScript, /EDGE_MAX_ATTEMPTS/);
  assert.match(smokeScript, /EDGE_RETRY_DELAY_S/);
  assert.match(
    smokeScript,
    /get_headers_of "\$url" -H "Origin: \$BROWSER_ORIGIN"/,
  );
  assert.match(smokeScript, /Access-Control-Request-Headers: range/i);
});
