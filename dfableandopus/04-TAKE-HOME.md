# Take-home: credit notes against a posted sales invoice

Budget: 3 to 4 hours, in this repository.

## Context you are given

Every route handler runs inside one database transaction, installed by the `onRoute` hook at `src/app.ts:39-47`; writes use `BEGIN IMMEDIATE` (`src/domain/database.ts:45`). The entire workspace is one validated JSON aggregate, so mutations happen against an in-memory object graph that is serialized and written only at the end of `access`, and only if it actually changed (`src/domain/database.ts:68-73`). That is why a throw anywhere in a handler leaves no trace.

Money is handled through a `cents()` helper before comparison and multiplication, for example at `src/domain/erp-service.ts:1030` and `:2066-2067`. Stock movements are appended by `postStock` (`src/domain/erp-service.ts:2446`), ledger lines by `postGL` (`src/domain/erp-service.ts:2471`). Documents guard replay with their own `status` (`src/domain/erp-service.ts:991-993`).

## The assignment

Add a **credit note**: a document that reverses an already-posted sales invoice, in full only.

Today a posted sales invoice cannot be corrected. `astraupskill/VERIFICATION.md` lists reversals among the things this starter does not implement, so you are closing a stated gap rather than inventing a feature.

### Acceptance criteria

1. **Model.** Add `creditNotes` to the state schema in `src/domain/state-schema.ts`, following the existing document shape and the per-collection cap that every other collection has (`src/domain/state-schema.ts:341`). A credit note references exactly one `salesInvoiceId` and carries the same company scoping as every other document.
2. **Create.** `POST /sales/credit-notes` creates a draft. It must reject: an invoice in the wrong company, an invoice that is not `submitted` or `partially_paid`, an invoice that already has a non-draft credit note, and an invoice with any payment applied. Decide the status code for each and follow the codebase's own convention, which is 400 for a malformed request and 409 for a conflict with current state.
3. **Submit.** `POST /sales/credit-notes/{id}/submit` must, in one transaction: set the note to `submitted`, reverse the invoice's stock movements by posting opposite `quantityChange` and `valueChange` entries through `postStock`, post balanced reversing lines through `postGL`, set the invoice's status to a cancelled or credited state of your choosing, and write an audit entry through `log`. Balanced means the debits and credits you post must sum equal; assert it in a test.
4. **Replay.** A repeated submit on an already-submitted note returns the existing note and writes nothing, so the persisted `revision` does not advance. Follow the guard at `src/domain/erp-service.ts:991-993`.
5. **Atomicity, proven.** Construct at least one failure that happens *after* the first `postStock` call and prove the whole thing rolls back. This is the heart of the exercise.
6. **Authorization.** Use `requireRoles` for the operation and add `credit_note` to the entity-read policy map at `src/domain/erp-service.ts:2071-2083` so comments, search and the export honour it. Decide which roles, and say why in your notes.
7. **Money.** Use `cents()` for every comparison and multiplication. Do not compare floating-point currency values directly.
8. **Refuse partials.** A partial credit note is out of scope and must be rejected explicitly, in the same spirit as the existing complete-match rule on linked documents. Do not silently accept a subset.

### Tests you must write

Add them to `tests/integrity.test.ts`, using the existing `ok`, `request` and `snapshot` helpers.

At minimum:

- **The rollback test.** Model it on `tests/integrity.test.ts:161-174`: capture `snapshot()`, attempt the failing submit, assert the status code, then assert `snapshot()` deeply equals the captured value. Make sure your fixture would fail against a non-transactional implementation, which means the failure must occur after at least one successful `postStock`. In the reference test the good receipt line is deliberately first for exactly this reason.
- **The replay test.** Submit twice, assert the snapshot is unchanged by the second call, in the style of `tests/integrity.test.ts:175-185`.
- **The balance test.** Assert the trial balance returns to its pre-invoice state after the credit note posts. `tests/integrity.test.ts:186-197` shows how the trial balance is read and asserted.
- **The stock test.** Assert the stock balance returns to its pre-invoice quantity, and that the ledger has both the original and the reversing entries rather than the original being deleted. An append-only ledger is the invariant.
- **The guards.** One test per rejection in criterion 2, each asserting the snapshot is unchanged.
- **Cross-company.** A user who belongs to both companies cannot credit an invoice from the other one. `tests/concurrency.test.ts:169` is the precedent.

### Commands

```powershell
npx vitest run tests/integrity.test.ts -t "credit note"
npx vitest run tests/integrity.test.ts
npm test
npm run build
```

Use the first form while you work; the full `npm test` runs with `--maxWorkers=1 --no-file-parallelism` (`package.json:10`) because two scenarios spawn real server processes against one database file, and it is slow. Run `npm run build` before submitting: a TypeScript production build is part of the project's own verification and a type error is not a warning here.

## What to submit

- A branch with your commits.
- `NOTES.md`: the status code you chose for each rejection and the convention you followed; the roles you granted and why; the invoice status you chose after crediting and what it means for reports; and what you did not do.
- The output of the four commands, including the new test count.

## Grading rubric

| Criterion | Strong | Weak |
|---|---|---|
| Atomicity proof | A failure injected after the first `postStock`, with a whole-aggregate snapshot assertion before and after | Only a status-code assertion, which would pass against a non-transactional implementation |
| Ledger discipline | Reversing entries appended; the original ledger rows untouched | Original stock or GL rows mutated or deleted, destroying history |
| Replay | Status guard placed before any validation; second submit writes nothing and does not advance `revision` | Replay produces a second set of reversing entries, or returns 409 instead of the existing document |
| Error contract | 400 for malformed, 409 for a state conflict, consistent with `src/domain/erp-service.ts`; `DomainError` reused | New error shapes, or 400 used for conflicts because it is the `DomainError` default |
| Money | `cents()` on every comparison and multiplication | Direct float comparison, or rounding introduced at a new place |
| Schema | `creditNotes` added with a cap matching the other collections; `validateState` still passes on both read and write | Collection added with no bound, or a shape that fails re-validation on write |
| Scope honesty | Partial credits rejected explicitly, with the reason in `NOTES.md` | Partial credits silently accepted by summing whatever arrives |

## Reviewer's notes

Opened first, in this order:

1. **The rollback test's fixture.** Not the assertion, the setup. If the injected failure happens before the first `postStock`, the test passes trivially and proves nothing, because the old non-transactional code would have passed it too. The reference test puts its valid line first on purpose, and whether the candidate noticed that is the single most informative thing in the submission.
2. **Whether the ledger is append-only.** A reversal that deletes or edits the original rows is the classic wrong answer. Accounting ledgers are append-only, and a credit note is a new document, not an undo.
3. **Where the replay guard sits.** Before validation, like every other document in this codebase, or bolted on after. The second version returns a different status code on replay and will surprise a retrying client.
4. **Whether `validateState` still passes on the write path.** A new collection that parses on read but fails on re-serialization would make every subsequent write throw. Running `npm test` catches it, so this is really a check on whether the candidate ran the full suite.
5. **`NOTES.md` on the invoice's post-credit status.** There are several defensible answers and each has a reporting consequence, since `does not count draft invoices as aging or outstanding` (`tests/integrity.test.ts:399`) shows the reports already care about document status. A candidate who traced that consequence is thinking about the system rather than the endpoint.
6. **`npm run build` output.** Last, and non-negotiable.
