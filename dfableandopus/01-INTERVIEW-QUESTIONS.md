# Interview questions: E20 ERP starter

Marked **J** (junior) or **M** (mid). Every technical answer names a line you can open.

## Screening

### Q1 (J). Describe the persistence model in one minute.

One row. `SnapshotDatabase` in `src/domain/database.ts` keeps a single table, `workspace`, with `CHECK(id=1)`, a `schema_version`, a `revision` counter and a `body` column holding the entire state as JSON, declared `STRICT` (`src/domain/database.ts:23`). Every collection lives inside that JSON: companies, users, sessions, customers, suppliers, items, warehouses, all the sales and purchase documents, `stockLedgerEntries`, `glEntries`, projects, tasks, timesheets, audit entries. It is bounded: at most 10,000 records per collection, 1,000 sessions (`src/domain/state-schema.ts:341`) and a 20 MiB serialized workspace (`src/domain/state-schema.ts:345`).

### Q2 (J). Where does a request's transaction begin and end?

In one place, and this is the answer worth leading with. `app.addHook("onRoute", ...)` at `src/app.ts:39` replaces every registered route handler with a wrapper that calls `store.access(write, () => handler.call(this, request, reply))`, where `write` is true for anything other than `GET` and `HEAD` (`src/app.ts:43`). So every handler runs inside a transaction by construction. A new route cannot forget it, because the hook is applied at registration time rather than by convention.

### Q3 (J). What happens inside `access`?

`SnapshotDatabase.access(write, operation)` at `src/domain/database.ts:44` does five things: `BEGIN IMMEDIATE` for writes or `BEGIN` for reads; read the row's metadata and reject an unsupported `schema_version` or an oversized body; parse and validate the JSON body; run the operation against the in-memory state; then, if this was a write, re-validate and re-serialize and `UPDATE` only if the serialized text actually differs, incrementing `revision`. Any throw hits the `catch` and issues `ROLLBACK`.

### Q4 (J). How does a read request avoid corrupting state?

It is checked explicitly. In the non-write branch, `JSON.stringify(state) !== body` throws "Read handler attempted to mutate state". A `GET` handler that mutates the aggregate is caught and rolled back rather than silently discarded, which is stronger than just not saving: it turns a latent bug into a failing test.

### Q5 (J). What does the error handler expose?

`app.setErrorHandler` at `src/app.ts:402` distinguishes known from unknown. A `DomainError` carries its own `statusCode` (`src/domain/errors.ts:1-8`), a `ZodError` becomes 400, and anything else falls back to the framework's `statusCode` or 500. The message is only passed through for known errors; an unknown error under 500 becomes "Invalid request" and a 500 becomes "Operation could not be saved; no change was accepted" (`src/app.ts:416-421`). The `requestId` is always returned. That last message is a deliberate promise, and the rest of the architecture is what makes it true.

### Q6 (M). How are passwords and tokens stored?

`src/domain/security.ts`. Passwords: a random 16-byte salt and `scryptSync(password, salt, 64)`, stored as `salt:hash`, with a 12 to 256 character length rule. Verification re-derives and compares with `timingSafeEqual`, and it validates the stored format with two regexes first, returning false rather than throwing on a malformed record. Sessions: a 32-byte random token, of which only `sha256` of the token is stored via `tokenHash`. The test `stores hashes rather than passwords or bearer tokens` (`tests/integrity.test.ts:102`) asserts it against the persisted state rather than trusting the code.

Note the `dummyHash` constant: `verifyPassword` defaults to it when no encoded hash is supplied, so an unknown username still costs a full scrypt derivation. That is a timing-attack defence against user enumeration.

### Q7 (M). What does the request boundary reject before any handler runs?

`app.addHook("onRequest", ...)` at `src/app.ts:28`. The `Host` header must match `localhost` or `127.0.0.1` with an optional port, otherwise 403; an `Origin`, if present, must equal `http://${host}`, otherwise 403. Then `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` are set on the reply. Fastify's own `bodyLimit` is 256 KiB (`src/app.ts:16`). Login gets an in-process rate limit of 10 attempts per IP per minute, with a second guard that refuses new IPs once the map holds 1,000 entries so the limiter itself cannot be used to exhaust memory (`src/app.ts:61-81`).

### Q8 (M). How is authorization structured?

