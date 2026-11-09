import assert from "node:assert/strict";
import test from "node:test";
import {
  sitemapPages,
  linkArguments,
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
  assert.deepEqual(args.slice(-1), ["https://yesid.dev/new"]);
  assert.ok(args.includes("^https://transit\\.yesid\\.dev(?:/|$)"));
  assert.equal(args[args.indexOf("--max-concurrency") + 1], "2");
  assert.equal(args[args.indexOf("--max-retries") + 1], "0");
  assert.ok(args.includes("--exclude-all-private"));
});

test("probe host boundaries reject lookalike hosts, userinfo and URLs embedded in paths or queries", () => {
  for (const host of ["yesid.dev", "transit.yesid.dev"]) {
    const args = linkArguments([], host);
    const include = new RegExp(args[args.indexOf("--include") + 1]);
    assert.equal(include.test(`https://${host}/new`), true);
    for (const deceptive of [
      `https://${host}.evil.example/new`,
      `https://${host}@evil.example/new`,
      `https://evil.example/https://${host}/new`,
      `https://evil.example/?next=https://${host}/new`,
    ]) {
      assert.equal(include.test(deceptive), false);
      assert.throws(() =>
        sitemapPages(`<urlset><loc>${deceptive}</loc></urlset>`),
      );
    }
  }
});

test("only the weekly schedule or explicit manual link check can run, and reruns never do", () => {
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
      LINK_CHECK: "true",
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

test("a missing lychee executable explains ENOENT in both the log and issue without tool output", async () => {
  const alerts = [],
    logs = [];
  await probeLinks({
    fetchFn: async () =>
      new Response("<urlset><loc>https://yesid.dev/</loc></urlset>"),
    run: async () => {
      throw Object.assign(new Error("private command text"), {
        code: "ENOENT",
        stderr: "private page body",
      });
    },
    alert: (...args) => alerts.push(args),
    log: (entry) => logs.push(entry),
  });
  assert.match(alerts[0].at(-1), /ENOENT/);
  assert.match(JSON.stringify(logs), /ENOENT/);
  assert.doesNotMatch(JSON.stringify({ alerts, logs }), /private/);
});

test("lychee argument errors retain the exit code and option, never raw stderr or page content", async () => {
  const alerts = [],
    logs = [];
  await probeLinks({
    fetchFn: async () =>
      new Response("<urlset><loc>https://yesid.dev/</loc></urlset>"),
    run: async () => {
      throw Object.assign(new Error("private command"), {
        code: 2,
        stderr:
          "error: unexpected argument '--bad-option' found\nprivate page body",
      });
    },
    alert: (...args) => alerts.push(args),
    log: (entry) => logs.push(entry),
  });
  assert.match(alerts[0].at(-1), /exit 2.*unexpected argument --bad-option/);
  assert.match(
    JSON.stringify(logs),
    /exit 2.*unexpected argument --bad-option/,
  );
  assert.doesNotMatch(JSON.stringify({ alerts, logs }), /private/);
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
