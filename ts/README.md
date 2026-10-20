# x402-conformance-svm

The TypeScript runner for resource servers built on `@x402/core` and `@x402/svm`. It starts a facilitator double on
loopback, points your server at it through `X402_FACILITATOR_URL`, and requests your paid route under each fault:

| id | what the double does on `/settle` | your server must |
|---|---|---|
| R0 | (unpaid request) | answer 402 with a `PAYMENT-REQUIRED` header offering Solana devnet |
| R1 | settles | serve the content |
| R2 | settles once, then `duplicate_settlement` | serve the same payment at most once (F3) |
| R3 | never answers | not serve (F6) |
| R4 | HTML 502 | not serve (F6) |
| R5 | 503 with a body that reads as success | not serve (F9) |
| R6 | 200 with an HTML page | not serve (F9) |
| R7 | 200 with half a success body | not serve (F9) |
| R8 | `settlement_pending` with a transaction | not serve before the payment is final (F5) |
| R9 | `invalid_transaction_state` | not serve (F8) |

```
npm ci && npm run build
node dist/src/cli.js probe --resource http://127.0.0.1:4020/paid --start "node your-server.js" --out results.json
```

It exits 0 only if R0 to R9 all pass. In GitHub Actions use the action at the repository root:

```yaml
- uses: atsp-protocol/x402-conformance@v1
  with:
    resource-url: http://127.0.0.1:4020/paid
    start: node server.js
```

`example/server.ts` is a resource server on `x402HTTPResourceServer` that passes; `npm test` also shows that a server
which serves after `/verify`, or whatever `/settle` answers, fails R2 to R9. The double never touches a chain, a key
or anything beyond loopback.
