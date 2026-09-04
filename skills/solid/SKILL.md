---
name: solid
description: Senior-engineer quality rules for implementation, refactoring, architecture, review, tests, and debugging in any language. Use while building or changing code, and when reviewing a diff for design quality.
license: MIT
metadata:
  version: "1.0.0"
  upstream:
    source: ramziddin/solid-skills
    path: skills/solid/SKILL.md
    adapted: true
    reason: Rewritten as a language-neutral design contract; tests are deferred until the operator accepts the preview, and value objects or fixed method-length limits are not mandated.
---

# SOLID Engineering Contract

Use this skill for every code change or code review. The goal is software another
engineer can quickly discover, understand, change, test, debug, and release.

## Before code

1. State the operator-visible outcome and the acceptance checks from the brief.
2. Define inputs, outputs, failure behavior, and important edge cases.
3. Identify the smallest coherent change and the tests that will prove it later.
4. Prefer the existing owner and pattern. Add an abstraction only for a demonstrated
   need, never a hypothetical future.

## Design rules

- Give each module, type, and function one reason to change. Keep policy separate
  from infrastructure and point dependencies toward the owning domain.
- Preserve feature ownership and narrow public entry points. Avoid broad shared
  helpers, global state, and cross-feature knowledge.
- Prefer composition and small explicit contracts. Substitutable implementations
  must preserve their callers' expectations; consumers depend only on what they use.
- Encapsulate domain values when doing so protects a real invariant. Do not add
  wrapper types or patterns merely to satisfy ceremony.
- Validate untrusted boundaries explicitly: user input, files, network, environment.
  Check membership against a known set rather than trusting the shape of the input.

## Code rules

- Use consistent, specific domain names. Optimize first for understanding, then
  brevity.
- Keep control flow shallow with early returns. Split long functions and large owners
  when they mix responsibilities.
- Remove duplication after the third real occurrence; a little local duplication is
  preferable to the wrong shared abstraction.
- Do not add debug output, unfinished markers, unexplained suppressions, weakened
  types, dead code, speculative fallbacks, or comments that restate the code.
- Comment only non-obvious intent, safety boundaries, or workflow constraints.

## Tests

Write tests after the operator accepts the preview, in the same batch as the code.

- Keep tests close to the behavior they protect and name concrete outcomes.
- Use the smallest useful layer: unit tests for isolated behavior, integration tests
  for collaborating parts, end-to-end tests for operator-visible contracts.
- Cover success, meaningful failure, authorization or boundary behavior, and the
  regression this change fixes. Never reduce existing coverage to make a change pass.
- Use deterministic fixtures and isolated, disposable data. A test that fails alone
  but passes in the suite has a setup bug; fix the setup, never add retries.

## Final review

Before handoff, confirm:

- all relevant tests pass;
- the solution expresses intent with minimal accidental complexity;
- ownership and names remain obvious;
- no debug, dead, suppressed, or unfinished work remains;
- documentation impact is handled;
- a future engineer can change the behavior without reading unrelated areas.

## References

Read the reference that matches the decision in front of you; do not read them all.

- `references/solid-principles.md` — when deciding how to split responsibilities or
  whether an abstraction, interface, or dependency direction is right.
- `references/architecture.md` — when a change crosses module or layer boundaries,
  or introduces a new module, adapter, or integration.
- `references/object-design.md` — when modelling domain types, invariants, and the
  relationships between objects.
- `references/design-patterns.md` — when a recurring problem suggests a pattern and
  you need to confirm it fits rather than adding ceremony.
- `references/clean-code.md` — when naming, structuring, or formatting code that
  others will read.
- `references/code-smells.md` — when reviewing a diff and something feels wrong but
  you cannot yet name it.
- `references/complexity.md` — when a function or module has grown and you need to
  decide how and where to split it.
- `references/testing.md` — when choosing the test layer, fixture strategy, or how to
  make a test deterministic.
