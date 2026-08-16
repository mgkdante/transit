import assert from "node:assert/strict";
import test from "node:test";

import { assertPortsAvailable } from "../lib/process.mjs";

function fakeServer({ error = null } = {}) {
  let onError;
  return {
    once(event, handler) {
      if (event === "error") onError = handler;
    },
    listen(_port, _host, onListen) {
      if (error) onError(error);
      else onListen();
    },
    close(done) {
      done();
    },
  };
}

test("rejects a requested preview port when the real listen boundary reports address in use", async () => {
  await assert.rejects(
    assertPortsAvailable([4217], {
      createServerFn: () => fakeServer({ error: { code: "EADDRINUSE" } }),
    }),
    /E6_PORT_IN_USE port=4217/u,
  );
});

test("accepts every explicit port only after each injected listen boundary closes", async () => {
  let created = 0;
  await assert.doesNotReject(
    assertPortsAvailable([4217, 4218], {
      createServerFn: () => {
        created += 1;
        return fakeServer();
      },
    }),
  );
  assert.equal(created, 2);
});
