/-
  One-time payment nonce (memo) state machine. A nonce can be consumed at most once, so a replay of a used nonce
  in a new transaction (check F4) can never be credited. Core Lean 4 only.
-/
namespace X402Conformance

inductive NState where
  | openS | used | expired
  deriving DecidableEq

def consume : NState → Option NState
  | .openS => some .used
  | _      => none

theorem consume_once (s t : NState) (h : consume s = some t) : consume t = none := by
  cases s <;> simp [consume] at h
  subst h; rfl

theorem only_open_consumes (s : NState) (h : (consume s).isSome) : s = .openS := by
  cases s <;> simp [consume] at h ⊢

end X402Conformance
