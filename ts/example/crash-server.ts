// A resource server that survives a crash between a successful /settle and its response (R14), on @x402/core's
// x402HTTPResourceServer with the exact scheme on Solana devnet or, with EXAMPLE_NETWORK=eip155:84532, Base Sepolia.
// It advertises the payment-identifier extension (optional) and keeps a durable idempotency record in a JSON file
// (CRASH_STORE), keyed by route and by the payment-identifier id or, without one, by the payment's own reference
// (the Solana transaction's first signature, or the EIP-3009 nonce):
//   1. before /settle it writes "settling" (fsync, then rename), so a crash during /settle leaves a trace
//   2. on success it writes "settled" with the transaction and the response, then sends the response
//   3. presented again, it never settles again: with a payment id it returns the cached response (the extension's
//      "Same id, same payload: Return cached response"); without one it delivers once and then refuses with the
//      transaction; a payment whose settle outcome it never heard answers 409 naming the payment for reconciliation;
//      the same id with a different payment answers 409
// CRASH_FAULT shows what R14 catches:
//   memory_record        the record is a Map in memory, lost on the crash: the server settles again after a restart
//   record_after_settle  the record is written only after /settle returns: a crash during /settle loses it
//   refuse_silent        the record is durable, but a re-presented payment gets a bare 500 that names nothing
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { HTTPAdapter } from "@x402/core/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declarePaymentIdentifierExtension, extractPaymentIdentifier } from "@x402/extensions/payment-identifier";
import { paymentRef } from "../src/crash.js";

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const BASE_SEPOLIA = "eip155:84532";
export const CRASH_FAULTS = ["memory_record", "record_after_settle", "refuse_silent"] as const;
export type CrashFault = "" | (typeof CRASH_FAULTS)[number];

interface Rec {
  state: "settling" | "settled";
  fingerprint: string;
  payment: string;          // signature or nonce
  id: string | null;        // payment-identifier id
  network: string;
  transaction?: string;
  response?: { status: number; headers: Record<string, string>; body: unknown };
  delivered?: boolean;
}

interface Store { get(k: string): Rec | undefined; put(k: string, r: Rec): void; del(k: string): void }

function memoryStore(): Store {
  const m = new Map<string, Rec>();
  return { get: (k) => m.get(k), put: (k, r) => { m.set(k, r); }, del: (k) => { m.delete(k); } };
}

