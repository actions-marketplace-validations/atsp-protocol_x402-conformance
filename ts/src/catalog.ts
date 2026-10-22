// Profile and spec basis for each resource-server check, the same labels as spec.CATALOG in the Python package
// (tests/test_offline.py checks they match). Evidence v2 puts them on every result.
export const EVIDENCE_FORMAT = "x402-conformance-evidence/2";
export const DOCS = "https://github.com/atsp-protocol/x402-conformance/blob/main/docs/FIXES.md#";
export const CATALOG: Record<string, { profile: string; basis: string }> = {
 "R0": {
  "profile": "normative",
  "basis": "V2 HTTP transport: an unpaid request gets 402 with PAYMENT-REQUIRED"
 },
 "R1": {
  "profile": "normative",
  "basis": "V2 7.2: the resource server settles through its facilitator"
 },
 "R2": {
  "profile": "normative",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R3": {
  "profile": "resilience",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R4": {
  "profile": "resilience",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R5": {
  "profile": "resilience",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R6": {
  "profile": "resilience",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R7": {
  "profile": "resilience",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R8": {
  "profile": "normative",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R9": {
  "profile": "normative",
  "basis": "F3, F5, F6, F8 and F9 applied to a running resource server"
 },
 "R10": {
  "profile": "normative",
  "basis": "V2 HTTP transport: settlement results go in PAYMENT-RESPONSE"
 },
 "R11": {
  "profile": "normative",
  "basis": "control: each route is served and settled once with its own payment"
 },
 "R11a": {
  "profile": "normative",
  "basis": "V2 5.2.2: accepted is matched against the route's own requirements"
 },
 "R11b": {
  "profile": "normative",
  "basis": "V2 5.1.2 and 9: recipient, asset and network must match"
 },
 "R11c": {
  "profile": "security-profile",
  "basis": "a route priced by method is priced for the method used"
 },
 "R11d": {
  "profile": "security-profile",
  "basis": "a route priced by query is priced for the query sent"
 },
 "R11e": {
  "profile": "security-profile",
  "basis": "payment middleware and framework must agree on the path"
 },
 "R11f": {
  "profile": "security-profile",
  "basis": "sign-in-with-x: access is for the requested resource the server priced and settled"
 }
};

/** The check id ("R11a") from a result's check text. */
export const checkId = (check: string): string => check.split(" ")[0].replace(/:$/, "");

/** A result labelled with its profile, spec basis and where to read the fix. */
export function label<T extends { check: string }>(r: T): T & { profile: string; basis: string; fix: string } {
  const id = checkId(r.check);
  const e = CATALOG[id] ?? { profile: "normative", basis: "" };
  return { ...r, profile: e.profile, basis: e.basis, fix: DOCS + id.toLowerCase() };
}
