// A facilitator double for resource-server checks: GET /supported, POST /verify and POST /settle (x402 V2 7.1-7.3) on
// loopback, with one switchable fault mode. It never touches a chain, a key or a network beyond loopback.
import http from "node:http";
import type { AddressInfo } from "node:net";

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
// A syntactically valid devnet fee payer the double advertises; it holds nothing and signs nothing.
export const DOUBLE_FEE_PAYER = "11111111111111111111111111111111";

export type Mode =
  | "reference"      // verify: isValid=true; settle: success once per transaction, then duplicate_settlement
  | "settle_timeout" // settle never answers within the resource server's deadline
  | "settle_502"     // settle answers an HTML 502
  | "settle_503"     // settle answers 503 with a body that still reads as success (a proxy replaying a cached body)
  | "settle_non_json"// settle answers 200 with an HTML page
  | "settle_truncated" // settle answers 200 with half of a success body
  | "settle_pending" // settle answers success=false, errorReason=settlement_pending, with a transaction
  | "settle_failed"; // settle answers success=false, errorReason=invalid_transaction_state

export const MODES: Mode[] = ["reference", "settle_timeout", "settle_502", "settle_503", "settle_non_json",
  "settle_truncated", "settle_pending", "settle_failed"];

export interface Double {
  url: string;
  mode: Mode;
  calls: { path: string; mode: Mode }[];
  close(): Promise<void>;
}

function txOf(body: any): string {
  const t = String(body?.paymentPayload?.payload?.transaction ?? "");
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `double-tx-${h.toString(16)}-${t.length}`;
}

export async function startDouble(port = 0, hangMs = 30_000): Promise<Double> {
  const settled = new Set<string>();
  const pendingTimers = new Set<NodeJS.Timeout>();
  const d: Double = { url: "", mode: "reference", calls: [], close: async () => {} };
  const server = http.createServer(async (rq, rs) => {
    const json = (code: number, obj: unknown) => {
      rs.writeHead(code, { "content-type": "application/json" });
      rs.end(JSON.stringify(obj));
    };
    let data = "";
    for await (const c of rq) data += c;
    const path = rq.url ?? "";
    d.calls.push({ path, mode: d.mode });
    if (rq.method === "GET" && path === "/supported") {
      return json(200, { kinds: [{ x402Version: 2, scheme: "exact", network: DEVNET, extra: { feePayer: DOUBLE_FEE_PAYER } }],
        extensions: [], signers: { "solana:*": [DOUBLE_FEE_PAYER] } });
    }
    let body: any;
    try { body = JSON.parse(data); } catch { return json(400, { isValid: false, invalidReason: "invalid_payload" }); }
    const network = body?.paymentRequirements?.network ?? DEVNET;
    if (path === "/verify") return json(200, { isValid: true, payer: "double-payer" });
    if (path !== "/settle") return json(404, { error: "not found" });
    const tx = txOf(body);
    const success = { success: true, transaction: tx, network, payer: "double-payer" };
    switch (d.mode) {
      case "settle_timeout": {
        const t = setTimeout(() => { pendingTimers.delete(t); json(200, success); }, hangMs);
        pendingTimers.add(t);
        return;
      }
      case "settle_502":
        rs.writeHead(502, { "content-type": "text/html" });
        return rs.end("<html><body>502 Bad Gateway</body></html>");
      case "settle_503":
        return json(503, success);
      case "settle_non_json":
        rs.writeHead(200, { "content-type": "text/html" });
        return rs.end("<html><body>Service temporarily unavailable</body></html>");
      case "settle_truncated": {
        const raw = JSON.stringify(success);
        rs.writeHead(200, { "content-type": "application/json" });
        return rs.end(raw.slice(0, Math.floor(raw.length / 2)));
      }
      case "settle_pending":
        return json(200, { success: false, errorReason: "settlement_pending", transaction: tx, network });
      case "settle_failed":
        return json(200, { success: false, errorReason: "invalid_transaction_state", transaction: tx, network });
      default:
        if (settled.has(tx)) return json(200, { success: false, errorReason: "duplicate_settlement", transaction: "", network });
        settled.add(tx);
        return json(200, success);
    }
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  d.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  d.close = () => new Promise((ok) => {
    for (const t of pendingTimers) clearTimeout(t);
    server.closeAllConnections();
    server.close(() => ok());
  });
  return d;
}
