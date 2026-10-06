# 5. Practice assignments with acceptance criteria

Use a fresh practice database and a branch or separate copy for your exercises. Each assignment should produce a focused change, a short explanation, and evidence tied to the stated behavior. The exercises below are future learning work; they are not claims about functionality already implemented.

## Warm-ups with runnable checks

Do these before the assignments. W1 to W3 need no `npm install`; W4 needs `npm ci`. Put scratch tests outside `src/` (for example `tests/practice-*.test.mjs`) and delete them afterwards.

### W1: map the authorization call sites (easy)

**Goal.** List every place a request is refused for authorization reasons, grouped by layer (identity, operation role, entity read).

**Hint.** Start from 01-CODEBASE-MAP, "Where authorization lives".

**Check.** `grep -n "requireEntityRead\|canReadEntity" src/domain/erp-service.ts` prints exactly eight lines: four `requireEntityRead` calls (1540, 1561, 1589, 1614), one `canReadEntity` use in `search` (1762), the two definitions (2070, 2093), and the call inside `requireEntityRead` (2094). Explain why `search` uses the boolean form and not the throwing one.

### W2: the password and token helpers (easy)

**Goal.** Prove four facts about `src/domain/security.ts`:

- passwords are salted (`salt:hash`)
- a malformed stored hash verifies as `false` instead of throwing
- an unknown user still pays the scrypt cost
- tokens are 64 hex characters

