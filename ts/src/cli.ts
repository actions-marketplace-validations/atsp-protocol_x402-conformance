#!/usr/bin/env node
// x402conf-svm probe --resource <url> [--port 4402] [--start "<command>"] [--network auto|<CAIP-2>] [--out file] [--share]
// x402conf-svm resource --url <url> [--out file] [--share]   (P1-P5, one unpaid GET)
// Starts the facilitator double on 127.0.0.1:<port>, optionally starts your resource server with
// X402_FACILITATOR_URL pointing at it, waits for the resource to answer, runs R0-R10.
// Exit codes: 0 all pass; 1 a check failed; 2 usage error, or the run could not be completed (port taken, server
// exited or never answered); 3 unsupported (the server offers no network the probe can grade).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { NETWORKS, PortInUseError, startDouble, type Network } from "./double.js";
import { probe, type Result } from "./probe.js";
import { anonymise, funnelFooter, shareUrl } from "./corpus.js";
import { makeReport, VIAS, type Kind, type Via } from "./report.js";
import { checkPaymentRequired } from "./resource.js";

export const VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

const USAGE = `x402conf-svm ${VERSION}: resource-server checks R0-R10 for x402 V2 servers (Solana devnet, Base Sepolia)

usage:
  x402conf-svm probe --resource <url> [--port 4402] [--start "<command>"] [--network auto|${NETWORKS.join("|")}] [--out file] [--share]
  x402conf-svm resource --url <url> [--out file] [--share]
  x402conf-svm --help | --version

  --resource  your paid route, e.g. http://127.0.0.1:4020/paid
  --port      loopback port for the facilitator double (default 4402)
  --start     command that starts your server; it gets X402_FACILITATOR_URL and must use it as its facilitator
  --network   which offered network to pay on (default auto: the first of ${NETWORKS.join(", ")})
  --out       also write the results JSON here (written on errors too)
  --url       (resource) a paid URL; one unpaid GET checks its 402 answer (P1-P5), on any network
  --share     opt-in: also write an anonymised corpus case next to --out (or ./x402-conformance-case.json) and print
              a link to a pre-filled GitHub issue. Nothing is sent; you review the case and submit it yourself.

Every run's JSON has the same check IDs and report fields as the Python CLI, the Action, the test matchers, the MCP
server and the Docker image. X402CONF_VIA names the entry point in the report and User-Agent (no telemetry).
exit codes: 0 all pass, 1 a check failed, 2 usage error or the run could not complete,
            3 unsupported (the server offers no network the probe grades)`;

const FLAGS = new Set(["--resource", "--port", "--start", "--out", "--network", "--url"]);
const BOOL = new Set(["--share"]);

class RunError extends Error {}

function parse(argv: string[]): Record<string, string> | number {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  if (argv.includes("--version") || argv.includes("-V")) { console.log(VERSION); return 0; }
  if (argv[0] !== "probe" && argv[0] !== "resource") { console.error(USAGE); return 2; }
  const o: Record<string, string> = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (BOOL.has(k)) { o[k.slice(2)] = "1"; i -= 1; continue; }
    if (!FLAGS.has(k) || v === undefined || v.startsWith("--")) {
      console.error(`x402conf-svm: unknown or incomplete option ${k}\n\n${USAGE}`);
      return 2;
    }
    o[k.slice(2)] = v;
  }
  if (o.cmd === "resource") {
    if (!o.url || o.resource || o.start || o.port || o.network) {
      console.error(`x402conf-svm: resource takes --url (and optionally --out, --share)\n\n${USAGE}`);
      return 2;
    }
    return o;
  }
  if (o.url) { console.error(`x402conf-svm: probe takes --resource, not --url\n\n${USAGE}`); return 2; }
  if (!o.resource) { console.error(`x402conf-svm: --resource is required\n\n${USAGE}`); return 2; }
  if (o.network && o.network !== "auto" && !(NETWORKS as readonly string[]).includes(o.network)) {
    console.error(`x402conf-svm: --network must be auto or one of ${NETWORKS.join(", ")}`);
    return 2;
  }
  if (o.port && !/^\d+$/.test(o.port)) { console.error("x402conf-svm: --port must be a number"); return 2; }
  return o;
}

