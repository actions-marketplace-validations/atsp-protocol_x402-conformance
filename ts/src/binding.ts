// R11, payment-to-request binding, on a real resource server. The facilitator double accepts any well-formed
// payment, so every refusal this probe sees comes from the server's own matching of the payment to the request.
//
//   control  a correct payment for each route is served, once, with PAYMENT-RESPONSE
//   R11a     a payment built for the cheap route's accepts, presented on the expensive route: not served, no /settle
//   R11b     the expensive route's own accepts with payTo, asset or network altered: not served, no /settle
//   R11c     on a route priced by method, the cheaper method's payment presented with the dearer method: refused
//   R11d     on a route priced by query, the cheaper query's payment presented with the dearer query: refused
//   R11e     unpaid requests to a parameterised paid route with an encoded separator, a dot segment or double
//            encoding in the parameter: never served
//   R11f     sign-in-with-x: pay the cheap route with PaymentPayload.resource.url naming the expensive one, then present
//            only a SIWX header on the expensive route: refused (x402-foundation/x402#3838). A second wallet that
//            honestly paid for the expensive route is let in with SIWX, so a server whose SIWX never works can't pass
import { randomBytes } from "node:crypto";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Double } from "./double.js";
import type { Result } from "./probe.js";

export interface BindingTargets {
  /** A paid route at the lower price. */
  cheap?: string;
  /** A paid route at a higher price on the same server. */
  expensive?: string;
  /** A paid parameterised route, with {id} where the parameter goes, e.g. http://host/items/{id}/premium. */
  parameterised?: string;
  /** A paid URL priced differently for GET and POST (R11c). */
  byMethod?: string;
  /** Two paid URLs that differ only in their query string and are priced differently (R11d). */
  byQuery?: [string, string];
  /** Two paid routes at different prices that declare sign-in-with-x, on an EVM network (R11f). */
  siwx?: { cheap: string; expensive: string };
}

async function get(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000, method = "GET") {
  const r = await fetch(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) });
  const h: Record<string, string> = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  return { status: r.status, body: (await r.text()).slice(0, 300), headers: h };
}
const served = (a: { status: number }) => a.status >= 200 && a.status < 300;
const res = (check: string, pass: boolean, detail: unknown): Result =>
  ({ check, pass, status: pass ? "pass" : "fail", detail });

function payloadFor(accepted: any, from?: string): Record<string, unknown> {
  if (String(accepted.network).startsWith("eip155:")) {
    const now = Math.floor(Date.now() / 1000);
    return { signature: "0x" + randomBytes(65).toString("hex"),
      authorization: { from: from ?? "0x" + randomBytes(20).toString("hex"), to: accepted.payTo, value: accepted.amount,
        validAfter: String(now - 60), validBefore: String(now + Number(accepted.maxTimeoutSeconds ?? 60)),
        nonce: "0x" + randomBytes(32).toString("hex") } };
  }
  return { transaction: randomBytes(160).toString("base64") };
}

async function challenge(url: string, network?: string, method = "GET") {
  const r = await get(url, {}, 15_000, method);
  const h = r.headers["payment-required"];
  let pr: any = null;
  try { pr = h ? decodePaymentRequiredHeader(h) : null; } catch { pr = null; }
  const accepted = pr?.accepts?.find((a: any) => a.scheme === "exact" && (!network || a.network === network));
  return { status: r.status, required: pr, accepted };
}

const sign = (required: any, accepted: any, opts: { resource?: any; from?: string } = {}) =>
  encodePaymentSignatureHeader({ x402Version: 2, resource: opts.resource ?? required.resource, accepted,
    payload: payloadFor(accepted, opts.from) } as any);

