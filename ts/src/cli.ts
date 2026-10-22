#!/usr/bin/env node
// x402conf-svm probe --resource <url> [--port 4402] [--start "<command>"] [--network auto|<CAIP-2>] [--out file] [--share]
// x402conf-svm resource --url <url> [--out file] [--share]   (P1-P5, one unpaid GET)
// Starts the facilitator double on 127.0.0.1:<port>, optionally starts your resource server with
// X402_FACILITATOR_URL pointing at it, waits for the resource to answer, runs R0-R10, and with the binding options
// R11 (payment-to-request binding). Every result carries its profile, spec basis and fix link (evidence v2).
// Exit codes: 0 all pass; 1 a check failed; 2 usage error, or the run could not be completed (port taken, server
// exited or never answered); 3 unsupported (the server offers no network the probe can grade).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { NETWORKS, PortInUseError, startDouble, type Network } from "./double.js";
import { probe, type Result } from "./probe.js";
import { anonymise, funnelFooter, shareUrl } from "./corpus.js";
import { makeReport, VIAS, type Kind, type Via } from "./report.js";
import { checkPaymentRequired } from "./resource.js";
import { probeBinding, type BindingTargets } from "./binding.js";
import { EVIDENCE_FORMAT, label } from "./catalog.js";
import { MOCK_FAULTS, startMockResource } from "./mock-server.js";
type Labelled = Result & { profile: string; basis: string; fix: string };

export const VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

