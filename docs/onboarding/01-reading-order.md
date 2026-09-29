# Reading Order

This repo is small, so the goal is not to read everything in order. The goal is to build a correct mental model in layers.

## Stage 0: Start with the shape of the system

Read:

- `README.md`
- `docs/onboarding/00-codebase-map.md`

Why this comes first:

- You need the vocabulary before you need the implementation.
- The repo mixes many ERP modules into one service file, so a high-level map prevents early confusion.

Try to learn:

- what the product does
- what is and is not present in this repo
- where the main architectural boundaries are

Checkpoint:

- After this stage, you should understand that this is a backend-only ERP starter with thin routes, a large service layer, and an in-memory store.

## Stage 1: Learn the shared language of the codebase

Read:

- `src/domain/models.ts`
- `docs/onboarding/files/src/domain/models.ts.md`

Why this comes before logic files:

- Types tell you what concepts exist and which invariants the code is trying to preserve.
- Without this file, the service methods can feel like a wall of business logic.

Try to learn:

- the main domain entities
- the document types and status model
- how `ERPState` is shaped
- what information belongs in `RequestContext`

Checkpoint:

- After this stage, you should be able to explain what a sales invoice, purchase receipt, stock ledger entry, and GL entry each represent in this codebase.

## Stage 2: Learn where state lives and how it starts

Read:

- `src/domain/store.ts`
- `docs/onboarding/files/src/domain/store.ts.md`

Why this comes before the service:

- The service mutates store state everywhere.
- If you do not understand how state is laid out and seeded, the service methods are harder to reason about.

Try to learn:

- how IDs and timestamps are created
- how document numbering works
- how company scoping is enforced
- what demo data exists by default

Checkpoint:

- After this stage, you should understand why every request eventually depends on `ERPStore` state and why tests can create a fresh app for isolation.

## Stage 3: Learn the API boundary

Read:

- `src/app.ts`
- `docs/onboarding/files/src/app.ts.md`

Why this comes before the big service file:

- This file gives you the route surface and shows how requests enter the system.
- It also shows a deliberate design choice: routes are mostly thin delegates into service methods.

Try to learn:

- how auth context is created
- how company selection works
- what the major route groups are
- how errors become HTTP responses

Checkpoint:

- After this stage, you should be able to point to the entry route for each major business flow.

## Stage 4: Read the core business engine in passes, not all at once

Read:

- `src/domain/erp-service.ts`
- `docs/onboarding/files/src/domain/erp-service.ts.md`

Suggested passes:

1. Read the top section with validation schemas and auth helpers.
2. Read the sales flow methods.
3. Read the buying and inventory methods.
4. Read the accounting and reporting methods.
5. Read the helper methods at the bottom.

Why this stage is last among production files:

- This file is the densest and most interconnected file in the repo.
- It makes more sense once you already know the models, store, and route boundary.

Try to learn:

- how a create method differs from a submit method
- which transitions trigger stock posting
- which transitions trigger GL posting
- where idempotency is enforced
- how reporting depends on ledgers rather than direct totals

Checkpoint:

- After this stage, you should be able to explain the full flow of at least one sales transaction and one purchasing transaction.

## Stage 5: Read the tests as executable documentation

Read:

- `tests/erp.test.ts`

Why this comes after the implementation:

- The tests are easier to learn from once you already know what the routes and service methods mean.
- They act as “what behavior matters most” documentation.

Try to learn:

- which flows the code treats as essential
- what invariants are asserted in tests
- how the app is exercised end to end

Checkpoint:

- After this stage, you should understand what a safe change needs to preserve.

## Suggested tracing exercises

### Exercise 1: Trace login and company scoping

Trace:

- `POST /auth/login`
- `GET /auth/me`
- one authenticated request that uses `x-company-id`

You should notice:

- login is separate from per-request company scoping
- `RequestContext` is the object that carries runtime identity into service logic

### Exercise 2: Trace one quote-to-cash path

Trace:

- create quotation
- submit quotation
- convert to sales order
- submit sales order
- create sales invoice
- submit sales invoice
- create and submit payment

You should notice:

- some methods create records
- some methods transition state
- some methods also create ledger side effects

### Exercise 3: Trace one stock-affecting path

Trace:

- create purchase receipt
- submit purchase receipt
- read stock ledger
- read stock balance

You should notice:

- the stock balance is computed from ledger entries
- ledger writes happen during submit, not during create

### Exercise 4: Trace one permission rule

Trace:

- create a purchase order over the approval threshold
- submit it
- try approval as purchase user
- approve it as company admin

You should notice:

- authorization is enforced in the service, not just by route naming
- business rules and permission rules are coupled at important transitions

## What to do after the first reading pass

Once you finish the stages above, do one of these:

- Add a tiny feature, like a new report export target.
- Add a missing test around an obvious edge case, like overpayment or negative stock.
- Refactor one repeated pattern only after you can describe the invariant it protects.

That last point matters. In this codebase, a “cleanup” can easily break a business rule if you do not first understand why the current duplication exists.
