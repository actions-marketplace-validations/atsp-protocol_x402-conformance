// A self-hosted x402 V2 facilitator for Solana devnet: the open-source @x402/core facilitator with the @x402/svm exact
// scheme, served over HTTP on loopback. GET /supported, POST /verify, POST /settle (x402 V2 sections 7.1 to 7.3).
//
//   X402C_KEYS=<dir outside the repo> X402C_RPC=<devnet RPC> node facilitator.mjs [port]
//
// X402C_FAULT injects one fault so the runner can show each check fails against a broken build:
//   open_on_malformed   /verify answers isValid=true when the payload does not decode       (F1)
//   accept_dust         /verify checks the amount against 1 instead of the requirements     (F2)
//   success_unsent      /settle answers success with a transaction it never sent            (F5)
import http from "node:http";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { registerExactSvmScheme } from "@x402/svm/exact/facilitator";
import { DEVNET, RPC_URL, assertDevnet, rpc, signer } from "./common.mjs";

const FAULT = process.env.X402C_FAULT || "";
const FAULTS = new Set(["", "open_on_malformed", "accept_dust", "success_unsent"]);
if (!FAULTS.has(FAULT)) throw new Error(`unknown X402C_FAULT ${FAULT}`);
await assertDevnet(rpc());
const fee = await signer("feepayer");
const fac = new x402Facilitator();
registerExactSvmScheme(fac, { signer: toFacilitatorSvmSigner(fee, { defaultRpcUrl: RPC_URL }), networks: DEVNET });

function decodes(p) {
  try {
    return Buffer.from(String(p?.payload?.transaction ?? ""), "base64").length > 64;
  } catch {
    return false;
  }
}

async function handle(path, body) {
  const { paymentPayload: p, paymentRequirements: req } = body;
  if (req?.network !== DEVNET) return [400, { isValid: false, invalidReason: "unsupported_network" }];
  if (path === "/verify") {
    if (FAULT === "open_on_malformed" && !decodes(p)) return [200, { isValid: true }];
    if (FAULT === "accept_dust") return [200, await fac.verify(p, { ...req, amount: "1" })];
    return [200, await fac.verify(p, req)];
  }
  if (FAULT === "success_unsent") {
    // The payer's own signature on the unsent transaction: a well-formed signature that is not on chain.
    const raw = Buffer.from(String(p.payload.transaction), "base64");
    const { getBase58Decoder } = await import("@solana/kit");
    return [200, { success: true, transaction: getBase58Decoder().decode(raw.subarray(1 + 64, 1 + 128)), network: DEVNET }];
  }
  return [200, await fac.settle(p, req)];
}

const port = Number(process.argv[2] || 4021);
http.createServer(async (rq, rs) => {
  const send = (code, obj) => { rs.writeHead(code, { "content-type": "application/json" }); rs.end(JSON.stringify(obj)); };
  try {
    if (rq.method === "GET" && rq.url === "/supported") {
      // Serve only what this build accepts: V2 exact on Solana devnet.
      const sup = fac.getSupported();
      return send(200, { ...sup, kinds: sup.kinds.filter((k) => k.x402Version === 2 && k.network === DEVNET) });
    }
    if (rq.method !== "POST" || !["/verify", "/settle"].includes(rq.url)) return send(404, { error: "not found" });
    let data = "";
    for await (const c of rq) data += c;
    let body;
    try { body = JSON.parse(data); } catch { return send(400, { isValid: false, invalidReason: "invalid_payload" }); }
    const [code, out] = await handle(rq.url, body);
    send(code, out);
  } catch (e) {
    send(500, { error: String(e?.message || e).slice(0, 300) });
  }
}).listen(port, "127.0.0.1", () => console.log(JSON.stringify({ listening: `http://127.0.0.1:${port}`, fault: FAULT || null,
  feePayer: fee.address, network: DEVNET })));
