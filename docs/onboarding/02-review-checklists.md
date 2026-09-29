# Review Checklists

These checklists are tailored to this ERP backend, but they are written to stay useful in similar service-heavy application codebases.

## Business logic and services

What to look for:

- Does the change preserve the domain invariant, not just make the test pass?
- Are status transitions explicit and valid from the current state?
- Are cross-module side effects applied in the right order?
- Does the change accidentally bypass a shared helper that was enforcing consistency?

Common failure modes:

- Updating document status without posting the expected ledger entries
- Updating a derived value directly instead of updating the source ledger
- Adding a new workflow branch without role enforcement
- Forgetting to update related documents after a transition

Good review questions:

- What is the source of truth for this value?
- Should this happen on create, on submit, or on a later transition?
- If this request is retried, do we double-apply side effects?
- What other entities become stale if this logic changes?

Subtle bugs a junior dev might miss:

- A method returns early for idempotency in one path but not in another.
- A report still looks correct for one scenario but becomes wrong when two document types interact.
- A transition works from `draft` but not from `pending_approval`.

## API routes and controllers

What to look for:

- Is the route thin and delegating logic instead of duplicating business rules?
- Does it authenticate and scope correctly?
- Does it return appropriate status codes and response shapes?
- Does it validate route params, query params, and request bodies either here or in the service?

Common failure modes:

- Missing `getContext` or inconsistent auth handling
- Different routes using slightly different naming or behavior for the same concept
- Body values cast unsafely before validation happens
- New routes introduced without matching test coverage

Good review questions:

- What service method owns this behavior?
- Could this route be hit without a company header?
- What happens when the request body is incomplete or malformed?
- Are we relying on string matching for an error that should be a typed error?

Subtle bugs a junior dev might miss:

- A route looks harmless but exposes data across company boundaries because it forgot to filter by `companyId`.
- A route returns success even though a side effect failed halfway through in the service.

## Database schema and persistence logic

Observed from code:

- This repo uses an in-memory store rather than a database.

Why still review this section:

- The same questions apply to any persistence layer: source of truth, consistency, uniqueness, and transactional behavior.

What to look for:

- Is the entity shape consistent with the domain model?
- Are IDs, timestamps, and numbering applied in one consistent place?
- Are “lookup by company” and “lookup by ID” rules enforced everywhere?
- Are uniqueness assumptions explicit or only accidental?

Common failure modes:

- Adding a new entity but forgetting to include it in `ERPState`
- Creating records without audit fields
- Updating aggregates directly when they should be derived
- Not thinking about how a future database transaction would need to behave

Good review questions:

- If this store moved to a real database, what transaction would this require?
- Is this value canonical or derived?
- What data would need an index in a persistent system?
- What uniqueness constraints are assumed but not modeled?

Subtle bugs a junior dev might miss:

- A new entity is created with the wrong `companyId`, which then causes impossible-to-debug authorization failures later.
- Numbering logic is changed in a way that is fine in-memory but unsafe under concurrency.

## Frontend state and UI behavior

Observed from code:

- There is no frontend in this repo today.

Why keep this checklist:

- ERP systems usually grow a large UI surface, and the backend patterns here strongly imply future UI concerns.

What to look for in a similar codebase:

- Is UI state clearly separated from server truth?
- Are optimistic updates safe for ledger-affecting actions?
- Are status transitions represented clearly in the UI?
- Does filtering or search respect company and permission boundaries?

Common failure modes:

- UI assumes immediate success for submit actions that can fail server-side
- Form state omits fields that are required by backend invariants
- Lists show stale derived totals because they were cached incorrectly

Good review questions:

- Is this action safe to show as optimistic?
- What is the rollback behavior if the server rejects the change?
- Are we displaying derived values or editable values?

Subtle bugs a junior dev might miss:

- A UI displays “available stock” but uses raw quantity instead of quantity minus reservations.

## Async code, concurrency, and race conditions

What to look for:

- Could two submissions race and produce duplicate state changes?
- Is idempotency handled at the right layer?
- Are retries or duplicate requests expected?
- Does the code assume single-threaded access when that may not hold later?

