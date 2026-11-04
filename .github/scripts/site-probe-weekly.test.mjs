import assert from "node:assert/strict";
import test from "node:test";
import {
  sitemapPages,
  linkArguments,
  contactPolicy,
  TEST_LABEL,
  weeklyAllowed,
  probeLinks,
  linkFailures,
} from "./site-probe-weekly.mjs";

test("sitemap discovers new CMS pages, decodes URLs and rejects an incomplete crawl", () => {
  assert.deepEqual(
    sitemapPages(
      "<urlset><url><loc>https://yesid.dev/new?a=1&amp;b=2</loc></url></urlset>",
    ),
    ["https://yesid.dev/new?a=1&b=2"],
  );
  for (const xml of [
    "<urlset/>",
    "<sitemapindex/>",
    "<urlset><loc>https://evil.example/</loc></urlset>",
    "<urlset><loc>http://yesid.dev/</loc></urlset>",
  ]) {
    assert.throws(() => sitemapPages(xml));
  }
  assert.throws(() =>
    sitemapPages(
      `<urlset>${"<loc>https://yesid.dev/</loc>".repeat(201)}</urlset>`,
    ),
  );
});

test("lychee reads live source pages and checks only the opposite product, with low concurrency and no retry", () => {
  const args = linkArguments(["https://yesid.dev/new"], "transit.yesid.dev");
  assert.ok(args.includes("https://yesid.dev/new"));
  assert.ok(args.includes("^https://transit\\.yesid\\.dev(?:/|$)"));
  assert.equal(args[args.indexOf("--max-concurrency") + 1], "2");
  assert.equal(args[args.indexOf("--max-retries") + 1], "0");
  assert.ok(args.includes("--exclude-all-private"));
});

test("analytics and unexpected egress fail closed while static assets and a normal browser submission work", () => {
  for (const url of [
    "https://plausible.io/api/event",
    "https://yesid.dev/api/event",
    "https://yesid.dev/_vercel/insights/script.js",
    "https://yesid.dev/analytics.js",
    "https://other.example/",
  ]) {
    assert.equal(contactPolicy(url, "GET"), "block");
  }
  assert.equal(contactPolicy("https://yesid.dev/contact", "GET"), "read");
  assert.equal(
    contactPolicy("https://yesid.dev/_app/immutable/app.js", "GET"),
    "read",
  );
  assert.equal(
    contactPolicy("https://api.web3forms.com/submit", "POST"),
    "submit",
  );
  assert.equal(
    contactPolicy("https://api.web3forms.com/submit", "GET"),
    "block",
  );
  assert.equal(contactPolicy("https://yesid.dev/contact", "POST"), "block");
  assert.match(TEST_LABEL, /AUTOMATED TEST.*NOT A LEAD/);
});

test("only the weekly schedule or an explicit manual send can send, and reruns never do", () => {
  const schedule = { GITHUB_EVENT_NAME: "schedule", GITHUB_RUN_ATTEMPT: "1" };
  assert.equal(weeklyAllowed(schedule, "37 10 * * 1"), true);
  assert.equal(weeklyAllowed(schedule, "4,19,34,49 * * * *"), false);
  assert.equal(
    weeklyAllowed({ ...schedule, GITHUB_RUN_ATTEMPT: "2" }, "37 10 * * 1"),
    false,
  );
  assert.equal(
    weeklyAllowed({ GITHUB_EVENT_NAME: "pull_request" }, "37 10 * * 1"),
    false,
  );
  assert.equal(
    weeklyAllowed({
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_RUN_ATTEMPT: "1",
      CONTACT_TEST: "true",
    }),
    true,
  );
  assert.equal(
    weeklyAllowed({
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_RUN_ATTEMPT: "1",
    }),
    false,
  );
});

test("link failures report once through the shared dedupe adapter and never include tool output", async () => {
  const alerts = [];
  let calls = 0;
  const result = await probeLinks({
    fetchFn: async () =>
      new Response("<urlset><loc>https://yesid.dev/new</loc></urlset>"),
    run: async () => {
      calls++;
      throw new Error("sensitive tool output");
    },
    alert: (...args) => alerts.push(args),
  });
  assert.equal(result, 1);
  assert.equal(calls, 2);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][1], "cross-site-links");
  assert.doesNotMatch(alerts[0].join(" "), /sensitive/);
});

test("an unreadable sitemap alerts rather than reporting an empty successful crawl", async () => {
  const alerts = [];
  assert.equal(
    await probeLinks({
      fetchFn: async () => new Response(null, { status: 503 }),
      run: async () => assert.fail(),
      alert: (...args) => alerts.push(args),
    }),
    1,
  );
  assert.equal(alerts[0][0], "fire");
});

test("link reports give actionable public source and target URLs without copying tool text or query data", () => {
  assert.deepEqual(
    linkFailures(
      JSON.stringify({
        error_map: {
          "https://yesid.dev/work": [
            {
              url: "https://transit.yesid.dev/removed?private=value",
              status: { text: "sensitive" },
            },
          ],
        },
      }),
    ),
    ["https://yesid.dev/work -> https://transit.yesid.dev/removed"],
  );
  assert.deepEqual(linkFailures("not json"), []);
});
