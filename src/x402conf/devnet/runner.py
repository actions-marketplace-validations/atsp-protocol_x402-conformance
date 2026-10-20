"""Devnet runner: F1-F6 over real x402 V2 HTTP /verify and /settle on Solana devnet.

    python -m x402conf.devnet.runner [--facilitator URL] [--operator-permission REF] [--faults] [--evidence DIR]

Without --facilitator it starts the self-hosted reference facilitator in node/ (the open-source @x402/core facilitator
with the @x402/svm exact scheme) on loopback. With --faults it also starts one fault-injected build per check it can
break and records whether the check catches it. A facilitator that is not on loopback is refused unless
--operator-permission names the operator's written permission (owner rule: devnet only, run by me or with the
operator's permission).

Payments are throwaway devnet keypairs paying a throwaway devnet test token, with fees in devnet faucet SOL. Keys live in
X402C_KEYS, outside the repository, and nothing here reads, prints or stores them. The RPC calls the runner makes itself
are reads (getGenesisHash, getSignatureStatuses, getTokenAccountBalance); only the facilitator under test submits
transactions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any, Protocol

from .. import __version__
from .. import spec as S
from ..harness import UA, ResourceServerGuard, result
from ..types import CheckResult, Json

NODE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "node")
DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
AMOUNT = "10000"
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
FAULTS = {"open_on_malformed": "F1", "accept_dust": "F2", "success_unsent": "F5"}


class Refused(Exception):
    """A run the owner rules do not allow."""


class Payer(Protocol):
    def build(self, requirements: Json) -> Json: ...


class ChainView(Protocol):
    def status(self, sig: str) -> str | None: ...

    def balance(self, token_account: str) -> int: ...


def _post(url: str, body: Json, timeout: float) -> Any:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "accept": "application/json", "user-agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read(1 << 20))
    except urllib.error.HTTPError as e:
        # A 4xx with a JSON body is an answer (for example isValid=false); anything else is a transport failure.
        raw = e.read(1 << 20)
        try:
            return json.loads(raw)
        except ValueError:
            raise e from None


def check_target(url: str, permission: str | None) -> None:
    host = urllib.parse.urlsplit(url).hostname or ""
    if host not in LOOPBACK and not permission:
        raise Refused(f"{url} is not a facilitator I run; pass --operator-permission with the operator's written permission")


class HttpFacilitator:
    """A facilitator over x402 V2 HTTP: POST /verify and /settle with {x402Version, paymentPayload, paymentRequirements}.
    Only Solana devnet requirements are ever sent."""

    def __init__(self, base: str, timeout: float = 90, permission: str | None = None) -> None:
        check_target(base, permission)
        self.base, self.timeout = base.rstrip("/"), timeout

    def _call(self, path: str, payload: Any, req: Json) -> Any:
        if req.get("network") != S.SOLANA_DEVNET:
            raise Refused("devnet only")
        return _post(self.base + path, {"x402Version": S.X402_VERSION, "paymentPayload": payload, "paymentRequirements": req},
                     self.timeout)

    def verify(self, payload: Any, requirements: Json) -> Any:
        return self._call("/verify", payload, requirements)

    def settle(self, payload: Any, requirements: Json) -> Any:
        return self._call("/settle", payload, requirements)

    def supported(self) -> Json:
        with urllib.request.urlopen(urllib.request.Request(self.base + "/supported", headers={"user-agent": UA}),
                                    timeout=30) as r:
            data: Json = json.loads(r.read(1 << 20))
            return data


class RpcChain:
    """Read-only Solana JSON-RPC view, devnet checked by genesis hash."""

    def __init__(self, url: str) -> None:
        self.url = url
        if self._rpc("getGenesisHash", []) != DEVNET_GENESIS:
            raise Refused(f"{url} is not Solana devnet")

    def _rpc(self, method: str, params: list[Any], retries: int = 8) -> Any:
        # Public devnet RPCs rate-limit; retry 429, 5xx and timeouts with exponential backoff.
        for attempt in range(retries + 1):
            try:
                out = _post(self.url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, 30)
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504) or attempt == retries:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == retries:
                    raise
            else:
                err = out.get("error") if isinstance(out, dict) else None
                limited = isinstance(err, dict) and err.get("code") in (429, -32429)
                if not limited or attempt == retries:
                    break
            time.sleep(min(0.5 * 2 ** attempt, 15.0))
        if "error" in out:
            raise RuntimeError(f"{method}: {out['error']}")
        return out["result"]

    def status(self, sig: str) -> str | None:
        v = self._rpc("getSignatureStatuses", [[sig], {"searchTransactionHistory": True}])["value"][0]
        if v is None:
            return None
        return "failed" if v.get("err") else str(v.get("confirmationStatus"))

    def balance(self, token_account: str) -> int:
        return int(self._rpc("getTokenAccountBalance", [token_account])["value"]["amount"])


class NodePayer:
    """Builds signed exact payloads with the open-source @x402/svm client (node/payer.mjs)."""

    def __init__(self, env: dict[str, str]) -> None:
        self.env = env

    def build(self, requirements: Json) -> Json:
        p = subprocess.run(["node", "--no-warnings", "payer.mjs", json.dumps(requirements)], cwd=NODE_DIR, env=self.env,
                           capture_output=True, text=True, timeout=120)
        if p.returncode:
            raise RuntimeError(f"payer failed: {p.stderr[-300:]}")
        out: Json = json.loads(p.stdout.strip().splitlines()[-1])
        return out


def _ok(resp: Any) -> bool:
    return isinstance(resp, dict) and resp.get("success") is True


def _invalid(resp: Any) -> bool:
    return isinstance(resp, dict) and resp.get("isValid") is False


def _distinct(payer: Payer, req: Json, other: Json, tries: int = 10) -> Json:
    """A payload whose transaction differs from other's (a later blockhash)."""
    for _ in range(tries):
        p = payer.build(req)
        if p["payload"]["transaction"] != other["payload"]["transaction"]:
            return p
        time.sleep(1.0)
    raise RuntimeError("could not build a distinct transaction")


