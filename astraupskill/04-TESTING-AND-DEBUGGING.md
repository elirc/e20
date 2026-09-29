# 4. Test the failure boundary, then debug the smallest case

Run the tests from the project directory, with the server stopped when you want to use its normal port for browser verification. The API tests use disposable SQLite files or explicit in-memory fixtures. They do not connect to a real business database.

```powershell
npm.cmd test
npm.cmd run build
```

The committed test script uses one worker to keep this collection's resource use predictable. On a heavily loaded machine, you can supply larger hook and test deadlines without weakening assertions:

```powershell
npm.cmd test -- --hookTimeout=60000 --testTimeout=90000
```

A timeout is not a passing result. Read whether the operation failed, the fixture failed to start, or the machine could not schedule a worker promptly. Fix the cause and obtain a completed run before recording verification.

## Fast feedback first

The full suite takes about 453 seconds (`unit-final.log`); nobody runs that per edit. Run one case:

```powershell
npx vitest run tests/integrity.test.ts -t "rolls back an entire receipt"
```

and the full suite only before you write up. The `-t` filter matches the test title in `tests/integrity.test.ts:161`.

## Three levels of evidence

The original API suite proves ordinary sales, purchase, approval, reporting, and project collaboration flows still work. The integrity suite targets specific rejected operations and persistence behavior. The concurrency suite starts two separate Node processes against the same SQLite database. A JavaScript `Promise.all` around two methods on one object would not provide equivalent evidence about process coordination.

Browser tests exercise labels, forms, rendered lists, draft retention, exports, permissions, pagination, and responsive widths. They are defined in [verify_browser.py](../scripts/verify_browser.py), using Python Playwright and a disposable database. Install that optional verification dependency in your preferred Python environment; Chromium must also be available. The ordinary application itself does not require Python.

```powershell
python -m pip install playwright
python -m playwright install chromium
python scripts/verify_browser.py
```

The browser verifier refuses existing output database or credential files and refuses an occupied port. To repeat it while keeping the earlier evidence, choose a new `ERP_CHECK_DIR`. Generated credentials belong only to the disposable test workspace; do not commit them.

## Assert the business invariant

For an overpayment, asserting only 400 or 409 misses the dangerous part. Also verify that the payment remains draft, the invoice balance is unchanged, and no payment ledger or audit event was accepted. The integrity tests compare a complete persisted snapshot where an exact no-change guarantee is appropriate.

For a stale edit, prove that exactly one writer won, the record version increased once, and the losing draft remains visible. For stock competition, prove that one invoice remains draft and the final available quantity is zero rather than negative.

```ts
expect(statuses.sort()).toEqual([200, 409]);
expect(savedCustomer.version).toBe(2);
expect(updateAuditEvents).toHaveLength(1);
```

Do not copy this expected result into a mock implementation. The race tests use the actual HTTP handler, actual authorization, and actual database adapter.

## Debug from the first unexpected observation

Put breakpoints at `getContext`, `editMaster` or the relevant submit method, and the write inside `SnapshotDatabase.access`. Inspect the submitted expected version and the current stored version. Step through validation before stepping into serialization details.

If an API request fails, preserve the response status and request ID. Avoid logging the bearer, passwords, or the entire credentials file. A 401 suggests session validity; 403 suggests host, origin, membership, or role policy; 409 suggests a stale version or an explicit business conflict. A 500 intentionally hides internal details and reports that the operation was not accepted.

When reproducing a UI error, export the draft, refresh the list, and distinguish an explicit rejection from a lost response after the server committed. The latter requires checking current state before deciding whether another create request is appropriate. That habit is essential for reliable CRUD work even in applications with much more elaborate infrastructure.