Two layers. Operation-level: `requireRoles(context, [...])` at the top of each service method, for example the three roles allowed to submit a purchase receipt at `src/domain/erp-service.ts:981-985`. Entity-level: `canReadEntity(context, type)` at `src/domain/erp-service.ts:2070` holds a policy map from entity type to the roles that may read it, and always admits `system_admin`, `company_admin` and `auditor` on top of the per-type list. `requireEntityRead` turns a false into a `DomainError` with 403 at `src/domain/erp-service.ts:2094-2095`. Note that `Object.hasOwn(policy, type)` means an unknown type is refused rather than defaulting to allowed.

## Deep dive

### Q9 (M). Walk me through the bug the worked change fixed.

A purchase receipt with two lines, the first naming a warehouse and the second not. The old flow marked the document submitted, posted the first line's stock, then threw on the second. The user saw an error while the business state had already changed, which is the worst combination: an error you cannot trust and data you now have to reconcile by hand.

Read the order of statements in `submitPurchaseReceipt`. The status is set to `submitted`, `updatedAt` refreshed and `version` incremented at `src/domain/erp-service.ts:1017-1019`, and only then does the loop over `receipt.items` run, throwing "Purchase receipt lines require warehouseId" at `src/domain/erp-service.ts:1025-1027` for the bad line after `postStock` has already pushed a ledger entry for the good one. That ordering is still there. What changed is that all of it happens inside one transaction, so the throw rolls back the whole aggregate and none of those mutations reach the row.

### Q10 (M). Is that a fix or a workaround? An interviewer will push here.

It is a real fix, and the reason is worth stating precisely: the mutations are made against an in-memory object graph that is only serialized and written at the end of `access` (`src/domain/database.ts:68-73`). Nothing is durable until the `UPDATE` runs, so an exception anywhere in the handler leaves no trace. It is not a workaround for badly ordered code; it is the property that makes the ordering not matter, which is exactly what a transaction is for.

The honest caveat, which I would offer before being asked: this only holds because the whole aggregate is one row. If persistence were normalized across twenty tables, the same guarantee would need a real transaction over twenty statements, and you would have to check every write path went through it. The `onRoute` hook is how you would enforce that, and it is the part of this design that generalizes.

### Q11 (M). Describe the test that proves the rollback.

`rolls back an entire receipt when a later line lacks a warehouse` at `tests/integrity.test.ts:161`. It creates a draft with one line naming a warehouse and one without, captures the database row, submits, asserts a 400, then asserts the row is deeply equal to the captured one. The assertion is the point. A `expect(response.statusCode).toBe(400)` alone would have passed against the buggy code too, because the old code also returned an error. What the snapshot adds is proof that no version was consumed, no audit event appended, no stock ledger entry left and no document status changed.

### Q12 (M). How does replay protection work on submission?

The document's own status is the guard. `submitPurchaseReceipt` returns the existing receipt immediately if `receipt.status === "submitted"` (`src/domain/erp-service.ts:991-993`), before any check runs. So a repeated submit is a no-op returning the same document, and because `access` only writes when the serialized state differs (`src/domain/database.ts:69-73`), the persisted row is byte-identical and the `revision` does not even advance.

The design decision behind it is stated in the course: deduplication belongs at the business operation boundary, not inside `postStock` searching for equal quantities and values. `postStock` at `src/domain/erp-service.ts:2446` deliberately just pushes a ledger entry, so two genuinely identical lines both survive, which `retains identical stock lines and replays submit only once` (`tests/integrity.test.ts:175`) pins.

### Q13 (M). What is not idempotent here, and why does it matter?

Creation. `astraupskill/VERIFICATION.md` says it plainly: submitted-document replay is supported, durable idempotency for creation requests is not. After a lost create response you must inspect current data before deciding to retry. There is even a browser scenario that deliberately loses a create acknowledgement, so the gap is demonstrated rather than hidden. The fix is a client-supplied idempotency key stored with the document, and the reason it is not there is that the aggregate has no uniqueness enforcement beyond what the schema validates.

### Q14 (M). Explain the stale-edit contract.

`editMaster` at `src/domain/erp-service.ts:2098` requires an envelope parsed with `z.object({ version: z.number().int().positive(), data: z.unknown().optional() }).strict()` (`src/domain/erp-service.ts:2158-2164`). `.strict()` means an unknown envelope field is a 400 rather than ignored. The version is compared against the loaded record and a mismatch is a 409 with "Record changed; reload current data before retrying" (`src/domain/erp-service.ts:2176-2180`). On success the record's version is incremented (`src/domain/erp-service.ts:2215-2218`) and the audit entry records `previousVersion`.

