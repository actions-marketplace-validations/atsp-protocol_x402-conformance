// R11, payment-to-request binding, on a real resource server. The facilitator double accepts any well-formed
// payment, so every refusal this probe sees comes from the server's own matching of the payment to the request.
//
//   control  a correct payment for each route is served, once, with PAYMENT-RESPONSE
//   R11a     a payment built for the cheap route's accepts, presented on the expensive route: not served, no /settle
//   R11b     the expensive route's own accepts with payTo, asset or network altered: not served, no /settle
//   R11e     unpaid requests to a parameterised paid route with an encoded separator, a dot segment or double
//            encoding in the parameter: never served
import { randomBytes } from "node:crypto";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Double } from "./double.js";
import type { Result } from "./probe.js";

export interface BindingTargets {
  /** A paid route at the lower price. */
  cheap: string;
  /** A paid route at a higher price on the same server. */
  expensive: string;
  /** A paid parameterised route, with {id} where the parameter goes, e.g. http://host/items/{id}/premium. */
  parameterised?: string;
}

async function get(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return { status: r.status, body: (await r.text()).slice(0, 300), headers: h };
}
const served = (a: { status: number }) => a.status >= 200 && a.status < 300;
const res = (check: string, pass: boolean, detail: unknown): Result =>
  ({ check, pass, status: pass ? "pass" : "fail", detail });

function payloadFor(accepted: any): Record<string, unknown> {
  if (String(accepted.network).startsWith("eip155:")) {
    const now = Math.floor(Date.now() / 1000);
    return { signature: "0x" + randomBytes(65).toString("hex"),
      authorization: { from: "0x" + randomBytes(20).toString("hex"), to: accepted.payTo, value: accepted.amount,
        validAfter: String(now - 60), validBefore: String(now + Number(accepted.maxTimeoutSeconds ?? 60)),
        nonce: "0x" + randomBytes(32).toString("hex") } };
  }
  return { transaction: randomBytes(160).toString("base64") };
}

async function challenge(url: string, network?: string) {
  const r = await get(url);
  const h = r.headers["payment-required"];
  let pr: any = null;
  try { pr = h ? decodePaymentRequiredHeader(h) : null; } catch { pr = null; }
  const accepted = pr?.accepts?.find((a: any) => a.scheme === "exact" && (!network || a.network === network));
  return { status: r.status, required: pr, accepted };
}

const sign = (required: any, accepted: any) => encodePaymentSignatureHeader(
  { x402Version: 2, resource: required.resource, accepted, payload: payloadFor(accepted) } as any);

export async function probeBinding(t: BindingTargets, double: Double, network?: string): Promise<Result[]> {
  const out: Result[] = [];
  const cheap = await challenge(t.cheap, network);
  const dear = await challenge(t.expensive, network);
  const pre = "R11 control: both routes answer 402 with an exact offer, the expensive one at a higher price";
  const priced = cheap.accepted && dear.accepted && BigInt(dear.accepted.amount) > BigInt(cheap.accepted.amount);
  if (cheap.status !== 402 || dear.status !== 402 || !priced) {
    out.push(res(pre, false, { cheap: cheap.status, expensive: dear.status,
      amounts: [cheap.accepted?.amount, dear.accepted?.amount] }));
    return out;
  }
  const paid = async (url: string, header: string) => {
    double.mode = "reference";
    const before = double.calls.length;
    const r = await get(url, { "PAYMENT-SIGNATURE": header });
    return { status: r.status, settles: double.calls.slice(before).filter((c) => c.path === "/settle").length,
      paymentResponse: !!r.headers["payment-response"] };
  };
  const ctlCheap = await paid(t.cheap, sign(cheap.required, cheap.accepted));
  const ctlDear = await paid(t.expensive, sign(dear.required, dear.accepted));
  const controlOk = served(ctlCheap) && served(ctlDear) && ctlCheap.settles === 1 && ctlDear.settles === 1;
  out.push(res("R11 control: a correct payment for each route is served, settled once, with PAYMENT-RESPONSE",
    controlOk && ctlCheap.paymentResponse && ctlDear.paymentResponse, { cheap: ctlCheap, expensive: ctlDear }));
  if (!controlOk) return out;   // nothing below would mean anything

  const a = await paid(t.expensive, sign(cheap.required, cheap.accepted));
  out.push(res("R11a a payment for the cheap route presented on the expensive route is refused before /settle",
    !served(a) && a.settles === 0, a));

  const variants: [string, any][] = [
    ["payTo", { ...dear.accepted, payTo: cheap.accepted.payTo === dear.accepted.payTo
      ? (String(dear.accepted.network).startsWith("eip155:") ? "0x" + "11".repeat(20)
        : "So11111111111111111111111111111111111111112") : cheap.accepted.payTo }],
    ["asset", { ...dear.accepted, asset: String(dear.accepted.network).startsWith("eip155:")
      ? "0x" + "22".repeat(20) : "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" }],
    ["network", { ...dear.accepted, network: String(dear.accepted.network).startsWith("eip155:")
      ? "eip155:11155111" : "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z" }],
  ];
  const b: Record<string, unknown> = {};
  let bOk = true;
  for (const [field, acc] of variants) {
    const r = await paid(t.expensive, sign(dear.required, acc));
    b[field] = r;
    if (served(r) || r.settles !== 0) bOk = false;
  }
  out.push(res("R11b a payment with payTo, asset or network altered is refused before /settle", bOk, b));

  if (t.parameterised) {
    const ctl = await get(t.parameterised.replace("{id}", "42"));
    const tricks = ["4%2F2", "4%5C2", "%2e%2e%2F42", "4%252F2", "42%2F..%2F42"];
    const e: Record<string, number> = {};
    let eOk = ctl.status === 402;
    for (const id of tricks) {
      const r = await get(t.parameterised.replace("{id}", id));
      e[id] = r.status;
      if (served(r)) eOk = false;
    }
    out.push(res("R11e an encoded separator, dot segment or double encoding never reaches a paid handler unpaid",
      eOk, { control_unpaid: ctl.status, attempts: e }));
  }
  return out;
}
