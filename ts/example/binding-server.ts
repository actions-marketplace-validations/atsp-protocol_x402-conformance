// Resource servers for R11, payment-to-request binding. Each serves two exact-scheme routes at different prices,
// /cheap ($0.001) and /expensive ($1.00), and a parameterised paid route /items/:id/premium ($1.00), behind the
// facilitator named by X402_FACILITATOR_URL.
//
//   stock          the upstream @x402/express paymentMiddleware with its defaults: the legitimate control
//   trust_client   a hand-rolled middleware that verifies and settles against the requirements the client says it
//                  accepted, instead of the route's own: a payment for /cheap unlocks /expensive (R11a), and an
//                  altered payTo is settled (R11b)
//   decoded_match  a hand-rolled middleware that matches paid routes on the decoded path while Express routes on the
//                  raw one, so an encoded separator in a parameter reaches the paid handler unpaid (R11e)
//   refuse_paid    never serves a paid request, so the R11 control itself must fail
// It also prices GET /item at $0.001 and POST /item at $1.00 (R11c), and GET /report by its tier query parameter,
// basic at $0.001 and pro at $1.00 (R11d).
import type { AddressInfo } from "node:net";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createSIWxResourceServerExtension, declareSIWxExtension, InMemorySIWxStorage } from "@x402/extensions/sign-in-with-x";

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const BASE_SEPOLIA = "eip155:84532";
export type BindingFault = "" | "trust_client" | "decoded_match" | "refuse_paid";
export const BINDING_FAULTS: BindingFault[] = ["trust_client", "decoded_match", "refuse_paid"];

const PRICES = { "/cheap": "$0.001", "/expensive": "$1.00", "/items/[id]/premium": "$1.00" } as const;

export interface BindingServer { base: string; close(): Promise<void> }

export async function startBindingServer(facilitatorUrl: string, fault: BindingFault = "", network = DEVNET,
    port = 0): Promise<BindingServer> {
  const net = network as `${string}:${string}`;
  const evm = network === BASE_SEPOLIA;
  const payTo = evm ? "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" : "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(net, evm ? new ExactEvmScheme() : new ExactSvmScheme());
  const app = express();
  const route = (price: string) => ({ accepts: [{ scheme: "exact", price, network: net, payTo }],
    description: "binding example", mimeType: "application/json" });
  const routes: Record<string, any> = Object.fromEntries(
    Object.entries(PRICES).map(([p, price]) => [`GET ${p}`, route(price)]));
  routes["GET /item"] = route("$0.001");
  routes["POST /item"] = route("$1.00");
  routes["GET /report"] = { ...route("$0.001"), accepts: [{ scheme: "exact", network: net, payTo,
    price: (ctx: any) => (ctx.adapter.getQueryParam?.("tier") === "pro" ? "$1.00" : "$0.001") }] };
  if (fault === "") {
    app.use(paymentMiddleware(routes, server));
  } else {
    // The faulty builds reuse the stock middleware for the 402 challenge and pricing, and differ only in the
    // one decision each one gets wrong.
    const stock = paymentMiddleware(routes, server);
    app.use(async (req, res, next) => {
      if (fault === "refuse_paid" && req.header("payment-signature")) {
        return void res.status(402).json({ error: "this build never serves a paid request" });
      }
      if (fault === "refuse_paid") return stock(req, res, next);
      if (fault === "decoded_match") {
        // The fault: route matching sees the decoded path, the framework routes the raw one.
        let decoded = req.path;
        try { decoded = decodeURIComponent(req.path); } catch { /* keep raw */ }
        const paid = ["/cheap", "/expensive", "/item", "/report"].includes(decoded) || /^\/items\/[^/]+\/premium$/.test(decoded);
        if (!paid) return next();
        return stock(req, res, next);
      }
      // trust_client: a paid request is verified and settled against what the client claims it accepted.
      const header = req.header("payment-signature");
      if (!header) return stock(req, res, next);
      let payload: any;
      try { payload = decodePaymentSignatureHeader(header); } catch { return stock(req, res, next); }
      const requirements = payload.accepted;
      const v = await facilitator.verify(payload, requirements).catch(() => null);
      if (!v?.isValid) return stock(req, res, next);
      const s = await facilitator.settle(payload, requirements).catch(() => null);
      if (!s?.success) {
        res.status(402).setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader({ x402Version: 2,
          error: "settlement failed", resource: { url: req.originalUrl }, accepts: [requirements] } as any));
        return res.json({});
      }
      res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(s as any));
      return next();
    });
  }
  app.get("/cheap", (_req, res) => { res.json({ content: "cheap content" }); });
  app.get("/expensive", (_req, res) => { res.json({ content: "expensive content" }); });
  app.get("/item", (_req, res) => { res.json({ content: "item, read" }); });
  app.post("/item", (_req, res) => { res.json({ content: "item, written" }); });
  app.get("/report", (req, res) => { res.json({ content: `report, ${req.query.tier ?? "basic"}` }); });
  app.get("/items/:id/premium", (req, res) => { res.json({ content: "premium item", id: req.params.id }); });
  const http = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(port, "127.0.0.1", () => ok(s)); });
  return {
    base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    close: () => new Promise((ok) => { http.closeAllConnections(); http.close(() => ok()); }),
  };
}

