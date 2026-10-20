// The resource-server probe. With the server's facilitator URL pointed at the double, it requests the paid route with
// a payment for each fault mode and checks that content is served only on a final, well-formed, first-time success.
//
//   R0  an unpaid request gets 402 with a decodable PAYMENT-REQUIRED header naming Solana devnet
//   R1  a paid request is served when the facilitator settles it (otherwise the probe proves nothing)
//   R2  the same payment presented twice is served at most once (F3)
//   R3  /settle timeout: not served (F6)            R4  /settle HTML 502: not served (F6)
//   R5  /settle 503 with a success body: not served (F9)
//   R6  /settle non-JSON 200: not served (F9)       R7  /settle truncated body: not served (F9)
//   R8  settlement_pending: not served until final (F5)
//   R9  invalid_transaction_state: not served (F8)
import { randomBytes } from "node:crypto";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { DEVNET, type Double, type Mode } from "./double.js";

export interface CheckResult { check: string; pass: boolean; detail: unknown }

interface Answer { status: number; body: string; headers: Record<string, string> }

async function get(url: string, headers: Record<string, string> = {}, timeoutMs = 60_000): Promise<Answer> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return { status: r.status, body: (await r.text()).slice(0, 500), headers: h };
}

const served = (a: Answer) => a.status >= 200 && a.status < 300;

export async function probe(resourceUrl: string, double: Double): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const unpaid = await get(resourceUrl);
  const prHeader = unpaid.headers["payment-required"];
  let required: any = null;
  try { required = prHeader ? decodePaymentRequiredHeader(prHeader) : null; } catch { required = null; }
  const accepted = required?.accepts?.find((a: any) => a.network === DEVNET);
  out.push({ check: "R0 unpaid request: 402 with a PAYMENT-REQUIRED header for Solana devnet", pass: unpaid.status === 402 && !!accepted,
    detail: { status: unpaid.status, accepts: required?.accepts?.map((a: any) => [a.scheme, a.network]) ?? null } });
  if (!accepted) return out;
  const pay = () => encodePaymentSignatureHeader({ x402Version: 2, resource: required.resource, accepted,
    payload: { transaction: randomBytes(160).toString("base64") } } as any);
  const paid = async (mode: Mode, header = pay()) => {
    double.mode = mode;
    try {
      return await get(resourceUrl, { "PAYMENT-SIGNATURE": header });
    } catch (e) {
      return { status: 0, body: String(e), headers: {} } as Answer;
    } finally {
      double.mode = "reference";
    }
  };
  const ok = await paid("reference");
  out.push({ check: "R1 a settled payment is served", pass: served(ok), detail: { status: ok.status } });
  const h = pay();
  const a = await paid("reference", h);
  const b = await paid("reference", h);
  out.push({ check: "R2 the same payment presented twice is served at most once (F3)",
    pass: Number(served(a)) + Number(served(b)) <= 1, detail: { first: a.status, second: b.status } });
  const faults: [string, Mode][] = [
    ["R3 /settle timeout: content not served (F6)", "settle_timeout"],
    ["R4 /settle HTML 502: content not served (F6)", "settle_502"],
    ["R5 /settle 503 with a success body: content not served (F9)", "settle_503"],
    ["R6 /settle non-JSON 200: content not served (F9)", "settle_non_json"],
    ["R7 /settle truncated body: content not served (F9)", "settle_truncated"],
    ["R8 settlement_pending: content not served before the payment is final (F5)", "settle_pending"],
    ["R9 invalid_transaction_state: content not served (F8)", "settle_failed"],
  ];
  for (const [check, mode] of faults) {
    const r = await paid(mode);
    out.push({ check, pass: !served(r), detail: { status: r.status, body: r.body.slice(0, 120) } });
  }
  return out;
}
