# 2. Concepts that turn CRUD into reliable business software

## Atomicity includes every side effect in the database

A purchase receipt is more than a status string. It can add several stock movements, create accounting entries, update its version, and append an audit event. The original code could change status and post the first line before discovering that a later line lacked a warehouse. A caught exception alone did not undo those earlier mutations.

The new transaction treats the complete operation as one candidate state. If any step throws, the adapter rolls back. The service may still mutate its candidate in a readable sequence; other requests never observe that incomplete candidate. A test compares the database row before and after rejection, covering status, counters, stock, accounting, and audit together.

```ts
store.access(true, () => {
  const context = service.authenticate(token, companyId);
  return service.submitPurchaseReceipt(context, receiptId);
});
```

Authorization belongs inside that callback. Checking a user's old role before loading current data creates a gap in which revoked permissions may remain usable.

## A teaching shortcut, not credential handling

`data/local-credentials.json` exists so a learner can sign in without an identity provider. Real systems never write generated passwords to a file next to the database: credentials come from a secret store or an identity provider, are hashed at rest (this project does hash them in SQLite), and are never printed. Treat the file as a fixture and delete it when you finish (README).

## Optimistic concurrency is a conversation with another editor

A customer at version 4 is loaded into two tabs. Tab A saves a new address and advances the record to version 5. Tab B still sends version 4. Its request must be rejected rather than silently replacing A's work.

```json
{
  "version": 4,
  "data": {
    "name": "Northwind Retail",
    "code": "CUST-001",
    "status": "active",
    "billingAddress": "New address from the older tab"
  }
}
```

The API returns 409. The browser preserves B's inputs and offers draft export or loading the current record. Loading is an explicit replacement of the draft. Do not automatically fetch and resubmit B's changes with version 5: that would make the version check decorative while still overwriting another person's work.

SQLite serialization and record versions solve different problems. The transaction makes competing database writes take turns. The expected version checks whether a human's editing baseline is still current after that turn begins. Both are needed.

## Identity, membership, and permission are separate checks

A random bearer identifies a session. The session points to a current active user and expires after 30 minutes. The request must explicitly select a company that the user belongs to. The operation then checks a role such as `sales_user` or `project_user`.

A valid login does not authorize every company. A valid company selection does not authorize every module. A hidden button is only a usability feature; a direct HTTP request must encounter the same server policy. Comments, attachments, search, and reference selectors are also data access paths. They deserve policy decisions instead of becoming convenient bypasses around the main list endpoints.

The workbench returns small permitted reference lists for selectors. A project user can receive customer names and IDs for linking delivery work, without receiving the full customer contact record through the customer list API. Record that distinction when reviewing permission changes.

## Money and stock need explicit units

This workshop supports USD and whole stock units. Monetary input is bounded and accepts at most two decimal places. Convert amounts to cents before comparisons and sums that decide a business rule:

```ts
const outstandingCents = cents(invoice.outstandingAmount);
if (cents(payment.amount) > outstandingCents) {
  throw new DomainError("Payment exceeds outstanding balance", 409);
}
```

A quantity of 1.5 is rejected here. That is a scope choice, not a universal inventory rule. Supporting kilograms or hours as stock quantities would require a documented scale and rounding policy throughout quantities, reservations, valuation, and tests.

Invoice lines snapshot the item's stock classification and standard cost when created. Later catalog edits do not rewrite those accepted facts. The accounting model remains illustrative: purchase receipts use their purchase rate while sales use snapshotted standard cost. Production valuation, price variances, taxes, periods, and reconciliation are outside this implementation.

## Replay is not equality of values

Two identical receipt lines are still two legitimate lines. The old ledger helper deduplicated equal values and could drop one. The corrected code retains each line. Repeating submission of an already posted document returns its existing result without reposting.

This is document-level replay protection. Creating a new invoice after losing a create response is a different request and can produce another draft. The UI warns about an uncertain response and preserves the draft for review; it does not provide durable create-request idempotency. A mid-level engineer should explain that distinction without claiming exactly-once delivery.
