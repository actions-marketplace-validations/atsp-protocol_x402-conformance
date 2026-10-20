import assert from "node:assert/strict";
import { test } from "node:test";
import { startDouble } from "../src/double.js";
import { probe } from "../src/probe.js";
import { startExample } from "../example/server.js";

async function run(fault = "") {
  const double = await startDouble(0, 10_000);
  const ex = await startExample(double.url, fault);
  try {
    const results = await probe(ex.url, double);
    return { results, failed: results.filter((r) => !r.pass).map((r) => r.check.split(" ")[0]) };
  } finally {
    await ex.close();
    await double.close();
  }
}

test("the example server on @x402/core + @x402/svm passes R0-R9", async () => {
  const { results, failed } = await run();
  assert.deepEqual(failed, [], JSON.stringify(results, null, 1));
  assert.equal(results.length, 10);
});

test("a server that serves after /verify and ignores /settle is caught", async () => {
  const { failed } = await run("serve_after_verify");
  for (const c of ["R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]) assert.ok(failed.includes(c), `${c} not caught: ${failed}`);
});

test("a server that serves whatever /settle answers is caught", async () => {
  const { failed } = await run("serve_on_any_settle");
  for (const c of ["R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"]) assert.ok(failed.includes(c), `${c} not caught: ${failed}`);
});

test("the double advertises Solana devnet only", async () => {
  const double = await startDouble(0, 50);
  try {
    const sup = await (await fetch(double.url + "/supported")).json();
    assert.equal(sup.kinds[0].network, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  } finally {
    await double.close();
  }
});
