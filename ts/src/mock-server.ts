// The demo target: a small, correct x402 V2 resource server on loopback, bundled so `x402conf-svm demo` runs with no
// project, no wallet and no chain. GET /paid costs 0.01 test USDC on Solana devnet. It answers 402 with
// PAYMENT-REQUIRED, checks the client's `accepted` against its own requirements, calls the facilitator's /verify and
// /settle, serves only on a well-formed `success: true`, and returns PAYMENT-RESPONSE. It has no dependency beyond
// @x402/core's header encoders. `fault` = "serve_on_any_settle" makes it serve whatever /settle answers, so the demo
// can show a failing run and its fix hints.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { DEVNET } from "./double.js";

export const MOCK_FAULTS = ["serve_on_any_settle"] as const;
const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAY_TO = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

async function post(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`facilitator answered ${r.status}`);
  return JSON.parse(await r.text());
}

export async function startMockResource(facilitatorUrl: string, fault = "", port = 0):
    Promise<{ url: string; close(): Promise<void> }> {
  const base = facilitatorUrl.replace(/\/$/, "");
  const supported = await (await fetch(`${base}/supported`, { signal: AbortSignal.timeout(3000) })).json() as any;
  const kind = supported.kinds?.find((k: any) => k.scheme === "exact" && k.network === DEVNET);
  if (!kind?.extra?.feePayer) throw new Error("the facilitator offers no exact kind on Solana devnet");
  const requirements = { scheme: "exact", network: DEVNET, amount: "10000", asset: USDC_DEVNET, payTo: PAY_TO,
    maxTimeoutSeconds: 60, extra: { feePayer: kind.extra.feePayer } };
  const send = (res: http.ServerResponse, status: number, headers: Record<string, string>, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (rq, res) => {
    const url = new URL(rq.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/paid") return send(res, 404, {}, { error: "not found" });
    const resource = { url: `http://${rq.headers.host}/paid`, description: "x402-conformance demo", mimeType: "application/json" };
    const challenge = (error: string) => send(res, 402,
      { "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2, error, resource, accepts: [requirements] } as any) },
      {});
    const header = rq.headers["payment-signature"];
    if (typeof header !== "string") return challenge("payment required");
    let payload: any;
    try { payload = decodePaymentSignatureHeader(header); } catch { return challenge("malformed payment"); }
    const a = payload?.accepted ?? {};
    if (["scheme", "network", "amount", "asset", "payTo"].some((k) => a[k] !== (requirements as any)[k])) {
      return challenge("payment does not match this route");
    }
    const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements };
    try {
      const v = await post(`${base}/verify`, body);
      if (v?.isValid !== true) return challenge("payment not valid");
    } catch { return challenge("verification failed"); }
    let s: any;
    try { s = await post(`${base}/settle`, body); } catch (e) {
      if (fault === "serve_on_any_settle") return send(res, 200, {}, { content: "paid content" });
      return challenge("settlement failed");
    }
    if (s?.success === true || fault === "serve_on_any_settle") {
      let pr: Record<string, string> = {};
      try { pr = { "PAYMENT-RESPONSE": encodePaymentResponseHeader(s) }; } catch { /* the faulty build serves anyway */ }
      return send(res, 200, pr, { content: "paid content" });
    }
    return challenge("settlement failed");
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/paid`,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}
