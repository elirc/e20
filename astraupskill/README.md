# ERP workshop: junior to mid-level CRUD engineering

This course uses the ERP that is already in this folder. You will maintain customers, suppliers, items, warehouses, leads, projects, tasks, and timesheets, then follow their effects through sales, purchasing, stock, and accounting. The goal is to explain a change across the entire request path and prove that an unsuccessful request did not leave half a business operation behind.

Start with a disposable local database. This application contains fictional accounts and an illustrative accounting model; it is not a production ERP or a financial reporting system. Do not substitute real payroll, supplier banking details, or customer information for the fixtures while learning.

## Prerequisites and glossary

**Prerequisites:** TypeScript with `async`/`await`, enough SQL to read an `UPDATE` and say what a transaction is, and comfort reading a request in browser developer tools. The feature-flag workshop in `05 Numbered Experiments/e12` is a lighter predecessor if this is your first course with server-side versions and roles.

| Term | Meaning here | Where in this project |
|---|---|---|
| draft vs submitted | A document is editable while its `status` is draft; submitting freezes it and posts its effects. | `ensureDraftLike` and the `status` transitions in `src/domain/erp-service.ts` |
| record version | A counter on every business record; an edit must send the version it read. | the `record.version !== envelope.version` check in `editMaster`, `src/domain/erp-service.ts` |
| conflict (409) | The refusal a stale edit receives, so the other writer is not silently overwritten. | `DomainError("Record changed; reload current data before retrying", 409)` in `editMaster` |
| DomainError | Domain error carrying its own HTTP status, so the rule and not the transport chooses the code. | `src/domain/errors.ts` |
| write transaction | One `BEGIN IMMEDIATE` around a whole operation, so a later failure removes every earlier effect. | `access()` in `src/domain/database.ts`, entered through `store.access` in `src/domain/store.ts` |
| stock ledger entry | The row recording one quantity movement; on-hand quantity is derived from these rows. | `stockLedgerEntries` in `src/domain/state-schema.ts`, written by `postStock` |
| GL entry | The accounting line posted by the same operation that moved stock or money. | `glEntries` in `src/domain/state-schema.ts` |
| audit log | Append-only record of who changed which entity, written inside the same transaction. | `log()` in `src/domain/erp-service.ts`, read by `auditLogs` |
| entity role scope | Permission to touch one document family, such as `sales_user` or `project_user`. | `canReadEntity` and `requireRoles` in `src/domain/erp-service.ts` |
| stock item / standard cost | Whether an item is tracked in stock, and the cost used when it moves. | `isStockItem` and `standardCost` in `src/domain/state-schema.ts` |

## Start the application

Use Node 22.16 or a later Node 22 release. The committed lockfile records the tested dependency graph. In this project directory:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:5182`. Read `data/local-credentials.json` locally and use the password for `admin@acme.local`. Setup generates independent random passwords. It refuses existing database and credential paths. Keep the credential file private; it is ignored by Git. **Clean up when you are done:** delete `data/local-credentials.json` and `data/erp.sqlite` (or the paths you set in `ERP_CREDENTIALS`/`ERP_DATABASE`); the passwords are random but the file is still a plaintext credential on disk. The browser keeps the bearer token in memory, so reloading requires signing in again. Saved business records remain in SQLite.

For a second practice workspace, set both paths before setup and keep `ERP_DATABASE` set when starting the server:

```powershell
$env:ERP_DATABASE = "$PWD/data/practice-two.sqlite"
$env:ERP_CREDENTIALS = "$PWD/data/practice-two-credentials.json"
npm.cmd run setup
npm.cmd start
```

The normal port is 5182. An occupied port is an error; do not stop another application just to run this exercise. Stop this server with Ctrl+C before restarting or copying its database as a simple offline backup.

## Learning sequence

1. Read the [codebase map](01-CODEBASE-MAP.md), then create and edit a customer in the browser.
2. Work through [the core concepts](02-CONCEPTS.md) with a debugger open. Explain each boundary in your own words.
3. Reproduce [the worked stock change](03-WORKED-CHANGE.md). Predict both the successful and rejected outcomes.
4. Run [the testing and debugging exercises](04-TESTING-AND-DEBUGGING.md), including stale edits and transaction rollback.
5. Complete [the practice assignments](05-PRACTICE.md) before reading [the review guide](06-SOLUTIONS-AND-REVIEW.md).
6. Perform [the trace lab](07-TRACE-LAB.md) and compare your evidence with [verification and limits](VERIFICATION.md).

Allow several focused sessions. A useful session ends with a small change, one convincing regression test, and a short explanation of what remains unsupported. Finishing every screen quickly is less valuable than understanding why the accepted database state is correct.

Your mid-level checkpoint is a five-minute review: demonstrate a stale update being rejected, show that its draft survives, identify the authorization check inside the transaction, and prove that a failed stock operation did not alter status, ledgers, or audit history. If you can only point to a green test count, repeat the trace until you can explain the actual evidence.

## Reviewed workbench screens

These images use fictional records from the disposable browser verification workspace. Follow the linked exercises to reproduce the behavior; the screenshots show presentation, while assertions check saved data, permissions, and conflicts.

- [Item list after saving](images/01-items-desktop.png): the accepted version appears on the record, with literal search and pagination controls.
- [Project editor](images/02-project-editor.png): related records use scoped selectors rather than requiring a learner to copy database identifiers.
- [Conflicting second-tab draft](images/03-conflict-draft.png): rejected stale data stays in the editor. Loading current data and exporting the draft are explicit choices.
- [Auditor view](images/04-auditor-view.png): read-only access does not expose write controls.
- [Retained draft at desktop width](images/05-draft-1440.png), [tablet width](images/05-draft-800.png), and [phone width](images/05-draft-390.png): the form adapts without covering inputs with the status banner.

During review, a sticky status banner overlapped form controls. Moving it into normal page flow corrected the layout. The browser verifier now also checks that a visible banner does not overlap visible controls. This is a useful example of visual inspection finding a defect that CRUD assertions alone did not detect.
