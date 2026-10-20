# What failed and how to fix it

One section per check. Each failed check in the job summary, in SARIF (GitHub code scanning) and in JUnit links to
its section here. [SPEC.md](SPEC.md) quotes the spec text behind each check. These are fixes for the property a check
tests. Passing a check is evidence about that property only, not certification of conformance to x402.

Checks run in three places: **S** checks read a facilitator's `GET /supported`; **F** checks drive a facilitator (a
double offline, or a facilitator you run on devnet) and the resource-server guard in front of it; **R** checks put a
facilitator double in front of your resource server and request your paid route.

## S0
**What failed.** `GET <facilitator>/supported` didn't answer with JSON: a timeout, DNS or TLS error, a non-2xx status,
a body over 1 MiB or a body that isn't JSON. No other S check could run.
**How to fix it.** Check the URL is the facilitator's base URL (the suite appends `/supported`). Serve `/supported`
without authentication, with `content-type: application/json`. If the endpoint needs a key (as some hosted
facilitators do), leave it out of `facilitators` and test it on devnet instead.

## S1
**What failed.** The `SupportedResponse` is missing `kinds` (array), `extensions` (array) or `signers` (object).
**Why it matters.** V2 §7.3.1 makes all three required. Clients and resource servers read `signers` to check who will
pay fees and sign; without it they can't verify a fee payer.
**How to fix it.** Return all three, even when empty: `{"kinds": [...], "extensions": [], "signers": {}}`. A V1-only
facilitator fails S1 by design; add V2 kinds or don't advertise V2.

## S2
**What failed.** A kind with `x402Version: 2` names its network without CAIP-2, for example `base-sepolia`.
**How to fix it.** Use `namespace:reference` IDs (V2 §11.1): `eip155:84532`, `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`.
Keep V1 names only on `x402Version: 1` kinds.

## S3
**What failed.** A Solana V2 kind uses a V1 name such as `solana-devnet`, or a `solana:` ID that isn't mainnet
(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) or devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
**How to fix it.** Use the published genesis-hash IDs from the Solana x402 guide. A typo here makes clients that match
networks exactly skip your facilitator.

## S4
**What failed.** A Solana `exact` kind has no `extra.feePayer`, the value isn't a 32-byte base58 key, or it isn't listed
in `signers` under a pattern that matches the kind's network (the exact CAIP-2 ID or `solana:*`).
**Why it matters.** The client builds the transaction with this fee payer. A wrong or unlisted key means payments that
fail to settle, or a fee payer clients can't verify.
**How to fix it.** Set `extra.feePayer` to the key that will sign as fee payer and list it in `signers` under
`solana:*` or the kind's exact network ID.

## F1
**What failed.** A malformed payment payload was accepted (`isValid: true`) instead of rejected.
**How to fix it.** Validate the payload's shape and decoding before anything else and answer `invalid_payload` on any
error. Parse failures, missing fields and transient decode errors must fail closed (SVM exact §2.1.2).

## F2
**What failed.** A transfer below `PaymentRequirements.amount`, or a dust amount, was accepted.
**How to fix it.** Compare the decoded transfer amount with `amount` as integers in base units, after decimals, and
reject anything lower (SVM exact §1.1, §1.4). Check the mint and destination at the same time.

## F3
**What failed.** The same payment payload settled successfully twice, or a resource server served it twice.
**Why it matters.** A replayed `X-PAYMENT` header buys the resource twice for one payment.
**How to fix it.** Keep a duplicate-settlement cache keyed by the transaction (SVM exact, Duplicate Settlement
Mitigation) and answer `duplicate_settlement` on a hit. Make check-and-insert atomic: a read followed by a separate
write double-credits under concurrency (see `racy_not_nodup` in the Lean models). Record the key once the outcome is
final, so a retried `settlement_pending` still reaches its result (F7).

