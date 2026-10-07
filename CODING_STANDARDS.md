# Coding standards

Judgement calls for review. Mechanical rules live in `eslint.config.mjs` and `scripts/check-*`.

## Durable work

Applies to Convex job tables and the Inngest functions that drive them.

- Every mutation that advances or finishes work checks that the caller still owns the current attempt (owner, generation, deadline) through the table's one shared fence predicate, never a local restatement of its clauses.
- Work that ends writes its terminal state. A deadline or cancel racing completion still leaves a truthful final state.
- A retry is a fresh attempt: per-attempt outputs (checks, errors, stop reasons) start empty.
- States stay distinct: `unavailable` and `failed`, `writing` and `uncertain`, and a finding absent from a later review and `fixed` each mean different things to the user.
- Idempotency covers every path that can resubmit, including a UI retry after a lost reply.

## Shapes and predicates

- One definition per shape: the Convex validator and the Zod schema derive from a single source. Safety predicates (path checks, fences) are shared. A deliberate defence-in-depth copy in another process says so where it lives.
- Model output with a malformed structure degrades to an explicit incomplete state and keeps the rest of the result.

## UI state

- Each control is offered only in states where it can succeed, and every stuck state has a way out reachable from the UI.
- A view shows each fact once. Two counts of one thing, computed differently, will drift apart.

## Comments

- Comments carry constraints and reasons the code cannot show.
