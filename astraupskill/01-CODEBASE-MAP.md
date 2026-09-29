# 1. Read the code as a request journey

Begin at [the server entry point](../src/server.ts). It resolves the database path and binds to the loopback address. [Application setup](../src/app.ts) builds Fastify, reads the three browser assets, registers request guards, and connects routes to the ERP service. The build emits `dist/src/server.js`; the start script now points to that actual output.

The workbench in [public/workbench.js](../public/workbench.js) owns the selected module, company, current list, page, session, and open editor. A module definition specifies labels and input types. For example, the customer editor submits a name, code, optional contact information, and an edit-only status. It does not submit the record's company or creation metadata as editable fields.

```text
Browser editor and expected record version
  -> PUT /customers/:id with bearer and x-company-id
  -> Host and Origin checks
  -> synchronous store.access(true, operation)
  -> authenticate current session, user, and company membership
  -> editMaster role check and request parsing
  -> compare stored version with the submitted version
  -> mutate candidate record and append audit entry
  -> validate complete candidate state
  -> SQLite COMMIT
  -> response and browser refresh
```

The asynchronous Fastify wrapper returns a response after the synchronous transaction callback finishes. Do not put an awaited network request inside `store.access`. [The store](../src/domain/store.ts) deliberately rejects nested access and promise-returning operations. Access to its mutable state is available only during the transaction callback or explicit bootstrap.

[The database adapter](../src/domain/database.ts) stores one bounded JSON aggregate in a SQLite row. A write starts with `BEGIN IMMEDIATE`, reloads current state, executes the operation, validates the candidate, writes it, and commits. A read uses a read transaction and rejects accidental mutation. This is a teaching architecture that makes the full business boundary visible. It is not a normalized relational schema and should not be described as a high-volume ERP database design.

[Domain models](../src/domain/models.ts) describe the TypeScript shapes. [Runtime schemas](../src/domain/state-schema.ts) validate actual values. TypeScript disappears at runtime; an HTTP client or damaged database does not become trustworthy because an interface exists. State validation checks collection bounds, exact shapes, company references, identities, unique codes, document totals, invoice balances, stock availability, and balanced ledger vouchers.

[The service](../src/domain/erp-service.ts) contains the business operations. Read a create method beside its submit method. Creating an invoice records a draft and accepted line facts. Submitting it posts its accounting entries and stock movements. The distinction explains why a draft can exist while a later submission is rejected for insufficient stock.

[Security helpers](../src/domain/security.ts) hash passwords with scrypt, compare derived keys, generate random session tokens, and hash tokens before storage. [Explicit setup](../src/setup.ts) creates the fictional accounts and reserves new output paths. The API never returns stored password hashes in a user response.

The original six workflow tests remain in [erp.test.ts](../tests/erp.test.ts). [Integrity tests](../tests/integrity.test.ts) cover rollback, replay, references, permissions, persistence, and invalid input. [Concurrency tests](../tests/concurrency.test.ts) launch [independent workers](../tests/request-worker.ts), making the process boundary real. [Browser verification](../scripts/verify_browser.py) exercises the delivered forms against a disposable database.

Before editing anything, answer: which method owns the rule, which layer commits it, and which test would fail if the rule disappeared? Keep those three answers in your change notes. They make a useful review description because they connect implementation to observable behavior.

For the underlying API contract, consult the [Node 22 SQLite documentation](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html): `DatabaseSync` operations are synchronous. The application deliberately keeps asynchronous HTTP response handling outside the database callback.

## Function index for `src/domain/erp-service.ts`

The service is 2607 lines in one class. Section banners (`// ===== Sales ...`, `Purchasing`, `Accounting`, `Stock`) were added in the fix pass so an editor's outline shows the areas. Entry points and the authorization check, with line numbers as of this pass (re-generate with `grep -n "^  [a-zA-Z]*(" src/domain/erp-service.ts`):

| method | line |
|---|---|
| `createCompany` | 331 |
| `createCustomer` | 370 |
| `createSupplier` | 399 |
| `createItem` | 429 |
| `createWarehouse` | 457 |
| `createLead` | 477 |
| `createQuotation` | 497 |
| `submitQuotation` | 522 |
| `createSalesOrder` | 596 |
| `submitSalesOrder` | 634 |
| `createSalesInvoice` | 679 |
| `submitSalesInvoice` | 723 |
| `createPurchaseOrder` | 829 |
| `submitPurchaseOrder` | 865 |
| `createPurchaseReceipt` | 939 |
| `submitPurchaseReceipt` | 980 |
| `createPurchaseInvoice` | 1070 |
| `submitPurchaseInvoice` | 1114 |
| `createPayment` | 1195 |
| `submitPayment` | 1221 |
| `createJournalEntry` | 1257 |
| `submitJournalEntry` | 1296 |
| `createStockEntry` | 1334 |
| `submitStockEntry` | 1381 |
| `createProject` | 1465 |
| `createTask` | 1486 |
| `createTimesheet` | 1510 |

The authorization decision lives in `src/domain/security.ts` (permission lookup) and surfaces in the service as the `DomainError("Forbidden entity access", 403)` thrown at line 2095: every submit/post entry resolves the caller's permission before reading the aggregate, which is the answer to this course's checkpoint question.