def run_checks(fac: HttpFacilitator, payer: Payer, chain: ChainView, req: Json, pay_to_account: str,
               only: set[str] | None = None, slow: Callable[[], HttpFacilitator] | None = None,
               settle_wait: float = 15) -> list[CheckResult]:
    """F1-F6 against a real facilitator. `slow` returns an adapter with a deadline too short to get an answer (F6)."""
    out: list[CheckResult] = []

    def want(c: str) -> bool:
        return only is None or c in only

    amount = int(req["amount"])
    if want("F1"):
        good = payer.build(req)
        bad = dict(good, payload={"transaction": "bm90IGEgdHJhbnNhY3Rpb24="})
        v = fac.verify(bad, req)
        out.append(result("F1 malformed payload: /verify returns isValid=false (fails closed)", _invalid(v), {"got": v}))
    if want("F2"):
        dust = payer.build(dict(req, amount="1"))
        v = fac.verify(dict(dust, accepted=req), req)
        out.append(result("F2 amount below PaymentRequirements.amount is rejected (SVM exact 1.1)", _invalid(v), {"got": v}))
    if want("F3"):
        p = payer.build(req)
        b0 = chain.balance(pay_to_account)
        a, b = fac.settle(p, req), fac.settle(p, req)
        delta = chain.balance(pay_to_account) - b0
        out.append(result("F3 the same payload settled twice succeeds at most once (duplicate_settlement)",
                          _ok(a) + _ok(b) <= 1 and delta <= amount,
                          {"first": a, "second": b, "recipient_delta": delta}))
    if want("F4"):
        memo = "x402c-f4-" + secrets.token_hex(8)
        r4 = dict(req, extra=dict(req["extra"], memo=memo))
        p1 = payer.build(r4)
        p2 = _distinct(payer, r4, p1)
        b0 = chain.balance(pay_to_account)
        first, second = fac.settle(p1, r4), fac.settle(p2, r4)
        delta = chain.balance(pay_to_account) - b0
        out.append(result("F4 replay of a used memo/nonce in a new transaction is rejected", not _ok(second),
                          {"memo": memo, "first": first, "second": second, "recipient_delta": delta}))
    if want("F5"):
        p = payer.build(req)
        d = fac.settle(p, req)
        tx = d.get("transaction") if isinstance(d, dict) else None
        st = chain.status(tx) if isinstance(tx, str) and tx else None
        if _ok(d):
            ok = st in ("confirmed", "finalized")
        else:
            ok = not (isinstance(d, dict) and d.get("errorReason") == S.SETTLEMENT_PENDING and not tx)
        out.append(result("F5 unconfirmed settlement is not success; settlement_pending carries a transaction (V2 9)",
                          ok, {"got": d, "chain_status_at_answer": st}))
    if want("F6"):
        guard = ResourceServerGuard(slow() if slow else fac)
        p = payer.build(req)
        b0 = chain.balance(pay_to_account)
        e = guard.settle_and_credit(p, req)
        f = ResourceServerGuard(fac).settle_and_credit(payer.build(req), req, simulate="garbage")
        time.sleep(settle_wait)
        landed = chain.balance(pay_to_account) - b0
        retry = ResourceServerGuard(fac)
        later = [retry.settle_and_credit(p, req) for _ in range(2)]
        out.append(result("F6 facilitator timeout or malformed response: resource server does not credit (fail closed)",
                          e is False and f is False and sum(later) <= 1,
                          {"timeout_credit": e, "garbage_credit": f, "paid_on_chain_after_timeout": landed,
                           "retry_credits": later}))
    return out


