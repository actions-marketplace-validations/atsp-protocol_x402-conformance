import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BASE_SEPOLIA, DEVNET, startDouble } from "../src/double.js";
import { probeBinding } from "../src/binding.js";
import { startBindingServer, type BindingFault } from "../example/binding-server.js";

const failed = (rs: { check: string; pass: boolean }[]) => rs.filter((r) => !r.pass).map((r) => r.check.split(" ")[0]);

async function run(fault: BindingFault, network: string) {
  const double = await startDouble(0);
  const srv = await startBindingServer(double.url, fault, network, 0);
  try {
    const results = await probeBinding({ cheap: `${srv.base}/cheap`, expensive: `${srv.base}/expensive`,
      parameterised: `${srv.base}/items/{id}/premium` }, double, network);
    return { results, failed: failed(results) };
  } finally {
    await srv.close();
    await double.close();
  }
}

describe("R11 payment-to-request binding", { concurrency: true }, () => {
  for (const net of [DEVNET, BASE_SEPOLIA]) {
    test(`R11 control: the stock @x402/express server passes R11 on ${net}`, async () => {
      const { results, failed: f } = await run("", net);
      assert.deepEqual(f, [], JSON.stringify(results, null, 1));
      assert.equal(results.length, 4);
    });
    test(`R11a R11b: a server that settles against the client's accepted requirements is caught on ${net}`,
      async () => {
        const { failed: f } = await run("trust_client", net);
        assert.deepEqual(f, ["R11a", "R11b"]);
      });
    test(`R11e: a server whose route matching sees the decoded path is caught on ${net}`, async () => {
      const { failed: f } = await run("decoded_match", net);
      assert.deepEqual(f, ["R11e"]);
    });
  }
});
