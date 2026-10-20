// Shared setup for the devnet facilitator and the test payer. Solana devnet only.
// Keys are throwaway devnet keypairs read from X402C_KEYS, a directory that must be outside this repository.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createKeyPairSignerFromBytes, createSolanaRpc } from "@solana/kit";

export const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const RPC_URL = process.env.X402C_RPC || "https://api.devnet.solana.com";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function keysDir() {
  const d = process.env.X402C_KEYS;
  if (!d || !existsSync(d)) throw new Error("set X402C_KEYS to a directory of throwaway devnet keypairs");
  const real = realpathSync(d);
  if (real === REPO || real.startsWith(REPO + sep)) throw new Error("X402C_KEYS must be outside the repository");
  return real;
}

export async function signer(name) {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(join(keysDir(), `${name}.json`), "utf8")));
  return createKeyPairSignerFromBytes(bytes);
}

// Public devnet RPCs rate-limit (HTTP 429). Retry RPC requests on 429 and 5xx with exponential backoff, honouring
// Retry-After. This wraps fetch for the RPC host only, so the @x402/svm client and facilitator get it too.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRIES = Number(process.env.X402C_RPC_RETRIES || 8);
const rpcOrigin = new URL(RPC_URL).origin;
const baseFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithBackoff(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
  if (!url || new URL(url).origin !== rpcOrigin) return baseFetch(input, init);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await baseFetch(input, init);
      if (!RETRY_STATUS.has(res.status) || attempt >= RETRIES) return res;
    } catch (e) {
      if (attempt >= RETRIES || init?.signal?.aborted) throw e;
    }
    const after = Number(res?.headers?.get("retry-after"));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(500 * 2 ** attempt, 15_000);
    await new Promise((ok) => setTimeout(ok, wait + Math.floor(Math.random() * 250)));
  }
};

export function rpc() {
  return createSolanaRpc(RPC_URL);
}

// Refuse to run anywhere but Solana devnet.
export async function assertDevnet(r = rpc()) {
  const g = await r.getGenesisHash().send();
  if (g !== DEVNET_GENESIS) throw new Error(`RPC ${RPC_URL} is not Solana devnet (genesis ${g})`);
  return g;
}

export function statePath() {
  return join(keysDir(), "devnet-state.json");
}
