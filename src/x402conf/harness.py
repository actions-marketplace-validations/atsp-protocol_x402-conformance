"""The checks.

Live checks (S1-S4) read a facilitator's public GET /supported and nothing else: no signing, no payment, no POST.
Offline checks (F1-F6) drive a facilitator implementation in-process through /verify and /settle semantics and test
the safety properties a resource server depends on. On devnet they run only against a facilitator its operator
points the suite at."""

from __future__ import annotations

import json
import time
import urllib.request
from collections.abc import Callable
from typing import Any

from . import spec as S
from .mock import Vectors
from .types import CheckResult, Facilitator, Json, Severity

MAX_BYTES = 1 << 20
UA = "x402-conformance/0.1.0 (+https://github.com/atsp-protocol/x402-conformance)"
Opener = Callable[..., Any]


def result(check: str, ok: bool, detail: Any, severity: Severity = "error") -> CheckResult:
    return {"check": check, "pass": bool(ok), "severity": severity, "detail": detail}


# ---------------- live, GET only ----------------
def fetch_supported(base: str, timeout: float = 10, opener: Opener | None = None) -> Json:
    url = base.rstrip("/") + "/supported"
    req = urllib.request.Request(url, method="GET", headers={"accept": "application/json", "user-agent": UA})
    t0 = time.time()
    with (opener or urllib.request.urlopen)(req, timeout=timeout) as r:
        body: bytes = r.read(MAX_BYTES + 1)
        status = int(r.status)
    if len(body) > MAX_BYTES:
        raise ValueError("response larger than 1 MiB")
    return {"url": url, "status": status, "ms": int((time.time() - t0) * 1000), "raw": body, "json": json.loads(body)}


def check_supported(doc: Json) -> list[CheckResult]:
    out: list[CheckResult] = []
    kinds, ext, signers = doc.get("kinds"), doc.get("extensions"), doc.get("signers")
    shape = isinstance(kinds, list) and isinstance(ext, list) and isinstance(signers, dict)
    out.append(result("S1 SupportedResponse shape: kinds[], extensions[], signers{} (V2 7.3.1)", shape,
                      {"kinds": type(kinds).__name__, "extensions": type(ext).__name__, "signers": type(signers).__name__}))
    klist: list[Json] = [k for k in kinds if isinstance(k, dict)] if isinstance(kinds, list) else []
    v2 = [k for k in klist if k.get("x402Version") == S.X402_VERSION]
    v1 = [k for k in klist if k.get("x402Version") == 1]
    bad_net = [k.get("network") for k in v2 if not S.CAIP2.match(str(k.get("network", "")))]
    out.append(result("S2 every V2 kind names its network in CAIP-2 (V2 11.1)", not bad_net,
                      {"v2_kinds": len(v2), "v1_kinds": len(v1), "non_caip2": bad_net[:10]}))
    sol = [k for k in v2 if str(k.get("network", "")).startswith("solana:")]
    v1names = [k.get("network") for k in v2 if k.get("network") in S.SOLANA_V1_NAMES]
    unknown = [k.get("network") for k in sol if k.get("network") not in (S.SOLANA_MAINNET, S.SOLANA_DEVNET)]
    out.append(result("S3 Solana V2 kinds use the published CAIP-2 IDs, not V1 names", not v1names and not unknown,
                      {"solana_v2_kinds": [[k.get("scheme"), k.get("network")] for k in sol],
                       "v1_names_in_v2": v1names, "unrecognised_solana_ids": unknown}))
    sol_signers: list[Any] = []
    if isinstance(signers, dict) and isinstance(signers.get("solana:*"), list):
        sol_signers = signers["solana:*"]
    exact = [k for k in sol if k.get("scheme") == "exact"]
    probs: list[Json] = []
    for k in exact:
        fp = (k.get("extra") or {}).get("feePayer")
        if not S.is_solana_pubkey(fp):
            probs.append({"network": k.get("network"), "problem": "extra.feePayer missing or not a 32-byte base58 key"})
        elif fp not in sol_signers:
            probs.append({"network": k.get("network"), "problem": "feePayer not listed in signers['solana:*']",
                          "feePayer": fp})
    out.append(result("S4 Solana exact kinds advertise a valid extra.feePayer that is a listed signer (SVM exact)",
                      not probs, {"solana_exact_kinds": len(exact), "problems": probs},
                      severity="error" if exact else "info"))
    return out