def _spawn(env: dict[str, str], port: int, fault: str = "") -> subprocess.Popen[str]:
    e = dict(env, X402C_FAULT=fault)
    proc = subprocess.Popen(["node", "--no-warnings", "facilitator.mjs", str(port)], cwd=NODE_DIR, env=e,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    line = proc.stdout.readline() if proc.stdout else ""
    if not line.startswith("{"):
        proc.kill()
        raise RuntimeError(f"facilitator did not start: {line}{proc.stderr.read()[-300:] if proc.stderr else ''}")
    return proc


def _state(keys: str) -> Json:
    with open(os.path.join(keys, "devnet-state.json")) as f:
        data: Json = json.load(f)
    return data


def requirements(state: Json, fee_payer: str) -> Json:
    return {"scheme": "exact", "network": S.SOLANA_DEVNET, "asset": state["mint"], "amount": AMOUNT,
            "payTo": state["payTo"], "maxTimeoutSeconds": 60, "extra": {"feePayer": fee_payer}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="x402conf devnet")
    ap.add_argument("--facilitator", help="base URL; default: start the self-hosted reference on loopback")
    ap.add_argument("--operator-permission", help="reference to the operator's written permission (required off loopback)")
    ap.add_argument("--rpc", default=os.environ.get("X402C_RPC", "https://api.devnet.solana.com"))
    ap.add_argument("--keys", default=os.environ.get("X402C_KEYS"), help="throwaway devnet keypair directory, outside the repo")
    ap.add_argument("--faults", action="store_true", help="also run each fault-injected build of the reference")
    ap.add_argument("--evidence", help="directory for run.json and SHA256SUMS")
    a = ap.parse_args(argv)
    if not a.keys:
        ap.error("--keys or X402C_KEYS is required")
    chain = RpcChain(a.rpc)
    env = dict(os.environ, X402C_KEYS=a.keys, X402C_RPC=a.rpc)
    state, payer = _state(a.keys), NodePayer(env)
    procs: list[subprocess.Popen[str]] = []
    runs: dict[str, Any] = {}
    try:
        if a.facilitator:
            targets = {"facilitator": a.facilitator}
        else:
            procs.append(_spawn(env, 4021))
            targets = {"reference": "http://127.0.0.1:4021"}
        for name, url in targets.items():
            fac = HttpFacilitator(url, permission=a.operator_permission)
            sup = fac.supported()
            fp = next(k["extra"]["feePayer"] for k in sup["kinds"]
                      if k.get("x402Version") == 2 and k.get("network") == S.SOLANA_DEVNET and k.get("scheme") == "exact")
            req = requirements(state, fp)

            def slow(u: str = url) -> HttpFacilitator:
                return HttpFacilitator(u, timeout=0.05, permission=a.operator_permission)

            checks = run_checks(fac, payer, chain, req, state["payToAta"], slow=slow)
            runs[name] = {"url": url, "self_hosted": not a.facilitator, "fee_payer": fp, "checks": checks}
        if a.faults and not a.facilitator:
            for i, (fault, check) in enumerate(FAULTS.items()):
                port = 4031 + i
                procs.append(_spawn(env, port, fault))
                fac = HttpFacilitator(f"http://127.0.0.1:{port}")
                fp = state["feePayer"]
                checks = run_checks(fac, payer, chain, requirements(state, fp), state["payToAta"], only={check})
                runs[f"fault:{fault}"] = {"url": fac.base, "self_hosted": True, "fault": fault, "target_check": check,
                                          "caught": any(not c["pass"] for c in checks), "checks": checks}
    finally:
        for p in procs:
            p.kill()
    rpc_host = urllib.parse.urlsplit(a.rpc).hostname
    out = {"tool": f"x402-conformance {__version__}", "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "mode": "devnet", "network": S.SOLANA_DEVNET, "rpc_host": rpc_host,
           "facilitator_impl": "@x402/core 2.28.0 x402Facilitator + @x402/svm 2.28.0 exact (src/x402conf/devnet/node)",
           "asset": {"mint": state["mint"], "decimals": state["decimals"], "note": "throwaway devnet test token"},
           "pay_to": state["payTo"], "payer": state["payer"], "setup_tx": state["setupTx"], "results": runs}
    text = json.dumps(out, indent=1, sort_keys=True) + "\n"
    if a.evidence:
        os.makedirs(a.evidence, exist_ok=True)
        with open(os.path.join(a.evidence, "run.json"), "w") as f:
            f.write(text)
        with open(os.path.join(a.evidence, "SHA256SUMS"), "w") as f:
            f.write(hashlib.sha256(text.encode()).hexdigest() + "  run.json\n")
    print(text, end="")
    ref = runs.get("reference") or runs.get("facilitator") or {}
    ref_ok = all(c["pass"] for c in ref.get("checks", []))
    caught = all(r["caught"] for k, r in runs.items() if k.startswith("fault:"))
    return 0 if ref_ok and caught else 1


if __name__ == "__main__":
    sys.exit(main())
