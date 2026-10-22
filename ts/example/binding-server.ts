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
import type { AddressInfo } from "node:net";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const BASE_SEPOLIA = "eip155:84532";
export type BindingFault = "" | "trust_client" | "decoded_match";
export const BINDING_FAULTS: BindingFault[] = ["trust_client", "decoded_match"];

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
  const routes = Object.fromEntries(Object.entries(PRICES).map(([p, price]) => [`GET ${p}`, route(price)]));
  if (fault === "") {
    app.use(paymentMiddleware(routes, server));
  } else {
    // The faulty builds reuse the stock middleware for the 402 challenge and pricing, and differ only in the
    // one decision each one gets wrong.
    const stock = paymentMiddleware(routes, server);
    app.use(async (req, res, next) => {
      if (fault === "decoded_match") {
        // The fault: route matching sees the decoded path, the framework routes the raw one.
        let decoded = req.path;
        try { decoded = decodeURIComponent(req.path); } catch { /* keep raw */ }
        const paid = ["/cheap", "/expensive"].includes(decoded) || /^\/items\/[^/]+\/premium$/.test(decoded);
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
  app.get("/items/:id/premium", (req, res) => { res.json({ content: "premium item", id: req.params.id }); });
  const http = await new Promise<import("node:http").Server>((ok) => { const s = app.listen(port, "127.0.0.1", () => ok(s)); });
  return {
    base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    close: () => new Promise((ok) => { http.closeAllConnections(); http.close(() => ok()); }),
  };
}
