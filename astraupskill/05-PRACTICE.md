# 5. Practice assignments with acceptance criteria

Use a fresh practice database and a branch or separate copy for your exercises. Each assignment should produce a focused change, a short explanation, and evidence tied to the stated behavior. The exercises below are future learning work; they are not claims about functionality already implemented.

## Assignment A: make customer notes a complete vertical change

Add an optional internal note to customers, capped at 500 characters. Decide whether sales users, accounting users, and auditors can read it. Follow the field through the TypeScript model, runtime persisted schema, create and edit request schemas, workbench field definition, and tests.

Acceptance criteria: a note survives restart; an overlong note is rejected without accepting other edits in the same request; unknown request fields remain rejected; a stale edit cannot overwrite a newer note. Decide whether an absent field clears a note under the existing full-replacement edit contract, and document your choice. Do not accidentally introduce patch semantics for one field while treating every other field as a replacement.

Example review question: ?If I add this property only to the interface, why does the application still reject it?? Answer by finding the runtime schema rather than weakening strict parsing.

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

**Schema** (`src/domain/database.ts`, a migration step guarded by `PRAGMA user_version`):

```sql
CREATE TABLE customers (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, code)
);
```

**Migration** (one transaction): read the JSON aggregate, `INSERT` every customer, then remove the `customers` key from the aggregate and bump `user_version`. If any insert fails (a duplicate code the aggregate tolerated), the transaction rolls back and the aggregate is untouched; fix the data, rerun.

**Service**: `listCustomers`/`getCustomer` read the table (`WHERE company_id = ?`); `createCustomer` inserts and maps `SQLITE_CONSTRAINT_UNIQUE` to the same 409 the aggregate produced; `updateCustomer` is `UPDATE customers SET ..., version = version + 1 WHERE id = ? AND company_id = ? AND version = ?` and `changes === 0` is the 409 stale edit. No dual write: the aggregate no longer contains customers after the migration, so a table success cannot leave the aggregate behind.

**Everything that references customers** (quotations, sales orders, invoices) keeps storing `customerId`; the reference check becomes `SELECT 1 FROM customers WHERE id = ? AND company_id = ?` inside the same transaction that writes the order.

**Tests**: uniqueness (second `createCustomer` with the same code is 409 and the table has one row); stale edit (two reads, two updates, second is 409, `version` is 2); migration idempotency (running the migration twice is a no-op); and the existing `rolls back an entire receipt` case still passes, proving the table participates in the same transaction.

Do this for `customers` only. Items and warehouses are the next two, in that order, each with the same four tests.

## Assignment E: partial order fulfillment

The delivered linked-document policy requires complete matching lines and one posted receipt or invoice of each supported type per purchase order. Design partial fulfillment as a separate feature. Track fulfilled quantities by stable order-line identity, define over-fulfillment rules, and distinguish reservation release from invoice creation.

Acceptance criteria: two concurrent partial submissions cannot exceed the ordered quantity; repeated submission does not consume quantity again; cancellation or reversal has an explicit policy; reports distinguish ordered, reserved, received, invoiced, and remaining quantities. Do not simply remove the complete-line comparison and call partial fulfillment finished.
