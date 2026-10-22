// Turning a failing run into a public corpus case, opt-in only. Nothing here sends anything: shareUrl() returns a link
// to a pre-filled GitHub issue form that a person reviews and submits themselves. anonymise() removes what identifies
// the seller or the deployment (URLs, hosts, addresses, long hex and base58 strings) and keeps what makes the case
// reproducible (check IDs, statuses, the shape of the answer, versions and the stack the person names).
import { LINKS, REPO, VERSION, checkId, type Report, type Via } from "./report.js";

export const CASE_SCHEMA = "x402-conformance.case/1";
export interface Stack { framework?: string; sdk?: string; sdk_version?: string; network?: string; language?: string }
export interface CorpusCase {
  schema: typeof CASE_SCHEMA;
  tool_version: string;
  via: Via;
  kind: Report["kind"];
  target: "loopback" | "redacted";
  stack: Stack;
  failed_ids: string[];
  results: { id: string; check: string; status: string; severity: string; detail: unknown }[];
}

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const EVM_RE = /\b0x[0-9a-fA-F]{16,}\b/g;
const B58_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g;
const HOST_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|xyz|ai|app|dev|co|cloud|sh|gg|so|me|tech)\b/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
// Public identifiers every x402 deployment shares: CAIP-2 network IDs and the test USDC assets. Kept, they are not
// about the seller and they make a case reproducible.
const KEEP = new Set(["EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"]);
const SENSITIVE_KEYS = new Set(["payTo", "pay_to", "resource", "url", "payer", "from", "to", "transaction",
  "signature", "nonce", "facilitator", "facilitator_double", "authorization", "cookie", "host"]);

function scrubString(s: string): string {
  return s.replace(URL_RE, "<url>").replace(EVM_RE, (m) => (KEEP.has(m) ? m : "<hex>"))
    .replace(B58_RE, (m) => (KEEP.has(m) ? m : "<base58>")).replace(IP_RE, "<ip>").replace(HOST_RE, "<host>");
}

export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 8) return "<truncated>";
  if (typeof v === "string") return scrubString(v).slice(0, 300);
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SENSITIVE_KEYS.has(k) ? "<redacted>" : scrub(x, depth + 1);
    return o;
  }
  return v;
}

const loopback = (t: string): boolean => {
  try { return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(new URL(t).hostname); } catch { return false; }
};

/** An anonymised case built from a report. Passing checks are kept (as status only) so the case shows what held. */
export function anonymise(report: Report, stack: Stack = {}): CorpusCase {
  const clean: Stack = {};
  for (const [k, v] of Object.entries(stack)) if (typeof v === "string" && v) (clean as any)[k] = scrubString(v).slice(0, 80);
  return {
    schema: "x402-conformance.case/1", tool_version: report.version || VERSION, via: report.via, kind: report.kind,
    target: loopback(report.target) ? "loopback" : "redacted", stack: clean,
    failed_ids: report.summary.failed_ids,
    results: report.results.map((x) => ({ id: checkId(x.check), check: x.check, status: x.status, severity: x.severity,
      detail: x.pass ? null : scrub(x.detail) })),
  };
}

/**
 * A link to the "corpus case" issue form, pre-filled with the anonymised case. The person opening it reads the case,
 * edits it if they want, and decides whether to submit. Returns null when nothing failed: only failures are cases.
 */
export function shareUrl(c: CorpusCase): string | null {
  if (!c.failed_ids.length) return null;
  const caseJson = JSON.stringify(c, null, 1);
  const q = new URLSearchParams({
    template: "corpus-case.yml",
    title: `[corpus] ${c.failed_ids.join(", ")} via ${c.via}${c.stack.framework ? ` on ${c.stack.framework}` : ""}`,
    labels: "corpus-case",
    via: c.via,
    checks: c.failed_ids.join(", "),
    stack: Object.entries(c.stack).map(([k, v]) => `${k}: ${v}`).join("\n"),
    // GitHub caps URLs at about 8 KB; a longer case is cut and the form asks for the full file to be attached.
    case: caseJson.length > 5000 ? caseJson.slice(0, 5000) + "\n... (cut; attach the full case file)" : caseJson,
  });
  return `${REPO}/issues/new?${q.toString()}`;
}

/** The footer every integration prints after a run: the corpus, how to contribute, and the badge. */
export function funnelFooter(report: Report): string {
  const lines = [`x402-conformance ${report.version} via ${report.via}. Corpus of known x402 failures: ${LINKS.corpus}`];
  if (report.summary.failed) lines.push(`Share this failure as an anonymised corpus case (opt-in, reviewed by you first): re-run with --share, or ${LINKS.contribute}`);
  else lines.push(`All checks passed. Add the badge to your README: ${LINKS.badge}`);
  lines.push(`Using it from other stacks: ${LINKS.using}`);
  return lines.join("\n");
}