def run_live(base: str, *, timeout: float = 10, opener: Opener | None = None) -> Json:
    try:
        r = fetch_supported(base, timeout=timeout, opener=opener)
    except Exception as e:  # noqa: BLE001  a network or JSON failure is itself a result
        return {"target": base, "mode": "live-GET-only", "error": repr(e)[:200], "checks": []}
    ok_body = r["status"] == 200 and isinstance(r["json"], dict)
    return {"target": base, "mode": "live-GET-only", "http": r["status"], "ms": r["ms"],
            "checks": check_supported(r["json"]) if ok_body else [],
            "kinds_total": len(r["json"].get("kinds") or []) if ok_body else None, "raw": r["raw"]}


# ---------------- offline safety checks ----------------
def _success(resp: Any) -> bool:
    return isinstance(resp, dict) and resp.get("success") is True


def check_safety(fac: Facilitator, mk: Vectors) -> list[CheckResult]:
    out: list[CheckResult] = []
    req, good = mk("req"), mk("good")
    try:
        v: Any = fac.verify(mk("malformed"), req)
        ok = isinstance(v, dict) and v.get("isValid") is False
    except Exception:  # noqa: BLE001  raising is closed, not open
        ok, v = True, "raised"
    out.append(result("F1 malformed payload: /verify returns isValid=false (fails closed)", ok, {"got": v}))
    v = fac.verify(mk("dust"), req)
    out.append(result("F2 amount below PaymentRequirements.amount is rejected (SVM exact 1.1)",
                      isinstance(v, dict) and v.get("isValid") is False, {"got": v}))
    a, b = fac.settle(good, req), fac.settle(good, req)
    out.append(result("F3 the same payload settled twice succeeds at most once (duplicate_settlement)",
                      _success(a) + _success(b) <= 1, {"first": a, "second": b}))
    c = fac.settle(mk("same_memo_new_tx"), req)
    out.append(result("F4 replay of a used memo/nonce in a new transaction is rejected", not _success(c), {"got": c}))
    d = fac.settle(mk("unfinalized"), req)
    pend_ok = not _success(d) and (not isinstance(d, dict) or d.get("errorReason") != S.SETTLEMENT_PENDING
                                   or bool(d.get("transaction")))
    out.append(result("F5 unconfirmed settlement is not success; settlement_pending carries a transaction (V2 9)",
                      pend_ok, {"got": d}))
    rs = ResourceServerGuard(fac)
    e = rs.settle_and_credit(mk("fresh"), req, simulate="timeout")
    f = rs.settle_and_credit(mk("fresh2"), req, simulate="garbage")
    out.append(result("F6 facilitator timeout or malformed response: resource server does not credit (fail closed)",
                      e is False and f is False, {"timeout_credit": e, "garbage_credit": f}))
    return out


class ResourceServerGuard:
    """The credit rule the suite checks and lean/X402Conformance/Settlement.lean models: credit exactly once, only on
    success=true with a transaction, keyed by the transaction; never on an exception, timeout or malformed body."""

    def __init__(self, fac: Facilitator) -> None:
        self.fac = fac
        self.credited: set[str] = set()

    def settle_and_credit(self, payload: Any, req: Json, simulate: str | None = None) -> bool:
        try:
            if simulate == "timeout":
                raise TimeoutError("facilitator did not answer")
            resp: Any = "<html>502</html>" if simulate == "garbage" else self.fac.settle(payload, req)
        except Exception:  # noqa: BLE001
            return False
        if not (isinstance(resp, dict) and resp.get("success") is True and isinstance(resp.get("transaction"), str)
                and resp["transaction"]):
            return False
        if resp["transaction"] in self.credited:
            return False
        self.credited.add(resp["transaction"])
        return True
