import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { chromium } from "@playwright/test";
import { verifyInstalledBrowserArtifact } from "../../apps/web/scripts/browser-toolchain.mjs";
import {
  contactPolicy,
  probeContact,
  TEST_LABEL,
} from "./site-probe-weekly.mjs";

const SUBMIT = "https://api.web3forms.com/submit";
let browser;
before(async () => {
  const { paths } = await verifyInstalledBrowserArtifact();
  browser = await chromium.launch({ executablePath: paths.executablePath });
});
after(async () => browser?.close());

function fixture({ missing = false, disabled = false, notice = true } = {}) {
  return `<form data-testid="contact-form-terminal">
    ${missing ? "" : '<input name="name">'}<input name="email"><textarea name="message"></textarea>
    <button data-testid="contact-submit" ${disabled ? "disabled" : ""}>Send</button></form>
    <div data-testid="contact-success" hidden>Sent</div>
    <script>document.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const body=Object.fromEntries(new FormData(e.target));
      body.from_name=body.name;body.subject='New contact from '+body.name;body.access_key='fixture-key-never-log';
      try {const r=await fetch('${SUBMIT}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const j=await r.json();
        await Promise.allSettled([fetch('https://plausible.io/api/event',{method:'POST',body:'contact_form_success'}),fetch('/_vercel/insights/event',{method:'POST',body:'conversion'})]);
        if(j.success&&${notice})document.querySelector('[data-testid=contact-success]').hidden=false;
      } catch { /* synthetic failure, no retry */ }
    }</script>`;
}

async function runFixture({
  status = 200,
  payload = { success: true, message: "Accepted" },
  html,
  submit,
  prepare,
} = {}) {
  const alerts = [],
    logs = [];
  let sends = 0;
  const result = await probeContact({
    browser,
    timeoutMs: 5_000,
    alert: (...args) => alerts.push(args),
    log: (entry) => logs.push(entry),
    prepare: async (context) => {
      await context.route("https://yesid.dev/contact", (route) =>
        route.fulfill({ contentType: "text/html", body: html ?? fixture() }),
      );
      await prepare?.(context);
    },
    submit: async (route) => {
      sends++;
      const body = route.request().postDataJSON();
      assert.ok(body.subject.includes(TEST_LABEL));
      assert.ok(body.message.includes("not a lead"));
      if (submit) return submit(route, body);
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "https://yesid.dev" },
        body: JSON.stringify(payload),
      });
    },
  });
  assert.equal(sends, result.posts);
  assert.ok(sends <= 1);
  assert.deepEqual(logs.at(-1), { contactProbe: result });
  assert.ok(alerts[0].at(-1).includes(JSON.stringify(result)));
  return { result, alerts, logs };
}

test("acceptance records safe provider fields, labels the only POST and blocks analytics", async () => {
  const { result, alerts } = await runFixture();
  assert.equal(result.code, 0);
  assert.equal(result.posts, 1);
  assert.equal(result.providerStatus, 200);
  assert.equal(result.diagnostics.responseObserved, true);
  assert.equal(result.diagnostics.providerSuccess, true);
  assert.equal(result.diagnostics.providerMessage, "Accepted");
  assert.ok(result.blockedAnalytics >= 2);
  assert.equal(alerts[0][0], "resolve");
});

test("provider rejection records status, success and message without echoing request fields", async () => {
  const { result, alerts, logs } = await runFixture({
    submit: async (route, body) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "https://yesid.dev" },
        body: JSON.stringify({
          success: false,
          message: `Denied: ${JSON.stringify(body)}`,
          access_key: body.access_key,
          request: body,
        }),
      }),
  });
  assert.equal(result.code, 1);
  assert.equal(result.providerStatus, 403);
  assert.equal(result.diagnostics.stage, "reading-json");
  assert.equal(result.diagnostics.category, "provider-rejected");
  assert.equal(result.diagnostics.errorName, "Error");
  assert.equal(result.diagnostics.providerSuccess, false);
  assert.match(result.diagnostics.providerMessage, /Denied/);
  assert.doesNotMatch(
    JSON.stringify({ result, alerts, logs }),
    /fixture-key-never-log|Weekly contact delivery check|admin@yesid\.dev/,
  );
});

for (const [stage, options] of [
  [
    "navigation",
    {
      prepare: (context) =>
        context.route("https://yesid.dev/contact", (route) =>
          route.abort("connectionrefused"),
        ),
    },
  ],
  ["fill", { html: fixture({ missing: true }) }],
  ["click", { html: fixture({ disabled: true }) }],
  ["success-notice", { html: fixture({ notice: false }) }],
]) {
  test(`${stage} failure identifies its stage and error name`, async () => {
    const { result } = await runFixture(options);
    assert.equal(result.code, 1);
    assert.equal(result.diagnostics.stage, stage);
    assert.match(result.diagnostics.errorName, /Error$/);
  });
}