export async function probeBinding(t: BindingTargets, double: Double, network?: string): Promise<Result[]> {
  const out: Result[] = [];
  const paid = async (url: string, header: string, method = "GET") => {
    double.mode = "reference";
    const before = double.calls.length;
    const r = await get(url, { "PAYMENT-SIGNATURE": header }, 15_000, method);
    return { status: r.status, settles: double.calls.slice(before).filter((c) => c.path === "/settle").length,
      paymentResponse: !!r.headers["payment-response"] };
  };
  const core = async (cheapUrl: string, dearUrl: string): Promise<boolean> => {
    const cheap = await challenge(cheapUrl, network);
    const dear = await challenge(dearUrl, network);
    const pre = "R11 control: both routes answer 402 with an exact offer, the expensive one at a higher price";
    const priced = cheap.accepted && dear.accepted && BigInt(dear.accepted.amount) > BigInt(cheap.accepted.amount);
    if (cheap.status !== 402 || dear.status !== 402 || !priced) {
      out.push(res(pre, false, { cheap: cheap.status, expensive: dear.status,
        amounts: [cheap.accepted?.amount, dear.accepted?.amount] }));
      return false;
    }
    const ctlCheap = await paid(cheapUrl, sign(cheap.required, cheap.accepted));
    const ctlDear = await paid(dearUrl, sign(dear.required, dear.accepted));
    const controlOk = served(ctlCheap) && served(ctlDear) && ctlCheap.settles === 1 && ctlDear.settles === 1;
    out.push(res("R11 control: a correct payment for each route is served, settled once, with PAYMENT-RESPONSE",
      controlOk && ctlCheap.paymentResponse && ctlDear.paymentResponse, { cheap: ctlCheap, expensive: ctlDear }));
    if (!controlOk) return false;   // nothing below would mean anything

    const a = await paid(dearUrl, sign(cheap.required, cheap.accepted));
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
      const r = await paid(dearUrl, sign(dear.required, acc));
      b[field] = r;
      if (served(r) || r.settles !== 0) bOk = false;
    }
    out.push(res("R11b a payment with payTo, asset or network altered is refused before /settle", bOk, b));
    return true;
  };
  if (t.cheap && t.expensive && !(await core(t.cheap, t.expensive))) return out;

  // R11c and R11d: the same substitution as R11a, where the two requests differ only in method or only in query.
  const swap = async (check: string, a: { url: string; method: string }, b: { url: string; method: string }) => {
    const ca = await challenge(a.url, network, a.method);
    const cb = await challenge(b.url, network, b.method);
    if (!ca.accepted || !cb.accepted || BigInt(ca.accepted.amount) === BigInt(cb.accepted.amount)) {
      out.push(res(check, false, { error: "the two requests must both answer 402 at different prices",
        amounts: [ca.accepted?.amount, cb.accepted?.amount] }));
      return;
    }
    const [lo, hi, cLo] = BigInt(ca.accepted.amount) < BigInt(cb.accepted.amount) ? [a, b, ca] : [b, a, cb];
    const r = await paid(hi.url, sign(cLo.required, cLo.accepted), hi.method);
    out.push(res(check, !served(r) && r.settles === 0, { cheaper: lo, dearer: hi, ...r }));
  };
  if (t.byMethod) {
    await swap("R11c a payment for the cheaper method presented with the dearer method is refused before /settle",
      { url: t.byMethod, method: "GET" }, { url: t.byMethod, method: "POST" });
  }
  if (t.byQuery) {
    await swap("R11d a payment for the cheaper query presented with the dearer query is refused before /settle",
      { url: t.byQuery[0], method: "GET" }, { url: t.byQuery[1], method: "GET" });
  }
  if (t.siwx) out.push(await siwxCheck(t.siwx, double, paid));

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

const R11F = "R11f with sign-in-with-x, access is recorded for the route that was priced and settled, not the client's " +
  "resource.url (x402#3838)";

async function siwxCheck(t: { cheap: string; expensive: string }, _double: Double,
    paid: (url: string, header: string) => Promise<{ status: number; settles: number }>): Promise<Result> {
  // Optional dependencies: a SIWX server already has them. Without them R11f is unsupported, not failed.
  let siwx: any, accounts: any;
  try {
    siwx = await import("@x402/extensions/sign-in-with-x");
    accounts = await import("viem/accounts");
  } catch {
    return { check: R11F, pass: false, status: "unsupported",
      detail: { note: "R11f needs @x402/extensions and viem installed next to the probe" } };
  }
  const wallet = () => accounts.privateKeyToAccount(accounts.generatePrivateKey());   // throwaway, holds nothing
  const signIn = async (url: string, signer: any) => {
    const c = await get(url);
    const pr = decodePaymentRequiredHeader(c.headers["payment-required"]);
    const ext: any = pr.extensions?.["sign-in-with-x"];
    const chain = ext?.supportedChains?.find((x: any) => x.chainId === pr.accepts?.[0]?.network);
    if (!chain) throw new Error("the route does not declare sign-in-with-x for its payment network");
    const payload = await siwx.createSIWxPayload({ ...ext.info, chainId: chain.chainId, type: chain.type }, signer, url);
    return (await get(url, { "SIGN-IN-WITH-X": siwx.encodeSIWxHeader(payload) })).status;
  };
  try {
    const cheap = await challenge(t.cheap);
    const dear = await challenge(t.expensive);
    if (!cheap.accepted || !dear.accepted || !String(cheap.accepted.network).startsWith("eip155:")) {
      return res(R11F, false, { error: "both SIWX routes must answer 402 with an exact EVM offer" });
    }
    // control: an honest buyer of the expensive route is let back in with SIWX alone
    const honest = wallet();
    const bought = await paid(t.expensive, sign(dear.required, dear.accepted, { from: honest.address }));
    const honestBack = await signIn(t.expensive, honest);
    // the attempt: pay the cheap route, naming the expensive route in PaymentPayload.resource
    const attacker = wallet();
    const cheapPaid = await paid(t.cheap, sign(cheap.required, cheap.accepted,
      { from: attacker.address, resource: { ...cheap.required.resource, url: t.expensive } }));
    const attackerBack = await signIn(t.expensive, attacker);
    const controlOk = served(bought) && honestBack >= 200 && honestBack < 300 && served(cheapPaid);
    return res(R11F, controlOk && attackerBack === 402, {
      control: { paid_expensive: bought.status, siwx_on_expensive: honestBack, paid_cheap: cheapPaid.status },
      substituted_resource_url_then_siwx_on_expensive: attackerBack,
      ...(controlOk ? {} : { error: "the control failed: SIWX does not let an honest buyer back in, so R11f proves nothing" }),
    });
  } catch (e) {
    return res(R11F, false, { error: String(e).slice(0, 300) });
  }
}