**Hint.** `verifyPassword(password, encoded = dummyHash)` (lines 19-27) is called with `user?.passwordHash` by `login` (`erp-service.ts:224`). Node 22 can import this file directly because it has no relative imports and only type annotations.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sec from '../src/domain/security.ts';
test('security helpers', () => {
  const enc = sec.hashPassword('correct horse battery');
  assert.match(enc, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(sec.verifyPassword('correct horse battery', enc), true);
  assert.equal(sec.verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(sec.verifyPassword('anything'), false); // unknown user: dummy hash
  assert.throws(() => sec.hashPassword('short'), /12 to 256/);
  assert.match(sec.sessionToken(), /^[a-f0-9]{64}$/);
});
```

**Check.** `node --experimental-strip-types --test tests/practice-security.test.mjs` prints `# pass 1`. Then explain in one sentence what timing difference the default `dummyHash` parameter removes.

### W3: why `BEGIN IMMEDIATE` (medium)

**Goal.** Reproduce, with `node:sqlite` alone, the locking behavior that `SnapshotDatabase.access` relies on (`src/domain/database.ts:45`).

**Hint.** Open two `DatabaseSync` connections to one temp file with `{ timeout: 0 }`. Have connection A run `BEGIN IMMEDIATE`. Then try `BEGIN IMMEDIATE` on B. Then try a plain `BEGIN`, a `SELECT`, and an `UPDATE` on B.

**Check.** With A holding `BEGIN IMMEDIATE`:

- B's `BEGIN IMMEDIATE` throws an error matching `/locked/`.
- B's plain `BEGIN` succeeds and its `SELECT` returns the old row.
- B's `UPDATE` then throws `/locked/`.

Write down which of those outcomes would let two processes both decide "one unit is available" (the scenario `tests/concurrency.test.ts:134` guards), and why the real code passes `timeout: 5000` (`database.ts:10`) instead of 0.

### W4: one focused test, and a sabotage that does not break it (medium, needs `npm ci`)

**Goal.** Run only the receipt rollback test. Then predict what happens if you change `this.db.exec("ROLLBACK")` in the `catch` of `SnapshotDatabase.access` (`src/domain/database.ts:80-81`) to `this.db.exec("COMMIT")`.

**Hint.** Find the line that actually writes to SQLite (`database.ts:70-75`). Is it reached when `operation(state)` (line 65) throws? Then read the test's `snapshot()` helper (`tests/integrity.test.ts:38-45`): it reads `revision` and `body` straight from the database file.

**Check.** `npx vitest run tests/integrity.test.ts -t "rolls back an entire receipt"` reports 1 passed. Your prediction for the sabotage should be "still passes": the receipt's status, version, stock line and audit event were only ever mutations of the parsed in-memory `state`, and the `UPDATE` is never executed after a throw. So in this design the guarantee comes from "write once at the end", and `ROLLBACK` only releases the lock. Then name a change that *would* make the test fail. One example: a handler that catches the warehouse error and returns normally, so the write branch runs. Restore any edits (`git diff src/` empty). The vitest command was not re-run on 2026-10-06 because no dependencies were installed; the prediction follows from `database.ts:44-83`.

## Assignment A: make customer notes a complete vertical change

Add an optional internal note to customers, capped at 500 characters. Decide whether sales users, accounting users, and auditors can read it. Follow the field through the TypeScript model, runtime persisted schema, create and edit request schemas, workbench field definition, and tests.

Acceptance criteria: a note survives restart; an overlong note is rejected without accepting other edits in the same request; unknown request fields remain rejected; a stale edit cannot overwrite a newer note. Decide whether an absent field clears a note under the existing full-replacement edit contract, and document your choice. Do not accidentally introduce patch semantics for one field while treating every other field as a replacement.

Example review question: "If I add this property only to the interface, why does the application still reject it?" Answer by finding the runtime schema rather than weakening strict parsing.

## Assignment B: customer inactivity policy

The current master editor can mark a party inactive, but this starter does not implement a complete inactive-party policy across every business operation. Define one. A reasonable exercise policy blocks new quotations and orders for an inactive customer while preserving historical reads and allowing settlement of already posted invoices.

Acceptance criteria: new disallowed documents fail atomically; old invoices remain readable; a valid payment can settle a previously posted invoice; changing the customer's status does not rewrite historical document snapshots. Test both a UI path and a direct API path so hiding a selector option is not mistaken for enforcement.

Write down whether an existing draft may still be submitted after the customer becomes inactive. That decision affects the submit boundary and deserves a test. There is no useful universal answer without a chosen business policy.

## Assignment C: a complete create-request idempotency design

Add idempotency for customer creation. Scope a request key by current user, company, method, and route. Store a canonical request fingerprint and the accepted result in the same transaction as the new customer. Reusing a key with different data must fail. A matching replay must still authenticate current identity and apply the relevant current permission policy.

Acceptance criteria: a lost response followed by a matching retry creates one customer; a different payload with the same key fails; two processes using the same key produce one accepted record; another company cannot retrieve the stored result; storage limits and expiry behavior are explicit. Explain the distinction between expiring a receipt and allowing a previously used key to create another record later.

## Assignment D: move one collection toward relational storage

Normalize customers into a SQLite table with a compound company/code uniqueness constraint and a version column. Keep the remaining aggregate temporarily. Plan a migration and transaction boundary before changing the service. Avoid a dual-write design where the table succeeds and the aggregate fails independently.

Acceptance criteria: the existing customer CRUD and race tests still pass; the migration refuses incompatible input without replacing it; references remain company-scoped; a backup and restore rehearsal uses disposable files. Compare query cost and implementation complexity with the bounded aggregate approach.

## Assignment D, worked for one collection: customers as a table

**Schema** (a new migration step in `src/domain/database.ts`; today the only versioning is the `schema_version` column, which the `CHECK` at line 23 pins to 1, so this design bumps that check rather than inventing a second mechanism):

```sql
CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code       TEXT NOT NULL COLLATE NOCASE,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, code)
);
```

`COLLATE NOCASE` matters: the aggregate treats codes as unique case-insensitively (`src/domain/state-schema.ts:460-463` lowercases before comparing), and the test `rejects duplicate codes, fractional money, fractional quantity, and unknown fields` (`tests/integrity.test.ts:351`) submits `customer.code.toLowerCase()` and expects 400.

**Migration** (one transaction): read the JSON aggregate, `INSERT` every customer, remove the `customers` key from the aggregate, bump `schema_version`. If any insert fails, the transaction rolls back and the aggregate is untouched; fix the data and rerun.

**Service**: `listCustomers` (line 360) and `createCustomer` (line 370) read and insert the table with `WHERE company_id = ?`. Map `SQLITE_CONSTRAINT_UNIQUE` to the same **400** the aggregate produces today (`DomainError("code must be unique")` has the default status, `src/domain/errors.ts`). Edits currently go through the generic `editMaster` (line 2098), so customers need their own branch there: `UPDATE customers SET ..., version = version + 1 WHERE id = ? AND company_id = ? AND version = ?`, with `changes === 0` becoming the existing 409 "Record changed; reload current data before retrying" (lines 2176-2180). No dual write: once migrated, the aggregate no longer contains customers.

**Everything that references customers** (quotations, sales orders, invoices) keeps storing `customerId`. Today that reference is checked by `validateState` through the `refs` map (`src/domain/state-schema.ts:362-363`); after the move it becomes `SELECT 1 FROM customers WHERE id = ? AND company_id = ?` inside the same transaction.

**Tests**: uniqueness, including a case-only difference (400, one row); stale edit (second update is 409, `version` is 2); migration run twice is a no-op; and `rolls back an entire receipt` still passes.

Do this for `customers` only. Items and warehouses are the next two, in that order, each with the same four tests.

## Assignment E: partial order fulfillment

The delivered linked-document policy requires complete matching lines and one posted receipt or invoice of each supported type per purchase order. Design partial fulfillment as a separate feature. Track fulfilled quantities by stable order-line identity, define over-fulfillment rules, and distinguish reservation release from invoice creation.

Acceptance criteria: two concurrent partial submissions cannot exceed the ordered quantity; repeated submission does not consume quantity again; cancellation or reversal has an explicit policy; reports distinguish ordered, reserved, received, invoiced, and remaining quantities. Do not simply remove the complete-line comparison and call partial fulfillment finished.