// ---------------- R11f: sign-in-with-x ----------------
// /siwx/cheap ($0.001) and /siwx/expensive ($1.00) on Base Sepolia, both declaring the sign-in-with-x extension, so a
// wallet that has paid for a route can come back with only a SIWX header.
//   stock  createSIWxResourceServerExtension as shipped: the settle hook records access under the client's
//          PaymentPayload.resource.url (x402-foundation/x402#3838)
//   fixed  the same extension, with access recorded under the path the server actually priced and settled, as the
//          fix proposed upstream does; the R11f control

export type SiwxMode = "stock" | "fixed";

export async function startSiwxServer(facilitatorUrl: string, mode: SiwxMode, port = 0): Promise<BindingServer> {
  const net = BASE_SEPOLIA as `${string}:${string}`;
  const payTo = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
  const storage = new InMemorySIWxStorage();
  const app = express();
  const http = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(port, "127.0.0.1", () => ok(s)); });
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const ext: any = createSIWxResourceServerExtension({ storage, origin });
  if (mode === "fixed") {
    ext.hooks = { onAfterSettle: async (_d: unknown, ctx: any) => {
      if (!ctx?.result?.success || !ctx.result.payer) return;
      const path = ctx.transportContext?.request?.path;
      if (typeof path === "string") await storage.recordPayment(path, ctx.result.payer);
    } };
  }
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl }))
    .register(net, new ExactEvmScheme()).registerExtension(ext);
  const route = (price: string) => ({ accepts: [{ scheme: "exact", price, network: net, payTo }],
    description: "SIWX binding example", mimeType: "application/json",
    extensions: declareSIWxExtension({ statement: "Sign in to access what you bought" }) });
  app.use(paymentMiddleware({ "GET /siwx/cheap": route("$0.001"), "GET /siwx/expensive": route("$1.00") } as any, server));
  app.get("/siwx/cheap", (_req, res) => { res.json({ content: "cheap content" }); });
  app.get("/siwx/expensive", (_req, res) => { res.json({ content: "expensive content" }); });
  return {
    base: origin,
    close: () => new Promise((ok) => { http.closeAllConnections(); http.close(() => ok()); }),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isMain && process.env.X402_FACILITATOR_URL) {
  const f = process.env.X402_FACILITATOR_URL, port = Number(process.env.PORT ?? 4021);
  (process.env.SIWX_MODE ? startSiwxServer(f, process.env.SIWX_MODE as SiwxMode, port)
    : startBindingServer(f, (process.env.BINDING_FAULT ?? "") as BindingFault, process.env.EXAMPLE_NETWORK ?? DEVNET, port))
    .then((s) => console.log(JSON.stringify({ listening: s.base })));
}
