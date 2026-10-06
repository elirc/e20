# 3. Worked change: make a receipt submission all-or-nothing

The motivating failure is concrete. A receipt contains two widget lines. The first names a warehouse; the second does not. In the original flow, submission could mark the document submitted, post the first stock line, then throw on the second line. The user saw an error while the business state had already changed.

Read `submitPurchaseReceipt` in [the service](../src/domain/erp-service.ts). Then locate the test named `rolls back an entire receipt when a later line lacks a warehouse` in [the integrity suite](../tests/integrity.test.ts). The test creates a valid draft with the incomplete warehouse selection, captures the database row, attempts submission, and compares the entire row afterward.

```ts
const draft = await createReceipt({
  supplierId,
  items: [
    { itemId, quantity: 2, warehouseId },
    { itemId, quantity: 1 },
  ],
});
const before = snapshot();
const response = await submitReceipt(draft.id);
expect(response.statusCode).toBe(400);
expect(snapshot()).toEqual(before);
```

The helper names above explain the scenario; use the actual `ok`, `request`, and `snapshot` helpers in the test file when reproducing it. The important assertion is stronger than checking an error status. It proves that the failed attempt did not consume a version, append an audit event, leave one stock entry, or change the persisted document.

## Follow a successful version of the same operation

Change the second line to use the same warehouse. Both lines should now be accepted. If both lines contain quantity 2 at USD 30, the result is four units with a receipt value of USD 120. The two stock movements must both remain, even though their values are identical.

```text
Receipt line A: +2 units, +60 value
Receipt line B: +2 units, +60 value
Stock total:    +4 units, +120 value
General ledger: Inventory debit 120; GRNB credit 120
```

GRNB means goods received not billed. It records the illustrative liability between receipt and purchase invoice. This lesson is about balanced posting and transaction boundaries; it does not establish that this starter covers every accounting policy required by a real business.

Repeat the submit request for that same receipt ID. The document's submitted status is the replay guard. The second request should return the existing receipt while the persisted row remains identical. This is why deduplication belongs at the business operation boundary rather than inside `postStock` as a search for equal quantities and values.

## Extend the trace to a sales invoice

Create a one-unit invoice after receiving stock. At draft creation, inspect the line's `standardCost` and `isStockItem`. Edit the catalog item's current standard cost. Submit the draft and verify that the invoice still uses its accepted line cost. An item edit must not silently rewrite the financial meaning of a previously created document.

Now reserve the last available unit by submitting a sales order. Attempt to submit a separate, unlinked invoice for that unit. Candidate validation subtracts outstanding submitted-order reservations from ledger quantity and rejects negative availability. Because validation runs before commit, the losing invoice remains draft and its ledger entries disappear with the rollback.

For an invoice linked to the order, the complete matching quantities and rates are required. The order must belong to the same company and customer and be submitted. Posting the matching invoice completes the order, releasing its reservation while recording the actual stock deduction in the same transaction. Partial fulfillment is intentionally unsupported, so mismatched subsets fail explicitly.

## Review the change like a teammate

Describe the trigger, the previous defect, the new behavior, and the proof. For example: "A later receipt line without a warehouse used to leave earlier stock postings. Submission now runs inside one database transaction, and a regression test proves the persisted row is unchanged after rejection." That description is more useful than "improved error handling" because a reviewer can reproduce it and identify the exact guarantee.
