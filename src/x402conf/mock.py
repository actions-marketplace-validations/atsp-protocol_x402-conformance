"""In-process facilitator doubles for the offline checks. Nothing here touches a network or a key."""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from importlib import resources
from typing import Any

from . import spec as S
from .types import Json

Vectors = Callable[[str], Any]


def load_fixture(name: str = "devnet") -> Json:
    data: Json = json.loads(resources.files("x402conf").joinpath(f"fixtures/{name}.json").read_text("utf-8"))
    return data


def vectors(fixture: Json | None = None) -> Vectors:
    fx = fixture or load_fixture()
    req: Json = fx["requirements"]
    table: dict[str, Any] = {"req": req}
    for k, v in fx["vectors"].items():
        table[k] = dict(v, mint=req["asset"], dest=req["payTo"]) if v.get("tx") else dict(v)
    return lambda k: copy.deepcopy(table[k])


def _fail(reason: str, req: Json, tx: str = "") -> Json:
    return {"success": False, "errorReason": reason, "transaction": tx, "network": req["network"]}


class Reference:
    """Behaves as the spec asks: exact outcome checks, a duplicate-settlement cache, memo uniqueness, finality."""

    def __init__(self) -> None:
        self.seen_tx: set[str] = set()
        self.seen_memo: set[str] = set()

    def verify(self, p: Any, req: Json) -> Json:
        if not isinstance(p, dict) or not p.get("tx") or not p.get("memo"):
            return {"isValid": False, "invalidReason": "invalid_payload"}
        if p.get("mint") != req["asset"] or p.get("dest") != req["payTo"]:
            return {"isValid": False, "invalidReason": "invalid_payment_requirements"}
        if int(p.get("amount", 0)) < int(req["amount"]):
            return {"isValid": False, "invalidReason": "insufficient_funds"}
        return {"isValid": True}

    def _dup(self, p: Json) -> bool:
        return p["tx"] in self.seen_tx or p["memo"] in self.seen_memo

    def _settle_ok(self, p: Json) -> bool:
        return bool(p.get("finalized"))

    def settle(self, p: Any, req: Json) -> Json:
        v = self.verify(p, req)
        if not v["isValid"]:
            return _fail(v["invalidReason"], req)
        if self._dup(p):
            return _fail(S.DUPLICATE_SETTLEMENT, req)
        self.seen_tx.add(p["tx"])
        self.seen_memo.add(p["memo"])
        if not self._settle_ok(p):
            return _fail(S.SETTLEMENT_PENDING, req, p["tx"])
        return {"success": True, "transaction": p["tx"], "network": req["network"]}


class Faulty(Reference):
    """Each flag reproduces one failure the suite must catch. no_dup_cache is a stateless facilitator with no
    in-flight cache at all (the race described in the SVM spec's Duplicate Settlement Mitigation section)."""

    def __init__(self, *, open_on_malformed: bool = False, accept_dust: bool = False, no_dup_cache: bool = False,
                 no_memo_check: bool = False, success_before_final: bool = False) -> None:
        super().__init__()
        self.open_on_malformed, self.accept_dust = open_on_malformed, accept_dust
        self.no_dup_cache, self.no_memo_check = no_dup_cache, no_memo_check
        self.success_before_final = success_before_final

    def verify(self, p: Any, req: Json) -> Json:
        if self.open_on_malformed and (not isinstance(p, dict) or not p.get("tx")):
            return {"isValid": True}
        if self.accept_dust and isinstance(p, dict) and p.get("tx"):
            return {"isValid": True}
        return super().verify(p, req)

    def settle(self, p: Any, req: Json) -> Json:
        if self.open_on_malformed and (not isinstance(p, dict) or not p.get("tx")):
            return _fail("invalid_payload", req)   # a lenient verify; settle cannot proceed without a transaction
        return super().settle(p, req)

    def _dup(self, p: Json) -> bool:
        if self.no_dup_cache:
            return False
        if self.no_memo_check:
            return p["tx"] in self.seen_tx
        return super()._dup(p)

    def _settle_ok(self, p: Json) -> bool:
        return self.success_before_final or super()._settle_ok(p)


FAULTS: dict[str, Callable[[], Reference]] = {
    "reference": Reference,
    "open_on_malformed": lambda: Faulty(open_on_malformed=True),
    "accept_dust": lambda: Faulty(accept_dust=True),
    "no_dup_cache": lambda: Faulty(no_dup_cache=True),
    "no_memo_check": lambda: Faulty(no_memo_check=True),
    "success_before_final": lambda: Faulty(success_before_final=True),
}