async function answers(url: string, ms: number): Promise<boolean> {
  try { await fetch(url, { signal: AbortSignal.timeout(ms) }); return true; } catch { return false; }
}

function stop(child: ChildProcess | null) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}

function via(): Via {
  const v = process.env.X402CONF_VIA as Via | undefined;
  return v && VIAS.includes(v) ? v : "cli-ts";
}

// Writes --out, and with --share the anonymised case; prints the JSON, then the funnel footer on stderr.
function finish(o: Record<string, string>, kind: Kind, target: string, results: Result[] | ReturnType<typeof makeReport>["results"],
    doc: Record<string, unknown>): void {
  const report = makeReport(kind, target, results, via(), doc.error as string | undefined);
  Object.assign(doc, { schema: report.schema, via: report.via, kind, summary: report.summary, links: report.links });
  const text = JSON.stringify(doc, null, 1);
  if (o.out) writeFileSync(o.out, text + "\n");
  console.log(text);
  if (o.share) {
    const c = anonymise(report);
    const path = o.out ? o.out.replace(/(\.json)?$/, ".case.json") : "x402-conformance-case.json";
    writeFileSync(path, JSON.stringify(c, null, 1) + "\n");
    const link = shareUrl(c);
    console.error(link ? `x402conf-svm: anonymised case written to ${path}. Review it, then submit it here (nothing was sent):\n${link}`
      : `x402conf-svm: nothing failed, so there is no case to share (${path} records the passing run).`);
  }
  console.error(funnelFooter(report));
}

async function resourceMain(o: Record<string, string>): Promise<number> {
  const report = await checkPaymentRequired(o.url, { via: via() });
  const doc: Record<string, unknown> = { tool: `x402-conformance-svm ${VERSION}`, run_at: report.run_at, target: o.url,
    mode: "resource-GET-only", checks: report.results };
  finish(o, "resource-402", o.url, report.results, doc);
  return report.summary.failed ? 1 : 0;
}

async function main(): Promise<number> {
  const o = parse(process.argv.slice(2));
  if (typeof o === "number") return o;
  if (o.cmd === "resource") return resourceMain(o);
  const resource = o.resource;
  const doc: Record<string, unknown> = { tool: `x402-conformance-svm ${VERSION}`, run_at: new Date().toISOString(), resource };
  let results: Result[] = [];
  let child: ChildProcess | null = null;
  let exited: string | null = null;
  let double: Awaited<ReturnType<typeof startDouble>> | null = null;
  try {
    if (o.start && await answers(resource, 1500)) {
      throw new RunError(`something is already answering at ${resource} before --start ran; refusing to probe a server ` +
        "this run did not start. Stop it or use a free port.");
    }
    try {
      double = await startDouble(Number(o.port ?? "4402"));
    } catch (e) {
      throw new RunError(e instanceof PortInUseError ? e.message : `facilitator double failed to start: ${e}`);
    }
    doc.facilitator_double = double.url;
    if (o.start) {
      child = spawn(o.start, { shell: true, stdio: "inherit", detached: true,
        env: { ...process.env, X402_FACILITATOR_URL: double.url } });
      child.on("exit", (code, sig) => { exited = `your server (--start) exited with ${sig ?? `code ${code}`}`; });
      child.on("error", (e) => { exited = `your server (--start) could not start: ${e.message}`; });
    }
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      if (exited) throw new RunError(`${exited} before it answered at ${resource}`);
      up = await answers(resource, 2000);
      if (!up) await new Promise((ok) => setTimeout(ok, 1000));
    }
    if (exited) throw new RunError(`${exited} before it answered at ${resource}`);
    if (!up) throw new RunError(`no answer from ${resource} within 60 s`);
    const net = o.network as Network | "auto" | undefined;
    results = await probe(resource, double, { network: net, via: via() });
    if (exited) throw new RunError(`${exited} during the probe; the results are not trustworthy`);
  } catch (e) {
    doc.error = e instanceof RunError ? e.message : `the probe crashed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    stop(child);
    await double?.close();
  }
  doc.results = results;
  finish(o, "resource-server", resource, results, doc);
  if (doc.error) { console.error(`x402conf-svm: ${doc.error}`); return 2; }
  if (results.some((r) => r.status === "unsupported")) return 3;
  return results.every((r) => r.pass) ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
