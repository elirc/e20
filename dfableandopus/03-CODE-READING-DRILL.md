# Code reading drill

Six drills for a screen-share round. Ten minutes each, answers closed.

## Drill 1: explain this hook

`src/app.ts:39-47`

```ts
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    route.handler = async function (request, reply) {
      return store.access(!["GET", "HEAD"].includes(method), () =>
        handler.call(this, request, reply),
      );
    };
  });
```

Explain what this buys, why `onRoute` rather than `onRequest`, and what the `handler.call(this, ...)` is protecting.

<details>
<summary>Answer</summary>

**What it buys.** Every route handler runs inside one database transaction, and the transaction is a write transaction for anything other than `GET` or `HEAD`. Because the wrapping happens when a route is *registered*, a developer adding a new route gets the behaviour without knowing the hook exists. That is the difference between a guarantee and a convention, and it is the whole answer to "how do you know no handler writes outside a transaction".

**Why `onRoute` and not `onRequest`.** `onRequest` runs per request but cannot wrap the handler; it runs *before* it and returns before the handler does. A transaction needs to span the handler's execution and see whether it threw, which means you need to be in the call chain around it, not beside it. `onRoute` lets you replace the function itself, which is the only hook that gives you that.

**Why `handler.call(this, ...)`.** Fastify binds handlers to the Fastify instance, so `this` inside a handler is the app and gives access to decorators. A plain `handler(request, reply)` would lose it, and any handler using `this` would break in a way that only shows up for the handlers that happen to use it. Preserving `this` explicitly is the kind of detail that separates a wrapper that works from one that works today.

**The one wart to name.** `route.method` can be an array, and this takes `[0]`. A route registered for both `GET` and `POST` in one call would be classified by its first method. It is correct for how this app registers routes and it is a latent trap, which is a good thing to say out loud rather than to defend.
</details>

## Drill 2: spot the bug

A **mutated** copy of the transaction core. The real code is `src/domain/database.ts:44-83`. Find the defect.

```ts
  access<T>(write: boolean, operation: (state: ERPState) => T): T {
    this.db.exec("BEGIN");
    try {
      const row = this.db
        .prepare(
          "SELECT schema_version,revision,length(CAST(body AS BLOB)) AS bytes FROM workspace WHERE id=1",
        )
        .get();
      if (!row || row.schema_version !== 1 || Number(row.bytes) > MAX_BYTES)
        throw new Error("Unsupported or oversized workspace; original data preserved");
      const body = this.db.prepare("SELECT body FROM workspace WHERE id=1").get()!.body as string;
      const state = validateState(JSON.parse(body));
      const result = operation(state);
      if (write) {
        const validated = JSON.stringify(validateState(state));
        if (validated !== body)
          this.db.prepare("UPDATE workspace SET body=?,revision=revision+1 WHERE id=1").run(validated);
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
```

<details>
<summary>Answer</summary>

`BEGIN` is unconditional. The real line is `this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN")` (`src/domain/database.ts:45`).

Why it matters, and why it is not a style preference. SQLite's plain `BEGIN` is a deferred transaction: it takes no lock until the first statement, and a `SELECT` takes only a read lock. So under the mutation, two server processes writing concurrently both begin as readers, both read the same workspace, both decide the last unit of stock is available, and both reach the `UPDATE`. One gets the write lock; the other gets `SQLITE_BUSY` at that point, having already done all the work and made a decision it cannot honour. `BEGIN IMMEDIATE` takes the write lock at the start, so the second process waits at `BEGIN` and then reads state that already includes the first process's commit.

The failure mode is the nasty kind: nothing is corrupted, so the symptom is an intermittent error under load rather than a wrong number, and the tests that catch it are the slow ones. `tests/concurrency.test.ts:134`, `two processes cannot consume the same last stock unit`, and `:117`, `two server processes cannot both accept the same expected version`, run genuine server instances against one database file and are exactly the tests that would start flaking.

Two smaller things also went missing in the mutation and are worth noticing: the real code wraps `validateState(JSON.parse(body))` in its own try/catch to give the specific message "Stored workspace is invalid; original data preserved" (`src/domain/database.ts:61-64`), and it rejects a thenable result (`src/domain/database.ts:66-67`) and a read handler that mutated state (`src/domain/database.ts:76-77`).
</details>

## Drill 3: predict the status code

Assume an authenticated user with the right roles unless stated, on `localhost`.