The subtle part is at `src/domain/erp-service.ts:2203-2214`: every key on the record except `id`, `companyId`, `createdAt`, `updatedAt`, `createdBy` and `version` is deleted before `Object.assign`. That makes the edit a genuine full replacement, so a field omitted from the payload is removed rather than retained. If you only assigned, an omitted optional field would silently keep its old value, and clients would get different behaviour depending on whether they sent a full object.

### Q15 (M). Deletes have two guards. What are they?

First, referential: a record with comments or attachments referring to it cannot be deleted, 409 "Record has discussion history; retain it" (`src/domain/erp-service.ts:2181-2190`). Second, the version check above applies to deletes too, so you cannot delete a record you have not looked at recently. The test that covers both together is `guards stale edits and referenced deletes atomically` (`tests/integrity.test.ts:327`), and "atomically" is the operative word: the guard and the delete are in one transaction.

### Q16 (M). There is a domain-specific immutability rule in `editMaster`. Find it and justify it.

`src/domain/erp-service.ts:2194-2202`: for the `items` collection, if `isStockItem` differs from the stored value and any `stockLedgerEntries` row references that item, the edit is a 409, "Stock classification cannot change after ledger history". Flipping an item from stock to service after it has been received and posted would make the existing ledger entries meaningless, and no later correction can reconstruct what the quantities meant. Refusing is the only honest answer.

The related rule is cost snapshotting: a sales invoice line captures `standardCost` at draft creation, and editing the catalog item afterwards does not rewrite it. `keeps accepted costs after item edits` (`tests/integrity.test.ts:228`) is the test. Both rules are the same principle: a posted document records what was true when it was accepted.

### Q17 (M). How is stock availability checked, and what is the race?

Availability is ledger quantity minus outstanding reservations from submitted sales orders, and a negative result is rejected before commit, so the losing invoice stays draft and its ledger entries vanish with the rollback. The test `rejects insufficient stock without ledger, status, or audit changes` (`tests/integrity.test.ts:198`) covers the single-process case and `respects reservations when invoicing unrelated orders` (`:209`) covers the reservation interaction.

The real proof is cross-process. `tests/concurrency.test.ts:134`, `two processes cannot consume the same last stock unit`, runs actual server instances against one database file, and `:117` does the same for version conflicts. That is the test that justifies `BEGIN IMMEDIATE` rather than `BEGIN` on writes: the write lock is taken at the start of the transaction, so the second process cannot read, decide and then discover it lost.

### Q18 (M). What breaks if `access` uses `BEGIN` instead of `BEGIN IMMEDIATE` for writes?

Both processes begin as readers, both read the same aggregate, both decide there is one unit available, and both try to upgrade to a write lock. SQLite gives one of them `SQLITE_BUSY`, so you do not get corruption, but you do get a failure at commit time on work that has already been decided, instead of a clean serialization at the start. `tests/concurrency.test.ts:134` is the test that would start failing intermittently, which is the worst kind of failure to debug.

### Q19 (M). What does `validateState` do, and why is it called twice?

It parses the whole aggregate against the Zod schema in `src/domain/state-schema.ts`, enforcing per-collection caps and the 20 MiB serialized limit (`src/domain/state-schema.ts:341-348`). `access` calls it on the way in, so a corrupted or hand-edited row is refused with "Stored workspace is invalid; original data preserved" rather than loaded, and again on the way out, so a handler bug cannot persist a state that would fail to load next time. Refusing rather than repairing is the stated policy, and `does not overwrite malformed persisted state` (`tests/integrity.test.ts:490`) is the test.

### Q20 (M). Why does `access` reject a promise from the operation?

Two places do it: `src/domain/database.ts:66-67` and again in `ERPStore.access` at `src/domain/store.ts:100-105`. The transaction is driven by synchronous `BEGIN`/`COMMIT` statements on `DatabaseSync`, so an async callback would return a pending promise, `COMMIT` would run immediately, and the real work would happen afterwards with no transaction at all. Detecting a thenable and throwing turns a silent correctness disaster into an immediate error, covered by `refuses asynchronous transaction callbacks and rolls back` (`tests/integrity.test.ts:498`).

## Behavioral

### Q21 (M). Tell me about a defect where the user saw an error but the data had changed anyway.

