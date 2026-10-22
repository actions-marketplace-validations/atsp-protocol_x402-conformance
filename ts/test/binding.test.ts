import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BASE_SEPOLIA, DEVNET, startDouble } from "../src/double.js";
import { probeBinding } from "../src/binding.js";
import { startBindingServer, startSiwxServer, type BindingFault, type SiwxMode } from "../example/binding-server.js";

const failed = (rs: { check: string; pass: boolean }[]) => rs.filter((r) => !r.pass).map((r) => r.check.split(" ")[0]);

async function run(fault: BindingFault, network: string) {
  const double = await startDouble(0);
  const srv = await startBindingServer(double.url, fault, network, 0);
  try {
    const results = await probeBinding({ cheap: `${srv.base}/cheap`, expensive: `${srv.base}/expensive`,
      parameterised: `${srv.base}/items/{id}/premium`, byMethod: `${srv.base}/item`,
      byQuery: [`${srv.base}/report?tier=basic`, `${srv.base}/report?tier=pro`] }, double, network);
    return { results, failed: failed(results) };
  } finally {
    await srv.close();
    await double.close();
  }
}

async function runSiwx(mode: SiwxMode) {
  const double = await startDouble(0);
  const srv = await startSiwxServer(double.url, mode, 0);
  try {
    const results = await probeBinding({ siwx: { cheap: `${srv.base}/siwx/cheap`, expensive: `${srv.base}/siwx/expensive` } },
      double, BASE_SEPOLIA);
    return results.find((r) => r.check.startsWith("R11f "))!;
  } finally {
    await srv.close();
    await double.close();
  }
}

describe("R11f sign-in-with-x binding", () => {
  test("R11f control: a SIWX server that records the settled route passes", async () => {
    const r = await runSiwx("fixed");
    assert.equal(r.pass, true, JSON.stringify(r, null, 1));
  });
  test("R11f: a SIWX server that records the client's resource.url is caught (stock 2.28.0, x402#3838)", async () => {
    const r = await runSiwx("stock");
    assert.equal(r.pass, false, JSON.stringify(r, null, 1));
    assert.equal((r.detail as any).substituted_resource_url_then_siwx_on_expensive, 200);
  });
});

describe("R11 payment-to-request binding", { concurrency: true }, () => {
  for (const net of [DEVNET, BASE_SEPOLIA]) {
    test(`R11 control: the stock @x402/express server passes R11 on ${net}`, async () => {
      const { results, failed: f } = await run("", net);
      assert.deepEqual(f, [], JSON.stringify(results, null, 1));
      assert.equal(results.length, 6);
    });
    test(`R11a R11b: a server that settles against the client's accepted requirements is caught on ${net}`,
      async () => {
        const { failed: f } = await run("trust_client", net);
        assert.deepEqual(f, ["R11a", "R11b", "R11c", "R11d"]);
      });
    test(`R11c R11d: a server that prices from the client's accepted requirements is caught on ${net}`, async () => {
      const { failed: f } = await run("trust_client", net);
      assert.ok(f.includes("R11c") && f.includes("R11d"), f.join(","));
    });
    test(`R11 control: a server that never serves a paid route is caught on ${net}`, async () => {
      const { failed: f } = await run("refuse_paid", net);
      assert.ok(f.includes("R11"), f.join(","));
    });
    test(`R11e: a server whose route matching sees the decoded path is caught on ${net}`, async () => {
      const { failed: f } = await run("decoded_match", net);
      assert.deepEqual(f, ["R11e"]);
    });
  }
});
