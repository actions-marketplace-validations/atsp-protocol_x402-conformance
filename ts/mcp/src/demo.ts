// A minimal x402 V2 resource server with no SDK and no wallet, for the demo tool: one paid route on Solana devnet that
// verifies and settles through whatever facilitator URL it is given, and serves only on a final, well-formed success.
// With fault "serve_on_any_settle" it serves whatever /settle answers, so the demo can show a failing run too.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { DEVNET, DOUBLE_FEE_PAYER } from "x402-conformance-svm";

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const PAY_TO = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export type DemoFault = "none" | "serve_on_any_settle";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json };
}

export async function startDemoServer(facilitatorUrl: string, fault: DemoFault = "none"):
    Promise<{ url: string; close(): Promise<void> }> {
  let base = "";
  const server = http.createServer(async (rq, rs) => {
    const url = new URL(rq.url ?? "/", base);
    if (url.pathname !== "/paid") { rs.writeHead(404); return rs.end(); }
    const requirements = { scheme: "exact", network: DEVNET, asset: DEVNET_USDC, payTo: PAY_TO, amount: "1000",
      maxTimeoutSeconds: 60, extra: { feePayer: DOUBLE_FEE_PAYER } };
    const required = { x402Version: 2, resource: { url: url.toString(), description: "demo paid route" }, accepts: [requirements] };
    const deny = (why: string) => {
      rs.writeHead(402, { "content-type": "application/json", "payment-required": b64({ ...required, error: why }) });
      rs.end(JSON.stringify({ error: why }));
    };
    const header = rq.headers["payment-signature"];
    if (typeof header !== "string") return deny("payment required");
    let paymentPayload: any;
    try { paymentPayload = JSON.parse(Buffer.from(header, "base64").toString("utf8")); } catch { return deny("invalid payment"); }
    const body = { x402Version: 2, paymentPayload, paymentRequirements: requirements };
    try {
      const v = await post(`${facilitatorUrl}/verify`, body);
      if (v.status !== 200 || v.json?.isValid !== true) return deny("payment not valid");
      let s: { status: number; json: any };
      try { s = await post(`${facilitatorUrl}/settle`, body); } catch (e) {
        if (fault === "serve_on_any_settle") { rs.writeHead(200, { "content-type": "application/json" }); return rs.end('{"content":"paid"}'); }
        throw e;
      }
      const ok = s.status === 200 && s.json?.success === true && typeof s.json.transaction === "string" && s.json.transaction;
      if (!ok && fault !== "serve_on_any_settle") return deny("settlement did not succeed");
      rs.writeHead(200, { "content-type": "application/json",
        ...(ok ? { "payment-response": b64({ success: true, transaction: s.json.transaction, network: DEVNET, payer: s.json.payer }) } : {}) });
      rs.end('{"content":"paid"}');
    } catch {
      if (!rs.headersSent) { rs.writeHead(502, { "content-type": "application/json" }); rs.end('{"error":"facilitator unavailable"}'); }
    }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: `${base}/paid`, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}