## F4
**What failed.** A memo or nonce that was already used settled again in a new transaction.
**Why it matters.** If your server ties one purchase to one memo, two transactions with the same memo can unlock two
purchases' worth of state. On devnet, the reference facilitator (`@x402/svm` 2.28.0) deduplicates by transaction but
not by memo, so this is yours to enforce.
**How to fix it.** Record consumed memos or nonces and reject a second use, atomically, in the facilitator or in the
resource server that maps memos to purchases.

## F5
**What failed.** A payment counted as settled before it was confirmed, or `settlement_pending` came back without a
non-empty `transaction`.
**How to fix it.** Return `success: true` only after the confirmation level you require. When you can't confirm in
time, return `settlement_pending` with the transaction signature (V2 §9), so the caller can reconcile on chain.

## F6
**What failed.** A facilitator timeout or malformed response was treated as a successful settlement.
**How to fix it.** In the resource server, credit only on a well-formed `success: true` answer. Treat timeouts, network
errors and unparsable bodies as "not settled" and keep the payment retryable.

## F7
**What failed.** A `settlement_pending` settle retried with the same body didn't reach its final result, came back with
a different transaction, or was credited more than once.
**How to fix it.** Treat `settlement_pending` as non-terminal (V2 §9). On retry, look up the same transaction and
return its final outcome; don't answer `duplicate_settlement` for a payment that never finished. Credit once, on the
final success.

## F8
**What failed.** A transaction that failed on chain after `settlement_pending` was still reported as pending.
**How to fix it.** Once the chain shows the transaction failed, answer `invalid_transaction_state` and keep that answer
for every later retry.

## F9
**What failed.** A 503, an HTML or other non-JSON page, or a truncated `/settle` body was credited, or the payment
couldn't be retried afterwards.
**How to fix it.** Check the status code, the content type and that the body parses before reading `success`. A 5xx
with a success-looking body is still a failure. Keep the payment retryable so a later well-formed answer credits it
exactly once.

## FX
**What failed.** A fault-injected facilitator double passed every check, so the suite would have missed that fault.
This is a bug in the suite, not in your code.
**How to fix it.** Open an issue with the `offline.json` output. Don't rely on that run's other results.

## R0
**What failed.** An unpaid request to your paid route didn't get a 402 with a decodable `PAYMENT-REQUIRED` header naming
Solana devnet.
**How to fix it.** Make sure the probe reaches the paid route, the server is configured for Solana devnet while
testing, and the middleware sets the header. Fix this first: the R1-R9 results depend on it.

## R1
**What failed.** A request with a payment the double settled successfully wasn't served.
**How to fix it.** Your server must use `X402_FACILITATOR_URL` as its facilitator so the probe's double answers.
Without a served success, R2-R9 prove nothing.

## R2
**What failed.** The same payment presented twice was served twice (F3).
**How to fix it.** Reject a payment whose transaction you've already served, or rely on the facilitator's
`duplicate_settlement` answer and never serve on it.

## R3
**What failed.** Your route served content when `/settle` timed out (F6).
**How to fix it.** Serve only after a well-formed `success: true`. On a timeout, answer 402 or 5xx and let the client
retry.

## R4
**What failed.** Your route served content when `/settle` answered an HTML 502 (F6).
**How to fix it.** Treat any non-2xx or non-JSON answer as not settled.

## R5
**What failed.** Your route served content when `/settle` answered 503 with a body that says `success: true` (F9).
**How to fix it.** Check the status code before the body. A 5xx is never a settlement.

## R6
**What failed.** Your route served content when `/settle` answered 200 with a non-JSON body (F9).
**How to fix it.** Parse the body strictly and treat a parse error as not settled.

## R7
**What failed.** Your route served content when the `/settle` body was truncated (F9).
**How to fix it.** Same as R6: a body that doesn't parse completely is not a settlement.

## R8
**What failed.** Your route served content on `settlement_pending`, before the payment was final (F5).
**How to fix it.** `settlement_pending` is non-terminal. Don't serve yet. Keep the transaction, and either retry
`/settle` with the same body until it's final or answer without content and let the client retry.

## R9
**What failed.** Your route served content when `/settle` answered `invalid_transaction_state` (F8).
**How to fix it.** Treat every `success: false` answer as not paid, whatever its error code.
