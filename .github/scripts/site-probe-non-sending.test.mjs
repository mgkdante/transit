import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = readFileSync(
  new URL("../workflows/site-probe.yml", import.meta.url),
  "utf8",
);
const weekly = await import("./site-probe-weekly.mjs");

test("the workflow has only the exercised read-only entrypoints and no contact/browser input", () => {
  const commands = [...workflow.matchAll(/\bnode\s+([^\r\n]+)/g)].map((match) =>
    match[1].trim(),
  );
  assert.deepEqual(commands, [
    ".github/scripts/site-probe.mjs",
    ".github/scripts/site-probe.mjs --weekly",
  ]);
  assert.doesNotMatch(
    workflow,
    /contact_test|CONTACT_TEST|web3forms|chromium|playwright/i,
  );
  const actions = [...workflow.matchAll(/^\s+uses:\s+(\S+)/gm)];
  for (const [, action] of actions) {
    assert.ok(
      new Set(["actions/checkout", "actions/setup-node"]).has(
        action.split("@")[0],
      ),
      `Unreviewed workflow action: ${action}`,
    );
  }
  assert.doesNotMatch(workflow, /\b(?:curl|wget|sendmail|mailx)\b/i);
  assert.equal("probeContact" in weekly, false);
});

// Exercise the real CLI with only fake GET responses and local process adapters.
// A browser import fails before launch; no test can reach a real submit endpoint.
const preload = `
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {register,syncBuiltinESMExports} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,next){if(/playwright|puppeteer|selenium/.test(s))throw new Error('Browser/send path reached');return next(s,c)}"));
const calls={reads:0,lychee:0,alerts:0,blocked:0};
const kpi=JSON.parse(readFileSync(resolve('contracts/kpis-v1.examples.json'),'utf8')).examples[0].body;
const fixtures=new Map([
 ['https://transit.yesid.dev/health',()=>Response.json({status:'ok',data:'readable',service:'transit-web',commit:'1'.repeat(40),branch:'main'})],
 ['https://transit.yesid.dev/',()=>new Response('<html>Transit</html>',{headers:{'content-type':'text/html'}})],
 ['https://yesid.dev/',()=>new Response('<html>Yesid</html>',{headers:{'content-type':'text/html'}})],
 ['https://transit.yesid.dev/api/v1/kpis',()=>Response.json(kpi)],
 ['https://yesid.dev/sitemap.xml',()=>new Response('<urlset><loc>https://yesid.dev/</loc></urlset>')]
]);
globalThis.fetch=async(url,options)=>{
 const fixture=fixtures.get(new URL(url).href);
 if((options?.method??'GET')!=='GET'||!fixture){calls.blocked++;throw new Error('Unexpected network/send path');}
 calls.reads++;return fixture();
};
const fakeExec=()=>{throw new Error('Unexpected callback process')};
fakeExec[promisify.custom]=async(file,args)=>{assert.equal(file,'lychee');assert.ok(args.includes('--max-retries'));calls.lychee++;return {stdout:JSON.stringify({successful:1})}};
cp.execFile=fakeExec;
cp.spawnSync=(file,args)=>{assert.equal(file,'bash');assert.match(args[0],/alert-issue\\.sh$/);assert.ok(['fire','resolve'].includes(args[1]));calls.alerts++;return {status:0}};
syncBuiltinESMExports();
process.on('exit',()=>{if(calls.blocked)process.exitCode=1;console.log(JSON.stringify({probeBoundary:calls}))});
`;

for (const [name, args, environment, expectedStatus, reads, lychee] of [
  [
    "availability schedule",
    [],
    { GITHUB_EVENT_NAME: "schedule", PROBE_SCHEDULE: "4,19,34,49 * * * *" },
    0,
    4,
    0,
  ],
  [
    "weekly schedule",
    ["--weekly"],
    { GITHUB_EVENT_NAME: "schedule", PROBE_SCHEDULE: "37 10 * * 1" },
    0,
    1,
    2,
  ],
  [
    "manual link dispatch",
    ["--weekly"],
    { GITHUB_EVENT_NAME: "workflow_dispatch", LINK_CHECK: "true" },
    0,
    1,
    2,
  ],
  [
    "push/merge entrypoint",
    [],
    { GITHUB_EVENT_NAME: "push", CONTACT_TEST: "true" },
    0,
    4,
    0,
  ],
  [
    "retired contact input",
    ["--weekly"],
    { GITHUB_EVENT_NAME: "workflow_dispatch", CONTACT_TEST: "true" },
    1,
    0,
    0,
  ],
]) {
  test(`${name} cannot launch a browser or send a POST`, () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        ".github/scripts/site-probe.mjs",
        ...args,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          GITHUB_RUN_ATTEMPT: "1",
          ...environment,
        },
      },
    );
    assert.equal(
      result.status,
      expectedStatus,
      result.stderr.replace(/data:text\/javascript,[^\s]+/g, "[test preload]"),
    );
    const line = result.stdout
      .split(/\r?\n/)
      .find((value) => value.startsWith('{"probeBoundary":'));
    assert.ok(line, result.stdout);
    assert.deepEqual(JSON.parse(line).probeBoundary, {
      reads,
      lychee,
      alerts: expectedStatus === 0 ? 1 : 0,
      blocked: 0,
    });
  });
}
