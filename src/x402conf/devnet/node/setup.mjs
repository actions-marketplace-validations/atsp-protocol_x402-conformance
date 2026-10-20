// One-time devnet setup: a throwaway test mint (6 decimals) with the payer as mint authority, token accounts for the
// payer and the recipient, and test tokens minted to the payer. The fee payer pays rent and fees in devnet faucet SOL.
// Writes the public addresses to devnet-state.json in X402C_KEYS. No mainnet, no real funds.
import { writeFileSync } from "node:fs";
import {
  appendTransactionMessageInstructions, createTransactionMessage, generateKeyPairSigner, getSignatureFromTransaction,
  pipe, sendTransactionWithoutConfirmingFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction, getMintSize, getMintToInstruction,
} from "@solana-program/token";
import { assertDevnet, rpc, signer, statePath } from "./common.mjs";

const r = rpc();
await assertDevnet(r);
const fee = await signer("feepayer");
const payer = await signer("client");
const payTo = (await signer("payto")).address;
const bal = (await r.getBalance(fee.address).send()).value;
if (bal < 20_000_000n) throw new Error(`fee payer ${fee.address} has ${bal} lamports; fund it from the devnet faucet`);

const mint = await generateKeyPairSigner();
const size = BigInt(getMintSize());
const rent = await r.getMinimumBalanceForRentExemption(size).send();
const [payerAta] = await findAssociatedTokenPda({ mint: mint.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const [payToAta] = await findAssociatedTokenPda({ mint: mint.address, owner: payTo, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const ixs = [
  getCreateAccountInstruction({ payer: fee, newAccount: mint, lamports: rent, space: size, programAddress: TOKEN_PROGRAM_ADDRESS }),
  getInitializeMint2Instruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address }),
  getCreateAssociatedTokenIdempotentInstruction({ payer: fee, ata: payerAta, owner: payer.address, mint: mint.address }),
  getCreateAssociatedTokenIdempotentInstruction({ payer: fee, ata: payToAta, owner: payTo, mint: mint.address }),
  getMintToInstruction({ mint: mint.address, token: payerAta, mintAuthority: payer, amount: 100_000_000n }),
];
const { value: bh } = await r.getLatestBlockhash().send();
const msg = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(fee, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m), (m) => appendTransactionMessageInstructions(ixs, m));
const tx = await signTransactionMessageWithSigners(msg);
const sig = getSignatureFromTransaction(tx);
await sendTransactionWithoutConfirmingFactory({ rpc: r })(tx, { commitment: "confirmed" });
for (let i = 0; i < 60; i++) {
  const s = (await r.getSignatureStatuses([sig]).send()).value[0];
  if (s?.err) throw new Error(`setup transaction failed: ${JSON.stringify(s.err)}`);
  if (s?.confirmationStatus === "finalized" || s?.confirmationStatus === "confirmed") break;
  await new Promise((ok) => setTimeout(ok, 1000));
}
const state = { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", mint: mint.address, decimals: 6,
  feePayer: fee.address, payer: payer.address, payTo, payerAta, payToAta, setupTx: sig };
writeFileSync(statePath(), JSON.stringify(state, null, 1));
console.log(JSON.stringify(state));