1. `POST /buying/receipts/{id}/submit` for a receipt whose second line has no `warehouseId`.
2. The same request repeated on a receipt already in status `submitted`.
3. `PUT /customers/{id}` with body `{ "version": 3, "data": {...}, "note": "hi" }` where the record is at version 3.
4. `PUT /customers/{id}` with `{ "version": 2, "data": {...} }` where the record is at version 3.
5. `DELETE /customers/{id}` at the current version, where the customer has one comment.
6. `PUT /items/{id}` flipping `isStockItem`, where the item has stock ledger entries.
7. A request with `Host: example.com`.
8. An eleventh login attempt from one IP within a minute.
9. `PUT /unicorns/{id}`.

<details>
<summary>Answers</summary>

1. **400.** `DomainError("Purchase receipt lines require warehouseId")` uses the default status of 400 (`src/domain/errors.ts:4`, `src/domain/erp-service.ts:1026`). Crucially the whole transaction rolls back, which `tests/integrity.test.ts:161` asserts by comparing the entire row.
2. **200**, returning the existing receipt. The status guard at `src/domain/erp-service.ts:991-993` returns before any validation, and since the serialized state is unchanged, `access` does not even write, so `revision` does not advance (`src/domain/database.ts:69-73`).
3. **400.** The envelope is parsed with `.strict()` (`src/domain/erp-service.ts:2158-2164`), so the unknown `note` field is a `ZodError`, which the error handler maps to 400 (`src/app.ts:411-412`). This is the one people get wrong: a strict schema means extra fields are an error, not noise.
4. **409**, "Record changed; reload current data before retrying" (`src/domain/erp-service.ts:2176-2180`).
5. **409**, "Record has discussion history; retain it" (`src/domain/erp-service.ts:2181-2190`). Note the version check ran first and passed; both guards apply to a delete.
6. **409**, "Stock classification cannot change after ledger history" (`src/domain/erp-service.ts:2194-2202`).
7. **403**, "Forbidden host", from the `onRequest` hook before any route matches (`src/app.ts:29-31`).
8. **429**, "Too many login attempts, please retry in a minute" (`src/app.ts:73-78`).
9. **404**, but from Fastify's router, not from the service. The eight CRUD routes are registered from a fixed list at `src/app.ts:151-178`, so `/unicorns/:id` matches nothing. The service's own "Unknown CRUD collection" 404 (`src/domain/erp-service.ts:2154-2155`) is therefore unreachable over HTTP, and it is worth saying so: it is defence for a direct service caller, and a candidate who notices that a guard cannot be triggered through the API is reading the wiring rather than the function.

The pattern worth naming: 400 is a malformed request, 409 is a request that is well formed and conflicts with current state, 403 is the boundary, and the default `statusCode` on `DomainError` is 400 so anything else is deliberate.
</details>

## Drill 4: explain this test

`tests/integrity.test.ts:161-174`

```ts
  it("rolls back an entire receipt when a later line lacks a warehouse", async () => {
    const r = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      items: [
        { itemId: item.id, quantity: 2, warehouseId: warehouse.id },
        { itemId: item.id, quantity: 1 },
      ],
    });
    const before = snapshot();
    expect(
      (await request("POST", `/buying/receipts/${r.id}/submit`)).statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
  });
```

Why is the second line's line order load-bearing, and what exactly does the last assertion prove that the middle one does not?

<details>
<summary>Answer</summary>

**Why the order of lines matters.** The good line comes first. If the line without a `warehouseId` were first, the loop at `src/domain/erp-service.ts:1022-1037` would throw on its first iteration and no stock would have been posted anyway, so the test would pass even against the buggy code. Putting the valid line first guarantees that `postStock` has already pushed a ledger entry before the throw. The fixture is constructed so that the old implementation would fail it, which is what makes this a regression test rather than a restatement of the behaviour.

**What the last assertion adds.** `expect(...statusCode).toBe(400)` proves an error was returned. The old code also returned 400. `expect(snapshot()).toEqual(before)` proves the persisted row is unchanged, which covers four separate things at once: the document's `status` did not become `submitted`, its `version` was not incremented, the `stockLedgerEntries` array gained no row, and the audit log gained no entry. Those are four mutations in `submitPurchaseReceipt` between lines 1017 and 1054, and a single deep-equality assertion on the whole aggregate catches all of them plus any future one.

**The general lesson.** For a command that mutates, the useful assertion on the rejection path is about the absence of side effects, not about the error. This is cheap here because the entire state is one serializable value; in a normalized schema the equivalent is a snapshot of the tables the command touches, which is more work and the same idea.
</details>

