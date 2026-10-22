// x402-conformance inside an existing test suite: vitest, jest or node:test. runConformance() starts the facilitator
// double, hands its URL to your server factory, runs R0-R10 and returns the shared report. The matchers follow the
// expect.extend contract that vitest and jest share; assertX402Conformance() is for node:test or any runner.
//
//   import { expect, test } from "vitest";
//   import { runConformance, x402Matchers } from "x402-conformance-svm/testing";
//   expect.extend(x402Matchers);
//   test("my paid route", async () => {
//     const report = await runConformance({ via: "vitest", start: (facilitatorUrl) => startMyServer(facilitatorUrl) });
//     expect(report).toPassX402Conformance();
//   }, 120_000);
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anonymise, funnelFooter, shareUrl, type Stack } from "./corpus.js";
import { startDouble, type Network } from "./double.js";
import { probe } from "./probe.js";
import { explain, makeReport, passed, type Report, type Via } from "./report.js";

export { checkPaymentRequired } from "./resource.js";
export { passed, explain, type Report } from "./report.js";

export interface StartedServer { url: string; close?: () => Promise<void> | void }
export interface RunOptions {
  /** Start your resource server with this facilitator URL and return its paid route. */
  start: (facilitatorUrl: string) => Promise<StartedServer> | StartedServer;
  network?: Network | "auto";
  deadlineMs?: number;
  /** Which runner this is, for the report and the User-Agent. Default "testing". */
  via?: Via;
}

/** R0-R10 against a server you start in-process. Never throws for a failing server: the report says what failed. */
export async function runConformance(opts: RunOptions): Promise<Report> {
  const via = opts.via ?? "testing";
  const double = await startDouble(0);
  let srv: StartedServer | undefined;
  try {
    srv = await opts.start(double.url);
    const results = await probe(srv.url, double, { network: opts.network, deadlineMs: opts.deadlineMs ?? 20_000, via });
    return makeReport("resource-server", srv.url, results, via);
  } catch (e) {
    return makeReport("resource-server", srv?.url ?? "(server did not start)", [], via,
      `the run could not complete: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  } finally {
    await srv?.close?.();
    await double.close();
  }
}

/**
 * Writes the report where CI can pick it up (X402CONF_REPORT_DIR, default ./x402-conformance), and with share=true
 * also an anonymised case plus the link to submit it. Returns the paths. Sends nothing.
 */
export function saveReport(report: Report, opts: { dir?: string; share?: boolean; stack?: Stack } = {}):
    { report: string; case?: string; shareUrl?: string | null } {
  const dir = opts.dir ?? process.env.X402CONF_REPORT_DIR ?? "x402-conformance";
  mkdirSync(dir, { recursive: true });
  const name = `${report.kind}-${report.via}-${report.run_at.replace(/[:.]/g, "-")}`;
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(report, null, 1) + "\n");
  if (!opts.share) return { report: path };
  const c = anonymise(report, opts.stack);
  const casePath = join(dir, `${name}.case.json`);
  writeFileSync(casePath, JSON.stringify(c, null, 1) + "\n");
  return { report: path, case: casePath, shareUrl: shareUrl(c) };
}

const isReport = (x: unknown): x is Report => !!x && typeof x === "object" && (x as any).schema === "x402-conformance.report/1";
const message = (r: Report) => `${explain(r)}\n${funnelFooter(r)}`;

export interface MatcherResult { pass: boolean; message: () => string }
type Ctx = { isNot?: boolean } | undefined;

export const x402Matchers = {
  /** Every check passed (warnings allowed) and the run completed. */
  toPassX402Conformance(this: Ctx, received: unknown): MatcherResult {
    if (!isReport(received)) return { pass: false, message: () => "expected an x402-conformance report (from runConformance or checkPaymentRequired)" };
    const ok = passed(received);
    return { pass: ok, message: () => (ok ? "expected the x402-conformance run to fail, but it passed\n" : "") + message(received) };
  },
  /** A report from checkPaymentRequired(): the unpaid answer is a well-formed x402 402 (P1-P7). */
  toBeValidX402Challenge(this: Ctx, received: unknown): MatcherResult {
    if (!isReport(received) || received.kind !== "resource-402") {
      return { pass: false, message: () => "expected a report from checkPaymentRequired()" };
    }
    const ok = passed(received);
    return { pass: ok, message: () => (ok ? "expected the 402 answer to be invalid, but P1-P7 passed\n" : "") + message(received) };
  },
};

export interface X402Matchers<R = unknown> {
  toPassX402Conformance(): R;
  toBeValidX402Challenge(): R;
}

/** For node:test or any runner without expect.extend: throws with the same message the matchers print. */
export function assertX402Conformance(report: Report): void {
  if (!passed(report)) throw new Error(message(report));
}
