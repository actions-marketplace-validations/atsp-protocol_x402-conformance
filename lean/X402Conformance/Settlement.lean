/-
  Credit rule for an x402 resource server: the property the conformance suite tests in F3 to F6.
  A settle outcome is credited only if the facilitator reported success, the transfer is finalized, the amount is at
  least the required amount, and the transaction has not been credited before. Core Lean 4 only, no axioms added.
-/
namespace X402Conformance

structure Outcome where
  tx        : String
  success   : Bool
  finalized : Bool
  amount    : Nat
  required  : Nat

def creditable (s : List String) (o : Outcome) : Bool :=
  o.success && o.finalized && decide (o.required ≤ o.amount) && !(s.contains o.tx)

def step (s : List String) (o : Outcome) : List String :=
  if creditable s o then o.tx :: s else s

def run (s : List String) : List Outcome → List String
  | []      => s
  | o :: os => run (step s o) os

/-- Nothing is credited unless it was a finalized success for at least the required amount. -/
theorem credit_sound (s : List String) (o : Outcome) (h : step s o ≠ s) :
    o.success = true ∧ o.finalized = true ∧ o.required ≤ o.amount := by
  unfold step at h
  by_cases hc : creditable s o = true
  · simp [creditable] at hc
    exact ⟨hc.1.1.1, hc.1.1.2, hc.1.2⟩
  · simp [hc] at h

/-- Settling the same outcome again changes nothing (idempotent settle). -/
theorem step_idem (s : List String) (o : Outcome) : step (step s o) o = step s o := by
  unfold step
  by_cases hc : creditable s o = true
  · have : creditable (o.tx :: s) o = false := by simp [creditable]
    simp [hc, this]
  · simp [hc]

/-- One step never credits a transaction twice. -/
theorem step_nodup (s : List String) (o : Outcome) (h : s.Nodup) : (step s o).Nodup := by
  unfold step
  by_cases hc : creditable s o = true
  · simp only [hc, ite_true]
    have hn : o.tx ∉ s := by
      simp [creditable] at hc
      exact hc.2
    exact List.nodup_cons.mpr ⟨hn, h⟩
  · simp [hc]; exact h

/-- No double credit over any sequence of settle outcomes, including replays and duplicates. -/
theorem run_nodup (s : List String) (os : List Outcome) (h : s.Nodup) : (run s os).Nodup := by
  induction os generalizing s with
  | nil => simpa [run]
  | cons o os ih => exact ih (step s o) (step_nodup s o h)

end X402Conformance
