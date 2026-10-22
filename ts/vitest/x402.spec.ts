// The vitest quickstart from docs/USING.md, run in CI. Copy it into your project and swap startStockHono for your own
// server factory: it receives the facilitator double's URL and returns your paid route.
import { describe, expect, test } from "vitest";
import { checkPaymentRequired, runConformance, x402Matchers, type X402Matchers } from "x402-conformance-svm/testing";
import { startStockHono } from "../dist/example/hono-server.js";
import { startExample } from "../dist/example/server.js";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends X402Matchers<T> {}
}
expect.extend(x402Matchers);

describe("x402 conformance in vitest", () => {
  test("my paid route passes R0-R10", async () => {
    const report = await runConformance({ via: "vitest", start: (facilitatorUrl) => startStockHono(facilitatorUrl) });
    expect(report).toPassX402Conformance();
  });

  test("my 402 answer is well formed (P1-P7)", async () => {
    const { startDouble } = await import("x402-conformance-svm");
    const double = await startDouble(0);
    const server = await startStockHono(double.url);
    try {
      expect(await checkPaymentRequired(server.url, { via: "vitest" })).toBeValidX402Challenge();
    } finally {
      await server.close();
      await double.close();
    }
  });

  test("a server that serves whatever /settle answers fails, and .not works", async () => {
    const report = await runConformance({ via: "vitest", start: (f) => startExample(f, "serve_on_any_settle") });
    expect(report).not.toPassX402Conformance();
    expect(() => expect(report).toPassX402Conformance()).toThrow(/how to fix: .*FIXES\.md#r3/);
  });
});