Common failure modes:

- Double-posting ledger entries
- Incrementing numbering counters unsafely
- Reading current state, then mutating later after assumptions have become stale
- Using “already submitted” checks without protecting the side effects behind them

Good review questions:

- What happens if this request is sent twice?
- What happens if two users act on the same document at nearly the same time?
- Is there a single source of truth for preventing duplicate side effects?

Subtle bugs a junior dev might miss:

- The document status stays correct, but a helper still posts a duplicate ledger line because the duplicate check is too narrow or too broad.

## Auth, permissions, and security-sensitive paths

What to look for:

- Is every sensitive path enforcing role checks server-side?
- Is company scoping enforced in lookups, not just in route assumptions?
- Are attachment and comment access paths checking ownership and company scope?
- Are login and session behaviors protected from abuse?

Common failure modes:

- Adding a new endpoint without `requireRoles`
- Looking up an entity by `id` only instead of `id` plus `companyId`
- Allowing a user with read access to perform a state transition
- Exposing sensitive data in audit or export endpoints

Good review questions:

- Who should be allowed to do this, exactly?
- Is the permission enforced where the business action happens?
- Could a user switch `x-company-id` and see another company’s data?

Subtle bugs a junior dev might miss:

- A route requires auth, but the helper it calls does not validate that the referenced entity belongs to the active company.

## Realtime or event-driven code

Observed from code:

- No realtime or event-driven runtime is present yet.

If this is added later, review for:

- ordering guarantees
- duplicate delivery handling
- retry safety
- out-of-order state transitions
- observability around failed event handling

Good review questions:

- If an event is delivered twice, what breaks?
- If one handler succeeds and another fails, what is the recovery plan?

## Error handling and observability

What to look for:

- Are errors specific enough to be actionable?
- Are error types or codes used where the system depends on classification?
- Is important business activity visible in logs or audit trails?
- Are failures communicated without leaking sensitive data?

Common failure modes:

- Catching too broadly and losing domain detail
- Throwing generic `Error` values whose message text becomes an API contract by accident
- Missing audit entries for important transitions
- Returning success even when side effects only partially happened

Good review questions:

- How will an operator debug this failure?
- Does this error map cleanly to an HTTP status?
- Should this action also create an audit log entry?

Subtle bugs a junior dev might miss:

- Renaming an error message accidentally changes the returned HTTP status because the route layer is pattern-matching on strings.

## Types, contracts, and validation

What to look for:

- Is the runtime validation aligned with the TypeScript types?
- Are optional fields truly optional in behavior, not just in type syntax?
- When a new document type is added, are all relevant unions and collections updated?
- Are helper functions preserving type-level invariants in runtime behavior?

Common failure modes:

- Updating TypeScript interfaces without adding matching validation
- Adding a new enum-like string union in one place but forgetting another
- Trusting request casts before validation occurs
- Using account-name strings as if they were stable identifiers

Good review questions:

- What enforces this at runtime?
- What happens if a caller sends an extra field or omits a field?
- Does this change need to update `DocumentType`, `ERPState`, route wiring, and reports?

Subtle bugs a junior dev might miss:

- A new account name works operationally but breaks reporting because account classification is string-based.

## Tests and missing coverage

What to look for:

- Does the test cover the real invariant or just the happy-path output?
- Is there at least one test for failure and permission paths?
- Are major side effects asserted, not just status changes?
- Does the test isolate setup clearly enough to explain the scenario?

Common failure modes:

- Testing that a route returns `200` but not checking ledger consequences
- Missing retry or duplicate-submission tests
- Missing cross-module tests where one document affects another
- Writing brittle tests that depend on incidental seed data instead of explicit setup

Good review questions:

- What existing test would fail if this invariant broke?
- What edge case is not represented here?
- Does this change deserve an integration test instead of just a unit test?

Subtle bugs a junior dev might miss:

- A test confirms invoice status changes, but never asserts the matching GL entries, so accounting regressions slip through.
