// R20, retry double-pay: the client times out before /settle answers and retries. Real @x402/express servers behind
// the facilitator double on loopback, on Solana devnet and Base Sepolia. The control passes; each faulty build is
// caught by the check it breaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startDouble } from "../src/double.js";
import { checkClientRetry, probeRetry } from "../src/retry.js";
import { BASE_SEPOLIA, DEVNET, startRetryServer, type RetryFault } from "../example/retry-server.js";
import { retryingClient, type ClientFault } from "../example/retry-clients.js";
import type { Result } from "../src/probe.js";

const NETS = [["Solana devnet", DEVNET], ["Base Sepolia", BASE_SEPOLIA]] as const;
const find = (rs: Result[], id: string) => {
  const r = rs.find((x) => x.check.split(" ")[0] === id);
  assert.ok(r, `${id} missing from ${JSON.stringify(rs.map((x) => x.check))}`);
  return r;
};

async function server(fault: RetryFault, network: string) {
  const double = await startDouble(0);
  const s = await startRetryServer(double.url, fault, network);
  return { double, s, close: async () => { await s.close(); await double.close(); } };
}

async function run(fault: RetryFault, network: string) {
  const h = await server(fault, network);
  try { return { results: await probeRetry(h.s.url, h.double, { network }), double: h.double }; } finally { await h.close(); }
}

async function client(fault: ClientFault, network: string) {
  const h = await server("", network);
  try { return await checkClientRetry(retryingClient(network, fault), h.s.url, h.double); } finally { await h.close(); }
}

for (const [name, net] of NETS) {
  test(`R20 control: a URL that is not a paid route fails the control and grades nothing, ${name}`, async () => {
    const h = await server("", net);
    try {
      const rs = await probeRetry(`${h.s.base}/free`, h.double, { network: net });
      assert.equal(rs.length, 1, JSON.stringify(rs));
      assert.equal(find(rs, "R20").pass, false);
      assert.equal(h.double.calls.filter((c) => c.path === "/settle").length, 0);
    } finally { await h.close(); }
  });
  test(`R20a control: the stock @x402/express server with an idempotency record charges a fresh-payment retry once, ${name}`,
    async () => {
      const { results } = await run("", net);
      assert.equal(find(results, "R20").pass, true, JSON.stringify(results));
      const a = find(results, "R20a");
      assert.equal(a.pass, true, JSON.stringify(a));
      assert.equal((a.detail as any).successful_settles, 1, JSON.stringify(a.detail));
      assert.equal((a.detail as any).first.timed_out, true, JSON.stringify(a.detail));
      assert.ok((a.detail as any).retry.settlement_ref, "the retry carries the original settlement");
    });
  test(`R20a settle_both: a server with no idempotency record settles the fresh-payment retry and is caught, ${name}`,
    async () => {
      const { results } = await run("settle_both", net);
      const a = find(results, "R20a");
      assert.equal(a.pass, false, JSON.stringify(a));
      assert.equal((a.detail as any).successful_settles, 2, JSON.stringify(a.detail));
    });
  test(`R20a key_by_payment: a record keyed by the payment instead of the request is caught, ${name}`, async () => {
    const { results } = await run("key_by_payment", net);
    const a = find(results, "R20a");
    assert.equal(a.pass, false, JSON.stringify(a));
    assert.equal((a.detail as any).successful_settles, 2, JSON.stringify(a.detail));
    // keyed by payment it does replay the identical payment, so only R20a catches it
    assert.equal(find(results, "R20b").pass, true, JSON.stringify(results));
  });
  test(`R20b control: the same signed payment resent after a timeout is not settled twice and gets the original result, ${name}`,
    async () => {
      const { results } = await run("", net);
      const b = find(results, "R20b");
      assert.equal(b.pass, true, JSON.stringify(b));
      assert.equal((b.detail as any).successful_settles, 1, JSON.stringify(b.detail));
    });
  test(`R20b settle_both: with no record the resent payment is refused as a duplicate and the result is lost, ${name}`,
    async () => {
      const { results, double } = await run("settle_both", net);
      const b = find(results, "R20b");
      assert.equal(b.pass, false, JSON.stringify(b));
      assert.equal((b.detail as any).successful_settles, 1, JSON.stringify(b.detail));
      assert.ok(double.calls.filter((c) => c.path === "/settle").length >= 4);
    });
  test(`R20b client control: the stock @x402/fetch client with a payment id retries under the same key, ${name}`,
    async () => {
      const r = await client("", net);
      assert.equal(r.pass, true, JSON.stringify(r));
      assert.equal((r.detail as any).same_payment_identifier, true, JSON.stringify(r.detail));
      assert.equal((r.detail as any).successful_settles, 1, JSON.stringify(r.detail));
    });
  test(`R20b client resign_on_timeout: a client that re-signs a fresh payment with no key is flagged, ${name}`,
    async () => {
      const r = await client("resign_on_timeout", net);
      assert.equal(r.pass, false, JSON.stringify(r));
      assert.equal((r.detail as any).fresh_nonce, true, JSON.stringify(r.detail));
      assert.equal((r.detail as any).same_payment_identifier, false, JSON.stringify(r.detail));
      assert.equal((r.detail as any).successful_settles, 2, JSON.stringify(r.detail));
    });
}