**S**: Submitting a purchase receipt with two lines, the second missing a warehouse. **T**: Make submission all-or-nothing. **A**: I could have reordered the validation to run before any mutation, which would have fixed this one case. Instead I moved the boundary: every route handler now runs inside one database transaction, installed once in a Fastify `onRoute` hook so a new route cannot opt out, with writes taking `BEGIN IMMEDIATE`. Mutations happen against an in-memory aggregate that is only serialized at the end, so a throw anywhere leaves nothing behind. **R**: `tests/integrity.test.ts:161` captures the database row, attempts the submission, asserts 400 and then asserts the row is deeply unchanged, which proves no version consumed, no audit event, no orphan stock entry. Reordering the checks would have passed a weaker test and left the next handler free to make the same mistake.

### Q22 (M). Tell me about a test you did not accept.

A run of 38 tests produced passing assertions and a nonzero process exit code. I did not record it as verification. Passing assertions with a failing exit code means something is wrong outside the assertions, typically a handle or a child process not closing, and it is exactly the sort of thing that becomes an unexplained CI flake later. The accepted run was 39 of 39 with exit code 0, using one Vitest worker with file parallelism disabled and explicit hook and test timeouts, because the cross-process scenarios need real servers. The combined verification figure is 46 unique checks, 39 API and process tests plus seven browser scenarios, with five reruns after a visual fix counted as rechecks rather than as new tests.

### Q23 (J). Tell me about a time visual review found something tests could not.

The seven Chromium scenarios all passed and the screenshots showed a status banner overlapping content. No assertion covered it, because nothing was broken in a way the DOM reported. I added a non-overlap assertion and reran the five affected scenarios, and I recorded them as rechecks rather than as five additional unique checks, because inflating a count is the same class of error as not looking at the screenshots.

### Q24 (J). Tell me about scope you deliberately refused.

Manufacturing and reconciliation stock modes. They are rejected with an explicit error rather than partially implemented, and `rejects unsafe attachment URLs and unsupported stock modes` (`tests/concurrency.test.ts:273`) pins the refusal. The same applies to partial fulfillment: a linked invoice must match the order's quantities and rates completely, and a mismatched subset fails explicitly rather than doing something plausible. A half-implemented accounting feature is worse than an absent one, because someone will rely on it.

## Follow-ups an interviewer asks next

### F1. "One row for the whole workspace. Defend it."

For this scale it buys a real property cheaply: atomicity across the entire model, so a receipt, its stock ledger entries, its general-ledger lines and its audit event either all exist or none do. Getting that across normalized tables takes discipline on every write path. It fails on concurrency, since writes serialize globally, and on query cost, since every request parses and re-serializes the whole aggregate. The bounds in the schema, 10,000 records per collection and 20 MiB, are the design admitting where it stops. I would keep it for a teaching system and replace it the moment two users write concurrently in anger.

### F2. "Every handler is in a transaction, including reads. Isn't a read transaction wasteful?"

A plain `BEGIN` on a read is cheap and buys a consistent snapshot, which matters here because a report reads several collections and would otherwise be able to see a half-applied write. The genuine cost is that a long read blocks a writer, which on one SQLite file it would anyway.

### F3. "Where would the aggregate design bite you first in production?"

Write throughput, and it would show as latency rather than as errors, because `BEGIN IMMEDIATE` queues writers rather than failing them. The second thing is the serialize-compare step at `src/domain/database.ts:69-73`: stringifying the whole workspace on every write is linear in total data, so a workspace near the 20 MiB cap pays that on every single mutation.

### F4. "Your CSV escaping wraps everything in quotes. Is the formula guard still needed?"

Yes, and they solve different problems. The quoting and the `"` doubling at `src/domain/erp-service.ts:2289-2290` make the file parse correctly. The apostrophe prefix on a value matching `/^[\s]*[=+@-]/` (`src/domain/erp-service.ts:2288`) stops a spreadsheet evaluating the cell as a formula, which quoting does not prevent because the spreadsheet strips the quotes as CSV syntax before looking at the content. `guards host and origin and neutralizes CSV formulas` (`tests/integrity.test.ts:426`) covers it.

### F5. "Port the transaction wrapper to ASP.NET Core."

A middleware or an `IAsyncActionFilter` that begins a transaction on the scoped `DbContext` for non-`GET` requests, commits on success and rolls back on an unhandled exception, registered globally so no controller opts in. The structure is identical; what changes is that EF Core tracks entities rather than you mutating a parsed object, so "only write if something changed" comes free from change tracking instead of a string comparison.