/** A JSON file rewritten whole on every change: write a temp file, fsync it, rename it over the old one. */
function fileStore(path: string): Store {
  const load = (): Record<string, Rec> => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; } };
  const save = (all: Record<string, Rec>) => {
    const tmp = `${path}.${process.pid}.tmp`;
    const fd = openSync(tmp, "w");
    try { writeSync(fd, JSON.stringify(all)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
  };
  return {
    get: (k) => load()[k],
    put: (k, r) => { const all = load(); all[k] = r; save(all); },
    del: (k) => { const all = load(); delete all[k]; save(all); },
  };
}

export async function startCrashServer(facilitatorUrl: string, opts: { fault?: CrashFault; store?: string; port?: number;
    network?: string } = {}): Promise<{ url: string; close(): Promise<void> }> {
  const fault = opts.fault ?? "", network = opts.network ?? DEVNET;
  if (fault !== "memory_record" && !opts.store) throw new Error("CRASH_STORE (a file path) is required");
  const store = fault === "memory_record" ? memoryStore() : fileStore(opts.store!);
  const rs = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 3000 }));
  const evm = network === BASE_SEPOLIA;
  if (evm) rs.register(BASE_SEPOLIA, new ExactEvmScheme());
  else rs.register(network as `${string}:${string}`, new ExactSvmScheme());
  const accepts = evm
    ? { scheme: "exact", network: BASE_SEPOLIA, payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      price: { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "10000", extra: { name: "USDC", version: "2" } } }
    : { scheme: "exact", network, payTo: "11111111111111111111111111111112",
      price: { asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", amount: "10000" } };
  const app = new x402HTTPResourceServer(rs, {
    "GET /paid": { accepts: accepts as any, description: "example paid route that survives a crash",
      extensions: { "payment-identifier": declarePaymentIdentifierExtension(false) } },
  });
  // Initialise lazily and retry: a server started before its facilitator answers comes up anyway.
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= app.initialize().catch((e) => { ready = null; throw e; }));
  await init().catch(() => {});
  const server = http.createServer(async (rq, res) => {
    const url = new URL(rq.url ?? "/", "http://127.0.0.1");
    const adapter: HTTPAdapter = {
      getHeader: (n) => { const v = rq.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
      getMethod: () => rq.method ?? "GET",
      getPath: () => url.pathname,
      getUrl: () => url.toString(),
      getAcceptHeader: () => String(rq.headers.accept ?? "application/json"),
      getUserAgent: () => String(rq.headers["user-agent"] ?? ""),
    };
    const send = (status: number, headers: Record<string, string>, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body ?? {}));
    };
    try {
      try { await init(); } catch { return send(503, {}, { error: "the facilitator is not reachable yet" }); }
      const paymentHeader = adapter.getHeader("payment-signature") ?? adapter.getHeader("x-payment");
      let key = "", rec: Rec | undefined, fingerprint = "", payment = "", id: string | null = null;
      if (paymentHeader && url.pathname === "/paid") {
        let p: any;
        try { p = decodePaymentSignatureHeader(paymentHeader); } catch { p = null; }
        if (p) {
          payment = paymentRef(p.payload);
          try { id = extractPaymentIdentifier(p, true); } catch { id = null; }
          // The fingerprint covers what makes the paid operation unique (the extension's request binding).
          const a = p.accepted ?? {};
          fingerprint = createHash("sha256").update(JSON.stringify([a.scheme, a.network, a.asset, a.amount, a.payTo,
            rq.method, url.pathname, payment])).digest("hex");
          key = `GET /paid|${id ? `id:${id}` : `payment:${payment}`}`;
          rec = store.get(key);
        }
      }
      if (rec) {
        if (rec.fingerprint !== fingerprint) return send(409, {}, { error: "payment identifier already used for a different payment" });
        if (fault === "refuse_silent") return send(500, {}, { error: "internal error" });
        if (rec.state === "settling") {
          return send(409, {}, { error: "this payment's settlement outcome is unknown after a restart; it was not settled " +
            "again. Reconcile it on chain before retrying.", payment: rec.payment, paymentId: rec.id, network: rec.network });
        }
        if (rec.id || !rec.delivered) {
          store.put(key, { ...rec, delivered: true });
          return send(rec.response!.status, rec.response!.headers, rec.response!.body);
        }
        return send(409, {}, { error: "this payment was already settled and its response delivered",
          transaction: rec.transaction, network: rec.network, payment: rec.payment });
      }
      const r = await app.processHTTPRequest({ adapter, path: url.pathname, method: adapter.getMethod(), paymentHeader });
      if (r.type === "no-payment-required") return send(200, {}, { free: true });
      if (r.type === "payment-error") return send(r.response.status, r.response.headers, r.response.body);
      const settling: Rec = { state: "settling", fingerprint, payment, id, network: r.paymentRequirements.network };
      if (key && fault !== "record_after_settle") store.put(key, settling);
      let s;
      try {
        s = await app.processSettlement(r.paymentPayload, r.paymentRequirements, r.declaredExtensions);
      } catch {
        // The outcome is unknown: the "settling" record stays, so this payment is never settled again blindly.
        return send(502, {}, { error: "settlement outcome unknown; reconcile before retrying", payment, paymentId: id });
      }
      if (!s.success) {
        const pending = (s as any).errorReason === "settlement_pending";
        if (key && !pending) store.del(key);
        return send(s.response.status, s.response.headers, s.response.body);
      }
      const body = { content: "paid content" };
      const done: Rec = { ...settling, state: "settled", transaction: s.transaction,
        response: { status: 200, headers: s.headers, body }, delivered: false };
      if (key) store.put(key, done);
      res.on("finish", () => { if (key && !id) { try { store.put(key, { ...done, delivered: true }); } catch { /* best effort */ } } });
      return send(200, s.headers, body);
    } catch (e) {
      send(500, {}, { error: String(e).slice(0, 200) });
    }
  });
  await new Promise<void>((ok) => server.listen(opts.port ?? 0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/paid`,
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isMain && process.env.X402_FACILITATOR_URL) {
  startCrashServer(process.env.X402_FACILITATOR_URL, { fault: (process.env.CRASH_FAULT ?? "") as CrashFault,
    store: process.env.CRASH_STORE, port: Number(process.env.PORT ?? 4030), network: process.env.EXAMPLE_NETWORK ?? DEVNET })
    .then((s) => console.log(JSON.stringify({ listening: s.url })));
}