## Drill 5: review this diff

A colleague wants to make the API feel faster. Find the defects.

```diff
--- a/src/app.ts
+++ b/src/app.ts
@@
   app.addHook("onRoute", (route) => {
     const handler = route.handler;
     const method = Array.isArray(route.method) ? route.method[0] : route.method;
     route.handler = async function (request, reply) {
-      return store.access(!["GET", "HEAD"].includes(method), () =>
-        handler.call(this, request, reply),
-      );
+      if (["GET", "HEAD"].includes(method)) {
+        return handler.call(this, request, reply);
+      }
+      return store.access(true, async () => {
+        const result = await handler.call(this, request, reply);
+        return result;
+      });
     };
   });
```

<details>
<summary>Answer: three defects</summary>

**1. Read requests now run with no transaction at all.** They used to run inside a plain `BEGIN`, which gives a consistent snapshot across the whole aggregate. Under the diff, a report handler that reads several collections can observe a state mid-write. Worse, `ERPStore.access` is what sets `this.working` (`src/domain/store.ts:96-97`), and `store.state` throws "State access requires a transaction" when `working` is undefined (`src/domain/store.ts:34-36`). So this does not degrade quietly; every `GET` handler now throws. The diff is not subtly wrong, it is completely broken, and the fact that it looks plausible is the point of the drill.

**2. The write path became async, which the design explicitly refuses.** `store.access` checks whether the operation returned a thenable and throws "Transactions require synchronous operations" (`src/domain/store.ts:100-105`), and `SnapshotDatabase.access` does the same with its own message (`src/domain/database.ts:66-67`). The `async` arrow here returns a promise unconditionally, so every write request now fails. And the reason the check exists is exactly this mistake: `DatabaseSync` drives the transaction with synchronous `BEGIN` and `COMMIT`, so an awaited handler would commit before its work ran. `refuses asynchronous transaction callbacks and rolls back` (`tests/integrity.test.ts:498`) is the test.

**3. It is not a performance change.** Nothing expensive was removed. Under the old code a `GET` costs one `BEGIN`, one read and one `COMMIT`, plus the parse and validate of the body, and the parse is the expensive part and is still there. If reads genuinely needed to be faster, the target is the serialize-compare and re-validate work in `access`, or caching the parsed aggregate between requests with an invalidation keyed on `revision`, which is a real design with real risks rather than a hook edit.

Verdict: reject. Ask for a benchmark before any change to this file, because it is the file that makes the atomicity claim true.
</details>

## Drill 6: predict the behaviour

`editMaster` at `src/domain/erp-service.ts:2098`. A customer record currently has `{ id, companyId, code: "C-1", name: "Acme", email: "a@example.invalid", status: "active", version: 3, createdAt, updatedAt, createdBy }`.

1. `PUT` with `{ version: 3, data: { code: "C-1", name: "Acme Ltd", status: "active" } }` and no `email`. What does the stored record look like afterwards?
2. `PUT` with `{ version: 3, data: { name: "Acme", status: "active" } }`, no `code`.
3. What is the record's `version` after a successful edit, and what does the audit entry record?

<details>
<summary>Answers</summary>

1. **`email` is gone.** This is full-replacement semantics, and it is implemented deliberately at `src/domain/erp-service.ts:2203-2214`: every key on the record except `id`, `companyId`, `createdAt`, `updatedAt`, `createdBy` and `version` is deleted before `Object.assign(record, payload, ...)`. So an omitted optional field is removed rather than retained. If the code only assigned, a client sending a partial object would get merge semantics and a client sending a full object would get replacement, and the API's behaviour would depend on what the client happened to include. Picking one and enforcing it is the point; picking replacement is what makes the version envelope meaningful, because the client is asserting it has the whole record.
2. **400**, "Existing party code is required" (`src/domain/erp-service.ts:2219-2223`). The check runs *after* the assignment, looking at `record.code`, which the delete loop has just removed. That ordering is easy to misread: the guard is not validating the payload, it is validating the resulting record, which is why it catches the omission.
3. **Version 4**, `updatedAt` refreshed (`src/domain/erp-service.ts:2215-2218`), and the audit entry records `previousVersion: 3` (`src/domain/erp-service.ts:2225-2227`). Recording the previous version rather than the new one is the right choice for reconstructing a history: you can chain entries by matching each one's `previousVersion` to the prior state, and the new version is already implied.
</details>
