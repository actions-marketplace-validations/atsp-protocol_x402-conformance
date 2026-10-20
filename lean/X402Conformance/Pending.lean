/-
  Pending settlements for an x402 resource server: timeouts, settlement_pending reconciliation and concurrent settles.
  This extends the credit rule in Settlement.lean to every answer a /settle exchange can produce, and models the
  checks F5 to F9. Core Lean 4 only, no axioms added.

  A credited set `s` holds the transactions already credited. One /settle exchange ends in exactly one `Answer`.
  Only a final success credits, and only once per transaction.
-/
namespace X402Conformance.Pending

/-- What one /settle exchange can give the resource server. -/
inductive Answer where
  /-- HTTP 200, success = true, transaction final on chain. -/
  | success (tx : String)
  /-- HTTP 200, success = false, errorReason = settlement_pending, carrying the transaction (V2 section 9). -/
  | pending (tx : String)
  /-- HTTP 200, success = false, a terminal error. -/
  | failure (tx : String)
  /-- No usable answer: deadline passed, non-200 status, non-JSON or truncated body. -/
  | timeout
  deriving DecidableEq

/-- The credit rule: one atomic check-and-insert keyed by the transaction. -/
def credit (s : List String) : Answer → List String
  | .success tx => if s.contains tx then s else tx :: s
  | _           => s

/-- Any interleaving of answers, from any number of retries or concurrent workers, applied to one shared set. -/
def runA (s : List String) : List Answer → List String
  | []      => s
  | a :: as => runA (credit s a) as

/-- A settlement_pending answer never credits. -/
theorem pending_never_credits (s : List String) (tx : String) : credit s (.pending tx) = s := rfl

/-- A timeout or broken transport never credits. -/
theorem timeout_never_credits (s : List String) : credit s .timeout = s := rfl

/-- A terminal failure never credits. -/
theorem failure_never_credits (s : List String) (tx : String) : credit s (.failure tx) = s := rfl

/-- Any number of pending answers or timeouts in a row leave the credited set unchanged. -/
theorem pending_run_unchanged (s : List String) (tx : String) (k : Nat) :
    runA s (List.replicate k (.pending tx)) = s := by
  induction k with
  | zero => rfl
  | succ k ih => simp [List.replicate, runA, credit, ih]

theorem timeout_run_unchanged (s : List String) (k : Nat) : runA s (List.replicate k .timeout) = s := by
  induction k with
  | zero => rfl
  | succ k ih => simp [List.replicate, runA, credit, ih]

theorem runA_append (s : List String) (as bs : List Answer) : runA s (as ++ bs) = runA (runA s as) bs := by
  induction as generalizing s with
  | nil => rfl
  | cons a as ih => exact ih (credit s a)

/-- Whatever was credited stays credited. -/
theorem credit_mono (s : List String) (a : Answer) (x : String) (h : x ∈ s) : x ∈ credit s a := by
  cases a with
  | success tx =>
    simp only [credit]
    split
    · exact h
    · exact List.mem_cons_of_mem _ h
  | pending _ => exact h
  | failure _ => exact h
  | timeout => exact h

theorem runA_mono (s : List String) (as : List Answer) (x : String) (h : x ∈ s) : x ∈ runA s as := by
  induction as generalizing s with
  | nil => exact h
  | cons a as ih => exact ih (credit s a) (credit_mono s a x h)

/-- A final success always ends with the transaction credited. -/
theorem success_credits (s : List String) (tx : String) : tx ∈ credit s (.success tx) := by
  simp only [credit]
  split
  · next h => simpa using h
  · exact List.mem_cons_self

/-- The check-and-insert never credits a transaction twice. -/
theorem credit_nodup (s : List String) (a : Answer) (h : s.Nodup) : (credit s a).Nodup := by
  cases a with
  | success tx =>
    simp only [credit]
    split
    · exact h
    · next hc =>
      have hn : tx ∉ s := by simpa using hc
      exact List.nodup_cons.mpr ⟨hn, h⟩
  | pending _ => exact h
  | failure _ => exact h
  | timeout => exact h

/-- Concurrent settles: under any interleaving of answers, from any number of workers sharing one credited set,
    no transaction is credited twice. -/
theorem concurrent_nodup (s : List String) (as : List Answer) (h : s.Nodup) : (runA s as).Nodup := by
  induction as generalizing s with
  | nil => exact h
  | cons a as ih => exact ih (credit s a) (credit_nodup s a h)

/-- On-chain state of one transaction. Only an in-flight transaction can change; a resolved one is final. -/
inductive Chain where
  | inflight | confirmed | failed
  deriving DecidableEq

def advance : Chain → Chain → Chain
  | .inflight, r => r
  | c, _         => c

/-- The answer a conformant facilitator gives a retry of the same /settle body, given the chain state. -/
def answer (tx : String) : Chain → Answer
  | .inflight  => .pending tx
  | .confirmed => .success tx
  | .failed    => .failure tx

/-- Resolved states are final: the chain never moves a confirmed or failed transaction. -/
theorem resolved_final (c r : Chain) (h : c ≠ .inflight) : advance c r = c := by
  cases c <;> simp_all [advance]

/-- A failure confirmed on chain after settlement_pending is terminal: no later retry is pending again. -/
theorem failed_never_pending (tx : String) (rs : List Chain) :
    answer tx (rs.foldl advance .failed) = .failure tx := by
  induction rs with
  | nil => rfl
  | cons r rs ih => simpa [List.foldl, advance] using ih

/-- A failed transaction is never credited, however often it is retried. -/
theorem failed_never_credits (s : List String) (tx : String) (k : Nat) :
    runA s (List.replicate k (answer tx .failed)) = s := by
  simp only [answer]
  induction k with
  | zero => rfl
  | succ k ih => simp [List.replicate, runA, credit, ih]

/-- settlement_pending reconciliation: any number of pending answers and timeouts, then the chain confirms and the
    same body is retried m + 1 times. The transaction ends credited, exactly once. -/
theorem reconcile_credits_once (s : List String) (tx : String) (k t m : Nat) (h : s.Nodup) :
    let r := runA s (List.replicate k (.pending tx) ++ List.replicate t .timeout ++
                     List.replicate (m + 1) (answer tx .confirmed))
    tx ∈ r ∧ r.Nodup := by
  simp only [runA_append, pending_run_unchanged, timeout_run_unchanged]
  refine ⟨?_, concurrent_nodup _ _ h⟩
  simp only [List.replicate, answer, runA]
  exact runA_mono _ _ tx (success_credits s tx)

/-- A credit decided on a stale read is unsafe: two workers that both read the empty set before either writes
    credit the same transaction twice. This is why the rule must be one atomic check-and-insert. -/
def racy (snapshot : List String) (as : List Answer) : List String :=
  as.foldl (fun acc a => match a with
    | .success tx => if snapshot.contains tx then acc else tx :: acc
    | _           => acc) snapshot

theorem racy_double_credits : racy [] [.success "t", .success "t"] = ["t", "t"] := by
  simp [racy]

theorem racy_not_nodup : ¬ (racy [] [.success "t", .success "t"]).Nodup := by
  rw [racy_double_credits]
  simp

end X402Conformance.Pending
