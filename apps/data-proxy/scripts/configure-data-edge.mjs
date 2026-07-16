import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.cloudflare.com/client/v4";
const CACHE_RULESET_PHASE = "http_request_cache_settings";
const CACHE_RULESET_NAME = "Transit direct R2 JSON cache";
const CACHE_RULESET_DESCRIPTION =
  "Cache public Transit JSON snapshots while respecting publisher Cache-Control";
const PURGE_PREFIX = "data.yesid.dev/v1/";

export const CACHE_RULE_REF = "transit_direct_r2_json";

export const CACHE_RULE = Object.freeze({
  ref: CACHE_RULE_REF,
  description: "Cache public Transit JSON snapshots from the R2 custom domain",
  expression:
    '(http.host eq "data.yesid.dev" and starts_with(http.request.uri.path, "/v1/") and ends_with(http.request.uri.path, ".json"))',
  action: "set_cache_settings",
  action_parameters: Object.freeze({
    cache: true,
    edge_ttl: Object.freeze({ mode: "bypass_by_default" }),
    browser_ttl: Object.freeze({ mode: "respect_origin" }),
  }),
  enabled: true,
});

function errorMessage(payload, status) {
  const messages = [...(payload?.errors ?? []), ...(payload?.messages ?? [])]
    .map((item) => item?.message)
    .filter(Boolean);
  return messages.length > 0 ? messages.join("; ") : `HTTP ${status}`;
}

async function cloudflareRequest({
  apiToken,
  fetch,
  method = "GET",
  path,
  body,
  allow404 = false,
}) {
  const url = `${API_ORIGIN}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok || payload?.success !== true) {
    throw new Error(
      `Cloudflare API ${method} ${url} failed: ${errorMessage(payload, response.status)}`,
    );
  }
  return payload.result;
}

function requireValue(value, name) {
  if (!value?.trim()) throw new Error(`${name} must be set`);
  return value.trim();
}

export async function configureDataEdge({
  apiToken,
  zoneId,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const token = requireValue(apiToken, "CLOUDFLARE_API_TOKEN");
  const zone = requireValue(zoneId, "CLOUDFLARE_ZONE_ID");
  if (typeof fetchImpl !== "function")
    throw new Error("fetch must be available");

  const zonePath = `/zones/${zone}`;
  const entrypoint = await cloudflareRequest({
    apiToken: token,
    fetch: fetchImpl,
    path: `${zonePath}/rulesets/phases/${CACHE_RULESET_PHASE}/entrypoint`,
    allow404: true,
  });

  let rulesetId;
  let ruleAction;
  if (entrypoint === null) {
    const created = await cloudflareRequest({
      apiToken: token,
      fetch: fetchImpl,
      method: "POST",
      path: `${zonePath}/rulesets`,
      body: {
        name: CACHE_RULESET_NAME,
        description: CACHE_RULESET_DESCRIPTION,
        kind: "zone",
        phase: CACHE_RULESET_PHASE,
        rules: [CACHE_RULE],
      },
    });
    rulesetId = created.id;
    ruleAction = "ruleset-created";
  } else {
    rulesetId = entrypoint.id;
    const ownedRule = (entrypoint.rules ?? []).find(
      (rule) =>
        rule.ref === CACHE_RULE_REF ||
        rule.description === CACHE_RULE.description,
    );
    if (ownedRule) {
      await cloudflareRequest({
        apiToken: token,
        fetch: fetchImpl,
        method: "PATCH",
        path: `${zonePath}/rulesets/${rulesetId}/rules/${ownedRule.id}`,
        body: CACHE_RULE,
      });
      ruleAction = "updated";
    } else {
      await cloudflareRequest({
        apiToken: token,
        fetch: fetchImpl,
        method: "POST",
        path: `${zonePath}/rulesets/${rulesetId}/rules`,
        body: CACHE_RULE,
      });
      ruleAction = "created";
    }
  }

  await cloudflareRequest({
    apiToken: token,
    fetch: fetchImpl,
    method: "PATCH",
    path: `${zonePath}/argo/tiered_caching`,
    body: { value: "on" },
  });
  await cloudflareRequest({
    apiToken: token,
    fetch: fetchImpl,
    method: "PATCH",
    path: `${zonePath}/cache/tiered_cache_smart_topology_enable`,
    body: { value: "on" },
  });
  await cloudflareRequest({
    apiToken: token,
    fetch: fetchImpl,
    method: "POST",
    path: `${zonePath}/purge_cache`,
    body: { prefixes: [PURGE_PREFIX] },
  });

  return {
    rulesetId,
    ruleAction,
    tieredCache: "on",
    smartTieredCache: "on",
    purgedPrefix: PURGE_PREFIX,
  };
}

function isCliEntry() {
  return Boolean(
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url,
  );
}

if (isCliEntry()) {
  configureDataEdge({
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    zoneId: process.env.CLOUDFLARE_ZONE_ID,
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
