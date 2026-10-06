# 6. Review your solutions as a mid-level engineer

Use this guide after attempting the assignments. It gives the reasoning a reviewer should expect rather than a large patch to paste without understanding. Compare the proposed boundary with your implementation and explain any deliberate difference.

## Warm-up answers

**W1.** Identity: `authenticate` (`erp-service.ts:250-262`). Operation roles: `requireRoles` (2499) at the top of each method. Entity reads: `requireEntityRead` (2093) for comments and attachments, and `canReadEntity` (2070) inside `search`. `search` uses the boolean form (line 1762) because a mixed result list should be *filtered*: a sales user searching "North" should still see customers even though a matching project is hidden. Throwing would turn one forbidden match into a 403 for the whole search.

**W2.** Passes (verified 2026-10-06 on Node 22.16.0 with `--experimental-strip-types`). The default `encoded = dummyHash` (`security.ts:16-19`) means `login` runs a full scrypt derivation even when no user has that email (`erp-service.ts:224`). An attacker therefore cannot tell "unknown email" from "wrong password" by response time. Both branches end in the same `DomainError("Invalid credentials", 401)` (lines 225-226).

**W3.** Verified 2026-10-06 with a scratch `node:sqlite` test. A plain `BEGIN` is deferred: B can read the old row while A holds the write lock, and only fails when it tries to write. That is the dangerous shape. Two processes both read "one unit available", both decide to sell it, and the loser fails at write time after doing all its work, or, with a busy timeout, waits and then fails. `BEGIN IMMEDIATE` makes the loser wait *before* it reads, so it reloads the winner's state and fails the availability check cleanly. The real code's `timeout: 5000` (`database.ts:10`) turns "locked" into "wait up to five seconds", which is why the concurrency tests see business statuses rather than an SQLite error: `[200, 409]` for the version race and `[200, 400]` for the last-unit race (`tests/concurrency.test.ts:127` and `:161`).

**W4.** The sabotage does not break the test. This is the most important thing to understand about this design. Mutations happen on the parsed `state` object (`database.ts:61-65`); SQLite only changes at `database.ts:70-75`, which a throw skips. A sabotage that *does* break it must let the operation return normally after partial mutation, for example swallowing the warehouse error inside `submitPurchaseReceipt`. That is exactly the bug class the original code had at the service level.

## Review notes on the delivered code

These are observations with evidence, for practising review comments. They are not defects the course asks you to fix.

- **Validate-then-mutate would read better.** `submitPurchaseReceipt` sets `status`, `updatedAt` and `version` (lines 1017-1019) before the loop that can throw on a missing warehouse (1022-1027). It is correct only because of the write-once transaction. A reviewer may still ask for validation first, so the method is correct on its own and not only by virtue of its caller.
- **Expired sessions are pruned only at login** (lines 228-230). With the 1,000-session cap (231-235), a workspace can return 429 "Session capacity reached" until enough sessions expire *and* someone logs in. That is acceptable for a local teaching app; worth stating if asked about multi-user scale.
- **The login rate limiter is per process** (`app.ts:48`, `61-81`). The `authAttempts` map lives in memory. The concurrency tests run two server processes against one database, and each would allow ten attempts per IP per minute. A restart also resets it.
- **Results are cloned out of the transaction** (`store.ts:106`, `structuredClone(result)`). Without this, a handler could return a live reference into `state`, and Fastify would serialize it after the lock was released. Point at this line when someone asks how the read-only and write-once rules stay enforceable.

## A field addition needs both compile-time and runtime contracts

For customer notes, the model change helps the compiler, while the persisted schema protects actual stored values. The request schema defines what a client may submit. The browser field controls how a person enters it. A good test saves through the API, closes the application, opens the same database, and reads the note again.

```ts
// Sketch for the exercise, not a delivered field:
const customerInput = existingCustomerInput.extend({
  internalNote: z.string().trim().max(500).optional(),
});
```

A reviewer should reject a change that merely allows arbitrary keys to make the new property pass. That removes protections for unrelated fields such as company ownership and creation metadata. Also check whitespace behavior: do blank notes become absence, an empty string, or a validation error? Pick one representation and use it consistently.

## A status policy belongs at each acceptance boundary

For inactive customers, checking only the create form is insufficient. An old browser tab or API client can still send the request. Checking only draft creation is also insufficient if the business policy says existing drafts must be blocked at submission after deactivation.

A small reusable service helper can read the current customer and enforce the chosen policy inside the transaction. Keep settlement rules separate from new-business rules. Otherwise a well-intentioned inactivity check may prevent receiving payment for an existing debt. A convincing solution includes the counterexample: deactivate a customer with a posted invoice and show that the chosen settlement behavior still works.

## Idempotency is stored evidence of one accepted command

A key by itself does not prove that two requests mean the same thing. Canonicalize the relevant payload, bind it to identity and company scope, and persist the fingerprint with the result. Do not include transient values such as a newly generated server timestamp in a fingerprint that must match a retry.

The record creation and its receipt must commit together. If the receipt is written afterward, a crash between those steps can still produce duplicates. If the receipt is written first, a crash can falsely report a result whose record never existed.

A reviewer should ask what happens after a role is revoked, after a receipt reaches its storage limit, and after a matching request arrives through a different process. These are part of the design, not optional cleanup after the happy path works.

## A migration is also a failure-sensitive operation

For normalized customer storage, write down which representation is authoritative at each migration step. A backup is useful only if you can restore it into a disposable workspace and read the expected records. Preserve the original source when migration validation fails. Do not silently seed an empty database in response to a malformed existing file.

Use a transaction to coordinate schema changes and data movement where the chosen database supports the required operation. Test unique codes that differ only in case, references across companies, and stale versions after migration. A table definition alone does not preserve the existing service contract.

## Partial fulfillment needs quantities attached to identity

An order with two identical item lines demonstrates why matching only by item ID is ambiguous. A strong design retains the originating order-line ID and records how much of that line each accepted fulfillment consumed. The concurrent acceptance check compares cumulative accepted quantity with the original line quantity inside the same transaction.

Conclude your review with three concrete statements: what behavior changed, what evidence supports it, and which related behavior remains outside scope. Avoid saying "production ready" when the exercise has not covered authentication operations, financial policy, deployment, recovery, and load characteristics.
