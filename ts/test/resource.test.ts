// P1-P5 in TypeScript must agree with the Python CLI on every answer: the same check passes or fails in both. The
// answers are served from loopback; nothing leaves the machine.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { check402, checkPaymentRequired } from "../src/resource.js";
import { userAgent } from "../src/report.js";

const SRC = fileURLToPath(new URL("../../../src", import.meta.url));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const svm = { scheme: "exact", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  payTo: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", amount: "1000", maxTimeoutSeconds: 60,
  extra: { feePayer: "11111111111111111111111111111111" } };
const evm = { scheme: "exact", network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", amount: "1000", maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" } };
const v2 = (accepts: unknown[], extra: Record<string, unknown> = {}) =>
  ({ x402Version: 2, resource: { url: "http://127.0.0.1/paid" }, accepts, ...extra });
const v1 = { x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", asset: evm.asset, payTo: evm.payTo,
  maxAmountRequired: "1000", maxTimeoutSeconds: 60, resource: "http://127.0.0.1/paid", description: "x", extra: { name: "USDC", version: "2" } }] };

// name -> [status, headers, body]
type Fixture = [number, Record<string, string>, string];
const FIXTURES: Record<string, Fixture> = {
  "valid v2 svm": [402, { "payment-required": b64(v2([svm])) }, "{}"],
  "valid v2 evm": [402, { "payment-required": b64(v2([evm])) }, "{}"],
  "valid v2 base64url": [402, { "payment-required": b64url(v2([evm, svm])) }, "{}"],
  "valid v1 body": [402, {}, JSON.stringify(v1)],
  "200 not 402": [200, {}, "{}"],
  "402 without anything": [402, {}, "not json"],
  "header not base64": [402, { "payment-required": "%%%not-base64%%%" }, "{}"],
  "header base64 not json": [402, { "payment-required": Buffer.from("hello").toString("base64") }, "{}"],
  "v2 in the body": [402, {}, JSON.stringify({ ...v2([svm]), x402Version: 1, resource: undefined })],
  "version 3": [402, { "payment-required": b64({ ...v2([svm]), x402Version: 3 }) }, "{}"],
  "no resource url": [402, { "payment-required": b64({ ...v2([svm]), resource: {} }) }, "{}"],
  "empty accepts": [402, { "payment-required": b64(v2([])) }, "{}"],
  "amount as number": [402, { "payment-required": b64(v2([{ ...svm, amount: 1000 }])) }, "{}"],
  "amount zero": [402, { "payment-required": b64(v2([{ ...svm, amount: "0" }])) }, "{}"],
  "amount decimal": [402, { "payment-required": b64(v2([{ ...svm, amount: "0.01" }])) }, "{}"],
  "network not caip2": [402, { "payment-required": b64(v2([{ ...svm, network: "solana-devnet" }])) }, "{}"],
  "timeout missing": [402, { "payment-required": b64(v2([{ ...svm, maxTimeoutSeconds: undefined }])) }, "{}"],
  "timeout bool": [402, { "payment-required": b64(v2([{ ...svm, maxTimeoutSeconds: true }])) }, "{}"],
  "payTo empty": [402, { "payment-required": b64(v2([{ ...svm, payTo: "" }])) }, "{}"],
  "extra not object": [402, { "payment-required": b64(v2([{ ...svm, extra: "x" }])) }, "{}"],
  "entry not object": [402, { "payment-required": b64(v2(["x", svm])) }, "{}"],
  "svm no feePayer": [402, { "payment-required": b64(v2([{ ...svm, extra: {} }])) }, "{}"],
  "svm bad feePayer": [402, { "payment-required": b64(v2([{ ...svm, extra: { feePayer: "0OIl" + "1".repeat(30) } }])) }, "{}"],
  "svm short feePayer": [402, { "payment-required": b64(v2([{ ...svm, extra: { feePayer: "2".repeat(32) } }])) }, "{}"],
  "evm no name": [402, { "payment-required": b64(v2([{ ...evm, extra: { version: "2" } }])) }, "{}"],
  "evm permit2": [402, { "payment-required": b64(v2([{ ...evm, extra: { assetTransferMethod: "permit2" } }])) }, "{}"],
  "evm unknown method": [402, { "payment-required": b64(v2([{ ...evm, extra: { assetTransferMethod: "magic" } }])) }, "{}"],
  "v1 missing description": [402, {}, JSON.stringify({ ...v1, accepts: [{ ...v1.accepts[0], description: undefined }] })],
  "upto scheme ignored by P5": [402, { "payment-required": b64(v2([{ ...svm, scheme: "upto", extra: {} }])) }, "{}"],
};

let base = "";
let lastUA = "";
const server = http.createServer((rq, rs) => {
  lastUA = String(rq.headers["user-agent"] ?? "");
  const f = FIXTURES[decodeURIComponent((rq.url ?? "/").slice(1))];
  if (!f) { rs.writeHead(404); return rs.end(); }
  rs.writeHead(f[0], { "content-type": "application/json", ...f[1] });
  rs.end(f[2]);
});
before(() => new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => {
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`; ok();
})));
after(() => new Promise<void>((ok) => server.close(() => ok())));

const verdicts = (checks: { check: string; pass: boolean }[]) => checks.map((c) => `${c.check.split(" ")[0]}=${c.pass}`).join(" ");

// Async on purpose: the fixture server runs in this process, so a blocking spawn would deadlock it.
function python(url: string): Promise<{ check: string; pass: boolean }[]> {
  return new Promise((ok, fail) => {
    const p = spawn("python3", ["-m", "x402conf", "resource", url], { env: { ...process.env, PYTHONPATH: SRC } });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? ok(JSON.parse(out).results[0].checks) : fail(new Error(`python exited ${code}: ${err}`))));
  });
}

describe("P1-P5 parity with the Python CLI", () => {
  for (const name of Object.keys(FIXTURES)) {
    test(name, async () => {
      const url = base + encodeURIComponent(name);
      const ts = await checkPaymentRequired(url, { via: "node-test" });
      assert.equal(verdicts(ts.results), verdicts(await python(url)), JSON.stringify(ts.results, null, 1));
    });
  }
  test("the valid answers pass and every broken one fails somewhere", async () => {
    for (const [name, f] of Object.entries(FIXTURES)) {
      const ok = check402({ status: f[0], headers: f[1], body: f[2] }).every((c) => c.pass);
      assert.equal(ok, name.startsWith("valid") || name.startsWith("upto") || name === "evm permit2", name);
    }
  });
});

describe("checkPaymentRequired", () => {
  test("sends one unpaid GET with the entry point in the User-Agent", async () => {
    await checkPaymentRequired(base + encodeURIComponent("valid v2 svm"), { via: "vitest" });
    assert.equal(lastUA, userAgent("vitest"));
    assert.match(lastUA, /^x402-conformance\/\d+\.\d+\.\d+ \(\+https:\/\/github.com\/atsp-protocol\/x402-conformance; via=vitest\)$/);
  });
  test("an unreachable URL fails P1 instead of throwing", async () => {
    const r = await checkPaymentRequired("http://127.0.0.1:9/paid", { timeoutMs: 2000 });
    assert.deepEqual(r.summary.failed_ids, ["P1"]);
    assert.equal(r.schema, "x402-conformance.report/1");
  });
});