test("invalid provider JSON records the response status and SyntaxError without its body", async () => {
  const { result, alerts, logs } = await runFixture({
    submit: (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: "private response body",
      }),
  });
  assert.equal(result.diagnostics.stage, "reading-json");
  assert.equal(result.diagnostics.category, "invalid-json");
  assert.equal(result.diagnostics.errorName, "SyntaxError");
  assert.equal(result.providerStatus, 502);
  assert.doesNotMatch(
    JSON.stringify({ result, alerts, logs }),
    /private response body/,
  );
});

test("requestfailed captures submit failure text, distinct from a response hang", async () => {
  const { result, logs } = await runFixture({
    submit: (route) => route.abort("connectionrefused"),
  });
  assert.equal(result.diagnostics.stage, "waiting-for-response");
  assert.equal(result.diagnostics.category, "request-failed");
  assert.equal(
    result.diagnostics.requestFailureText,
    "net::ERR_CONNECTION_REFUSED",
  );
  assert.equal(result.diagnostics.responseObserved, false);
  assert.equal(result.providerStatus, null);
  assert.ok(
    logs.some(
      (entry) =>
        entry.contactRequestFailed?.errorText === "net::ERR_CONNECTION_REFUSED",
    ),
  );
});

test("a stalled submit times out without counting cleanup cancellation as a transport failure", async () => {
  const { result } = await runFixture({ submit: async () => {} });
  assert.equal(result.diagnostics.stage, "waiting-for-response");
  assert.equal(result.diagnostics.category, "timeout");
  assert.equal(result.diagnostics.errorName, "TimeoutError");
  assert.equal(result.diagnostics.requestFailureText, null);
  assert.equal(result.diagnostics.responseObserved, false);
});

// Real loopback origins on their own ephemeral ports. No external POST or server reuse.
for (const [routing, cors] of [
  [false, true],
  [true, true],
  [true, false],
]) {
  test(`Chromium CORS preflight and JSON POST: routing=${routing}, CORS headers=${cors}`, async () => {
    const wire = [],
      intercepted = [],
      failures = [],
      responses = [];
    let pageOrigin;
    const api = createServer((req, res) => {
      wire.push(req.method);
      if (cors) res.setHeader("access-control-allow-origin", pageOrigin);
      res.setHeader("access-control-allow-methods", "POST");
      res.setHeader("access-control-allow-headers", "content-type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ success: true }));
    });
    const site = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<html>Local contact fixture</html>");
    });
    api.listen(0, "127.0.0.1");
    site.listen(0, "127.0.0.1");
    await Promise.all([once(api, "listening"), once(site, "listening")]);
    pageOrigin = `http://127.0.0.1:${site.address().port}`;
    const submitUrl = `http://127.0.0.1:${api.address().port}/submit`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      context.on("requestfailed", (request) =>
        failures.push({
          method: request.method(),
          url: request.url(),
          failure: request.failure()?.errorText,
        }),
      );
      context.on("response", (response) => {
        if (response.url() === submitUrl)
          responses.push({
            status: response.status(),
            method: response.request().method(),
          });
      });
      if (routing)
        await context.route("**/*", (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const mapped =
            url.origin === pageOrigin
              ? `https://yesid.dev${url.pathname}`
              : request.url() === submitUrl
                ? SUBMIT
                : request.url();
          const policy = contactPolicy(mapped, request.method());
          intercepted.push({ method: request.method(), policy });
          return policy === "submit"
            ? route.continue()
            : policy === "read"
              ? route.fallback()
              : route.abort();
        });
      const page = await context.newPage();
      await page.goto(`${pageOrigin}/contact`);
      const outcome = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "LOCAL SYNTHETIC ONLY" }),
          });
          return { status: r.status, success: (await r.json()).success };
        } catch (error) {
          return { error: error.name };
        }
      }, submitUrl);
      console.log(
        JSON.stringify({
          localCors: {
            routing,
            cors,
            wire,
            intercepted,
            failures,
            responses,
            outcome,
          },
        }),
      );
      assert.deepEqual(
        outcome,
        cors ? { status: 200, success: true } : { error: "TypeError" },
      );
      // With routing enabled, pinned Chromium sends the continued POST directly:
      // the preflight is neither exposed to this route handler nor sent on the wire.
      assert.deepEqual(wire, routing ? ["POST"] : ["OPTIONS", "POST"]);
      if (cors) {
        assert.deepEqual(failures, []);
        assert.deepEqual(responses, [{ status: 200, method: "POST" }]);
      } else {
        assert.deepEqual(responses, []);
        assert.deepEqual(failures, [
          { method: "POST", url: submitUrl, failure: "net::ERR_FAILED" },
        ]);
      }
      if (routing) {
        assert.equal(contactPolicy(SUBMIT, "OPTIONS"), "block");
        assert.equal(
          intercepted.some((entry) => entry.method === "OPTIONS"),
          false,
        );
        assert.deepEqual(
          intercepted.filter((entry) => entry.policy === "submit"),
          [{ method: "POST", policy: "submit" }],
        );
      }
    } finally {
      await context.close();
      api.closeAllConnections();
      site.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => api.close(resolve)),
        new Promise((resolve) => site.close(resolve)),
      ]);
    }
  });
}
