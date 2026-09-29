# Stories, resume bullets and the spoken summary

## Story 1: the error that had already changed the data

**Situation.** An ERP starter where submitting a purchase receipt posts stock ledger entries and balanced general-ledger lines. A receipt with two lines, the first naming a warehouse and the second not, returned an error to the user after it had already marked the document submitted and posted the first line's stock.

**Task.** Make submission all-or-nothing.

**Action.** The cheap fix was to reorder the checks so all validation ran before any mutation. I did not take it, because it fixes one method and leaves the next handler free to make the same mistake. Instead I moved the boundary: every route handler now runs inside one database transaction, installed once in a Fastify `onRoute` hook that wraps each registered handler at registration time (`src/app.ts:39-47`), with writes taking `BEGIN IMMEDIATE` and reads `BEGIN` (`src/domain/database.ts:45`). Handlers mutate a parsed in-memory aggregate, and that aggregate is re-validated, re-serialized and written only at the end, and only if the serialized text actually differs (`src/domain/database.ts:68-73`). So a throw anywhere in the handler reaches the `catch`, issues `ROLLBACK`, and leaves nothing behind.

**Result.** The regression test at `tests/integrity.test.ts:161` does not assert a status code and stop. It captures the whole database row, attempts the submission, asserts 400, and then asserts the row is deeply equal to what it captured. That proves no version was consumed, no audit event appended, no stock ledger entry orphaned and no document status changed. A status-code assertion alone would have passed against the buggy code, because the buggy code also returned an error.

## Story 2: the run I refused to record

**Situation.** A verification run of the API suite produced 38 tests with passing assertions and a nonzero process exit code.

**Task.** Decide whether that counted as a clean verification.

**Action.** I did not accept it. Passing assertions with a failing exit means something is wrong outside the assertions, usually a handle or a child process that did not close, and those become unexplained CI flakes weeks later when nobody remembers the context. I fixed the cause and reran with one Vitest worker, file parallelism disabled, a 60-second hook timeout and a 90-second default test timeout, because two of the scenarios spawn real server processes against one shared database file and need their own declared limits.

**Result.** The accepted run is 39 of 39 with exit code 0, with both a verbose log and a JSON report. I also kept the arithmetic honest elsewhere: after visual review found a status banner overlapping content, I added a non-overlap assertion and reran five browser scenarios, and recorded those as rechecks rather than as five new unique checks. The published figure is 46 unique checks, 39 API and cross-process tests plus seven Chromium scenarios, on Node 22.16.0 with builtin SQLite.

## Story 3: the rule that says no

**Situation.** Catalog items can be edited. An item has an `isStockItem` flag that decides whether selling it moves inventory.

**Task.** Decide what happens when someone flips that flag on an item that already has stock ledger history.

**Action.** I made it a hard refusal: if `isStockItem` differs from the stored value and any `stockLedgerEntries` row references that item, the edit is a 409 with "Stock classification cannot change after ledger history" (`src/domain/erp-service.ts:2194-2202`). The argument is that no later correction can reconstruct what the existing quantities meant, so allowing the edit produces a ledger that cannot be interpreted. I applied the same principle to costs: a sales invoice line snapshots `standardCost` at draft creation, and editing the catalog item afterwards does not rewrite the accepted document.

**Result.** `keeps accepted costs after item edits` at `tests/integrity.test.ts:228` pins the cost rule. The same instinct shaped what the project refuses to implement at all: manufacturing and reconciliation stock modes are rejected with an explicit error rather than partially built, and a linked invoice must match its order's quantities and rates completely, because a half-implemented accounting feature is worse than an absent one.

## Resume bullets

- Made every HTTP request atomic in a Fastify ERP service by wrapping each route handler in a single SQLite transaction through an `onRoute` hook, so no handler can opt out, with `BEGIN IMMEDIATE` on writes to serialize competing processes rather than failing them at commit.
- Eliminated a partial-write defect in purchase receipt submission where a missing warehouse on a later line left the document submitted and one stock posting applied, proven by a regression test asserting the entire persisted row is unchanged after the rejected attempt.
- Enforced optimistic concurrency on all master-data edits via a strict version envelope returning HTTP 409 on mismatch, with full-replacement semantics that delete non-system fields before assignment so an omitted field is removed rather than silently retained.
- Validated the full persisted aggregate on both read and write, refusing an invalid or oversized workspace instead of repairing it, and rejecting a read handler that mutates state or an async transaction callback that would commit before its work ran.
- Stored credentials as scrypt with per-user salts verified through `timingSafeEqual`, persisted only SHA-256 hashes of session tokens, and added a dummy-hash path so an unknown user costs the same derivation time as a known one.
- Verified across three layers for a recorded 46 unique checks: 39 single- and cross-process API tests including two real multi-process races over one database file, plus seven Chromium scenarios, rejecting an earlier run whose assertions passed but whose exit code was nonzero.

## 60-second spoken summary

"E20 is a small ERP on Fastify and TypeScript: companies and roles, master data, the sales cycle from quotation to payment, the purchase cycle from order to receipt to invoice, stock ledger and general ledger postings, projects and timesheets. The design decision I would lead with is that the entire workspace is one validated JSON aggregate in a single SQLite row, and every request runs in one transaction wired through an `onRoute` hook so no handler can forget it. That is what makes a receipt submission all-or-nothing: the bug I fixed was a receipt whose second line had no warehouse leaving the document submitted with the first line's stock already posted, and the regression test captures the database row and asserts it is byte-identical after the rejected attempt rather than just checking the status code. I would also volunteer where the design stops. Writes serialize globally, so it does not scale horizontally; creation is not idempotent, so after a lost response you inspect before retrying; and manufacturing and reconciliation stock modes are rejected rather than half-built. Verification is 46 unique checks including two genuine multi-process races over one database file."

## What I would do next

1. Durable idempotency for creation requests, which `astraupskill/VERIFICATION.md` names as a gap: a client-supplied key stored with the document, so the lost-acknowledgement scenario the browser suite deliberately exercises stops requiring a human to inspect data before retrying.
2. Partial fulfillment on linked documents. Today a linked invoice must match its order's quantities and rates completely and a subset fails explicitly. Supporting partials needs a reservation model that can be drawn down, which is a design, not a patch.
3. Split the aggregate. The 20 MiB and 10,000-record bounds (`src/domain/state-schema.ts:341-345`) are the design stating its own ceiling; the first thing to move out is `stockLedgerEntries`, since it is append-only and the largest growth axis, and it is the one whose re-serialization cost on every write is pure waste.
4. Work Assignment D from `astraupskill/05-PRACTICE.md`, the customers table with its migration, conditional `UPDATE` and reference checks, which is written up as a reference but deliberately not applied to the code.
