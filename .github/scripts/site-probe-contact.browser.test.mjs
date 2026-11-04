import assert from "node:assert/strict";
import test from "node:test";
import { probeContact, TEST_LABEL } from "./site-probe-weekly.mjs";
// Real Chromium, entirely synthetic page and provider. No server and no real mail.
for (const accepted of [true, false]) {
  test(`contact ${accepted ? "acceptance" : "rejection"} sends once, labels the subject and blocks analytics`, async () => {
    const { chromium } = await import("@playwright/test");
    const { verifyInstalledBrowserArtifact } =
      await import("../../apps/web/scripts/browser-toolchain.mjs");
    const { paths } = await verifyInstalledBrowserArtifact();
    const browser = await chromium.launch({
      executablePath: paths.executablePath,
    });
    const alerts = [];
    let sends = 0;
    try {
      const result = await probeContact({
        browser,
        alert: (...args) => alerts.push(args),
        prepare: async (context) => {
          await context.route("https://yesid.dev/contact", (route) =>
            route.fulfill({
              contentType: "text/html",
              body: `<form data-testid="contact-form-terminal"><input name="name"><input name="email"><textarea name="message"></textarea><button data-testid="contact-submit">Send</button></form><div data-testid="contact-success" hidden>Sent</div><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const body=Object.fromEntries(f);body.from_name=body.name;body.subject='New contact from '+body.name;body.access_key='dummy';const r=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();fetch('https://plausible.io/api/event',{method:'POST',body:'contact_form_success'}).catch(()=>{});fetch('/_vercel/insights/event',{method:'POST',body:'conversion'}).catch(()=>{});if(j.success)document.querySelector('[data-testid=contact-success]').hidden=false;}</script>`,
            }),
          );
        },
        submit: async (route) => {
          sends++;
          const body = route.request().postDataJSON();
          assert.ok(body.subject.includes(TEST_LABEL));
          assert.ok(body.message.includes("not a lead"));
          await route.fulfill({
            status: accepted ? 200 : 403,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "https://yesid.dev" },
            body: JSON.stringify({ success: accepted }),
          });
        },
      });
      assert.equal(result.code, accepted ? 0 : 1);
      assert.equal(sends, 1);
      assert.equal(result.posts, 1);
      assert.ok(result.blockedAnalytics >= (accepted ? 2 : 0));
      assert.equal(alerts[0][0], accepted ? "resolve" : "fire");
      assert.equal(alerts[0][1], "contact-form");
    } finally {
      await browser.close();
    }
  });
}
