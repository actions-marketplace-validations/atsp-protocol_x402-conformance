// Test payer: builds a signed x402 V2 exact payment payload with the open-source @x402/svm client, for the runner.
//   node payer.mjs '<PaymentRequirements JSON>'   -> prints the PaymentPayload JSON
// The payer key is a throwaway devnet keypair in X402C_KEYS. It never sends anything itself.
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { RPC_URL, assertDevnet, rpc, signer } from "./common.mjs";

const req = JSON.parse(process.argv[2]);
if (req.network !== "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1") throw new Error("devnet only");
await assertDevnet(rpc());
const scheme = new ExactSvmScheme(await signer("client"), { rpcUrl: RPC_URL });
const part = await scheme.createPaymentPayload(2, req);
console.log(JSON.stringify({ ...part, accepted: req }));