const USAGE = `x402conf-svm ${VERSION}: resource-server checks R0-R11 for x402 V2 servers (Solana devnet, Base Sepolia)

usage:
  x402conf-svm probe --resource <url> [binding options] [--port 4402] [--start "<command>"]
                     [--network auto|${NETWORKS.join("|")}] [--out file] [--share]
  x402conf-svm probe <binding options> [--port 4402] [--start "<command>"] [--out file] [--share]
  x402conf-svm resource --url <url> [--out file] [--share]
  x402conf-svm demo [--fault ${MOCK_FAULTS.join("|")}] [--out file]
  x402conf-svm --help | --version

  demo              run R0-R10 against a bundled mock resource server and facilitator double on loopback: no project,
                    no wallet, no chain, well under a minute. --fault shows a failing run and its fix hints

  --resource        your paid route, e.g. http://127.0.0.1:4020/paid (R0-R10)
  binding options (R11; give at least --resource or one of these):
  --cheap, --expensive  two paid routes at different prices (R11 control, R11a, R11b)
  --by-method       a paid URL priced differently for GET and POST (R11c)
  --by-query        two paid URLs that differ only in the query, comma-separated (R11d)
  --param           a paid parameterised route with {id} for the parameter, e.g. http://host/items/{id}/premium (R11e)
  --siwx-cheap, --siwx-expensive  two paid routes at different prices that declare sign-in-with-x (R11f, EVM)
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

const BINDING = ["cheap", "expensive", "by-method", "by-query", "param", "siwx-cheap", "siwx-expensive"];
const FLAGS = new Set(["--resource", "--port", "--start", "--out", "--network", "--url", ...BINDING.map((b) => `--${b}`)]);
const BOOL = new Set(["--share"]);

function bindingTargets(o: Record<string, string>): BindingTargets | string | null {
  if (!BINDING.some((b) => o[b])) return null;
  if (!!o.cheap !== !!o.expensive) return "--cheap and --expensive go together";
  if (!!o["siwx-cheap"] !== !!o["siwx-expensive"]) return "--siwx-cheap and --siwx-expensive go together";
  if (o.param && !o.param.includes("{id}")) return "--param needs {id} where the parameter goes";
  const q = o["by-query"]?.split(",");
  if (q && q.length !== 2) return "--by-query takes two URLs, comma-separated";
  return { cheap: o.cheap, expensive: o.expensive, byMethod: o["by-method"], parameterised: o.param,
    byQuery: q as [string, string] | undefined,
    siwx: o["siwx-cheap"] ? { cheap: o["siwx-cheap"], expensive: o["siwx-expensive"] } : undefined };
}

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
    if (!o.url || o.resource || o.start || o.port || o.network || BINDING.some((b) => o[b])) {
      console.error(`x402conf-svm: resource takes --url (and optionally --out, --share)\n\n${USAGE}`);
      return 2;
    }
    return o;
  }
  if (o.url) { console.error(`x402conf-svm: probe takes --resource, not --url\n\n${USAGE}`); return 2; }
  const b = bindingTargets(o);
  if (typeof b === "string") { console.error(`x402conf-svm: ${b}`); return 2; }
  if (!o.resource && !b) { console.error(`x402conf-svm: give --resource or a binding option\n\n${USAGE}`); return 2; }
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

/** One line per check, a fix link under each failure. */
export function table(results: Labelled[]): string {
  const lines = results.map((r) => `  ${r.pass ? "pass" : r.status === "unsupported" ? "n/a " : "FAIL"}  ${r.check}` +
    (r.pass ? "" : `\n        fix: ${r.fix}`));
  const failed = results.filter((r) => !r.pass).length;
  return lines.join("\n") + `\n\n${results.length - failed}/${results.length} checks pass`;
}

async function demo(argv: string[]): Promise<number> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--fault", "--out"].includes(argv[i]) || argv[i + 1] === undefined) {
      console.error(`x402conf-svm: unknown or incomplete option ${argv[i]}\n\n${USAGE}`);
      return 2;
    }
    o[argv[i].slice(2)] = argv[i + 1];
  }
  if (o.fault && !(MOCK_FAULTS as readonly string[]).includes(o.fault)) {
    console.error(`x402conf-svm: --fault must be one of ${MOCK_FAULTS.join(", ")}`);
    return 2;
  }
  const t0 = Date.now();
  const double = await startDouble(0);
  const mock = await startMockResource(double.url, o.fault ?? "");
  let results: Labelled[];
  try {
    results = (await probe(mock.url, double, { network: "auto", deadlineMs: 10_000 })).map(label);
  } finally {
    await mock.close();
    await double.close();
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (o.out) {
    writeFileSync(o.out, JSON.stringify({ tool: `x402-conformance-svm ${VERSION}`, evidence: EVIDENCE_FORMAT,
      versions: { "x402-conformance-svm": VERSION, node: process.versions.node }, run_at: new Date().toISOString(),
      resource: "demo://bundled-mock" + (o.fault ? `?fault=${o.fault}` : ""), demo: true, seconds: Number(secs),
      results }, null, 1) + "\n");
  }
  console.log(`x402conf-svm ${VERSION} demo: a bundled mock resource server${o.fault ? ` (fault: ${o.fault})` : ""} ` +
    "behind a facilitator double on loopback. No wallet, no chain.\n");
  console.log(table(results) + ` in ${secs} s\n`);
  console.log("Next, point it at your own server (it gets X402_FACILITATOR_URL and must use it):\n" +
    "  npx x402-conformance-svm probe --resource http://127.0.0.1:4020/paid --start \"node server.js\"");
  return results.every((r) => r.pass) ? 0 : 1;
}

async function main(): Promise<number> {
  if (process.argv[2] === "demo") return demo(process.argv.slice(3));
  const o = parse(process.argv.slice(2));
  if (typeof o === "number") return o;
  if (o.cmd === "resource") return resourceMain(o);
  const binding = bindingTargets(o) as BindingTargets | null;
  const resource = o.resource ?? binding?.cheap ?? binding?.byMethod ?? binding?.byQuery?.[0] ?? binding?.siwx?.cheap
    ?? binding?.parameterised?.replace("{id}", "1") ?? "";
  const doc: Record<string, unknown> = { tool: `x402-conformance-svm ${VERSION}`, evidence: EVIDENCE_FORMAT,
    versions: { "x402-conformance-svm": VERSION, node: process.versions.node }, run_at: new Date().toISOString(),
    resource: o.resource ?? null, ...(binding ? { binding } : {}) };
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
    if (o.resource) results = await probe(o.resource, double, { network: net, via: via() });
    if (binding) {
      const offered = results.find((r) => r.check.startsWith("R0"))?.detail as any;
      const bnet = (o.network && o.network !== "auto" ? o.network : offered?.network) as string | undefined;
      results = results.concat(await probeBinding(binding, double, bnet));
    }
    if (exited) throw new RunError(`${exited} during the probe; the results are not trustworthy`);
  } catch (e) {
    doc.error = e instanceof RunError ? e.message : `the probe crashed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    stop(child);
    await double?.close();
  }
  doc.results = results.map(label);
  finish(o, "resource-server", resource, doc.results as Labelled[], doc);
  if (doc.error) { console.error(`x402conf-svm: ${doc.error}`); return 2; }
  if (results.some((r) => r.status === "unsupported")) return 3;
  return results.every((r) => r.pass) ? 0 : 1;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
