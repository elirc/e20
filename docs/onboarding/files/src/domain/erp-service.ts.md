# `src/domain/erp-service.ts`

## What This File Is For

This file is the main business engine of the application.

It is a domain service / application service file. It owns:

- runtime validation
- authentication and authorization checks
- master-data CRUD behavior
- document creation and submission flows
- stock and GL posting
- reporting
- comments, attachments, search, and exports

## Why This File Matters

This is the single most important file to study if you want to understand how the system behaves.

Broader concepts it teaches:

- how business workflows get encoded in service methods
- how to keep HTTP handlers thin
- how derived ledgers can be used as the source of truth
- how cross-module side effects create real complexity

If you want to improve programming judgment, this file is where you practice asking:

- What is the source of truth?
- What should happen on create versus submit?
- What side effects belong to this transition?
- What must stay idempotent under retries?

## Key Exports / Main Units

- `ERPService`
  - The main service class used by `app.ts`.

Major groups inside the class:

- auth methods
  - `login`, `authenticate`, `listMe`
- company and master-data methods
  - `listCompanies`, `createCompany`, `listCustomers`, `createCustomer`, and similar methods for suppliers, items, warehouses
- CRM and sales methods
  - `createLead`, `createQuotation`, `submitQuotation`, `convertQuotationToSalesOrder`, `createSalesOrder`, `submitSalesOrder`, `createSalesInvoice`, `submitSalesInvoice`
- buying and approvals methods
  - `createPurchaseOrder`, `submitPurchaseOrder`, `approvePurchaseOrder`, `createPurchaseReceipt`, `submitPurchaseReceipt`, `createPurchaseInvoice`, `submitPurchaseInvoice`
- accounting methods
  - `createPayment`, `submitPayment`, `createJournalEntry`, `submitJournalEntry`
- inventory methods
  - `createStockEntry`, `submitStockEntry`, `stockBalance`, `stockLedger`
- project and collaboration methods
  - `createProject`, `createTask`, `createTimesheet`, `addComment`, `addAttachment`
- reporting and utility methods
  - `dashboard`, `search`, `trialBalance`, `profitAndLoss`, `balanceSheet`, `aging`, `exportCollection`
- internal helpers
  - `postGL`, `postStock`, `buildDocumentLines`, `requireRoles`, `findRecord`, `findApprovalWorkflow`, and others

## How It Works

The file begins with `zod` schemas. That is important because runtime validation lives here, not in the route layer.

Then the `ERPService` class uses a consistent pattern:

1. Validate input.
2. Check roles.
3. Load related records.
4. Create or mutate domain records.
5. Apply cross-module side effects.
6. Write audit logs when appropriate.
7. Return plain objects.

### A useful mental split: create methods vs submit methods

In this codebase:

- `create*` methods usually create draft records.
- `submit*` methods usually perform the important transition and side effects.

That is a common pattern in business systems because draft creation should be cheap and reversible, while submit should represent commitment.

### Example: sales invoice submit

`submitSalesInvoice` is a good file-reading exercise because it touches multiple domains:

- validates the invoice is in a submit-eligible state
- changes status to `submitted`
- posts receivable and revenue GL entries
- posts COGS and inventory GL entries
- posts stock ledger reductions for each warehouse line
- marks the related sales order completed when present

This is where ERP-style complexity shows up: one user action updates commercial status, inventory, and accounting at once.

### Example: purchase receipt submit

`submitPurchaseReceipt`:

- changes status
- posts positive stock ledger entries
- posts debit to inventory and credit to GRNI

That means inventory and accounting stay linked by the same submission event.

### Example: payment submit

`submitPayment`:

- posts cash and AR/AP GL entries
- applies the payment to the referenced invoice
- updates `paidAmount`, `outstandingAmount`, and invoice status

This is a good example of why business logic belongs in one place rather than split across routes.

### Reports are derived, not independently stored

`stockBalance`, `trialBalance`, `profitAndLoss`, `balanceSheet`, and `aging` are mostly computations over collections like:

- `stockLedgerEntries`
- `glEntries`
- invoices with outstanding balances

This is one of the strongest architectural ideas in the repo.

### Helper methods carry hidden invariants

Some of the most important behavior is in helper methods:

- `postStock`
  - avoids duplicate stock postings for identical voucher lines
- `postGL`
  - avoids duplicate GL postings for identical voucher lines
- `buildDocumentLines`
  - ensures item lookups, warehouse checks, default pricing, and amount calculation happen consistently
- `requireRoles`
  - central permission gate
- `findRecord` and `findDocument`
  - enforce lookup by both `id` and `companyId`

These helpers are easy to underestimate. Many correctness guarantees depend on them.

## How It Connects To Other Files

Inbound relationships:

- `src/app.ts` calls these methods from HTTP routes.
- The tests exercise many of these methods indirectly through the app.

Outbound relationships:

- depends on `src/domain/store.ts` for all state reads and writes
- depends on `src/domain/models.ts` for domain types

Contracts that matter:

- route handlers assume service methods enforce permissions and validation
- reports assume ledger posting methods are the only way financial and stock changes are recorded
- store helpers like `nextNumber` and `base` are relied on for consistent record creation

## Important Design Choices

- One central service class
  - Simple to discover and great for small-team iteration, but it can become a monolith.
- `zod` validation in the service layer
  - Keeps runtime rules near business logic instead of scattering them across routes.
- Role checks inside service methods
  - Stronger than trusting route organization alone.
- Derived ledgers for stock and accounting
  - A high-value ERP design choice that improves auditability and report consistency.
- Idempotency checks in posting helpers and submit methods
  - Protects against duplicate submissions and retries.
- Heuristic reporting helpers like `accountCategory`
  - Quick to implement, but more fragile than a stronger account model.

Tradeoffs:

- High clarity of behavior in one place
- High coupling across modules in one file
- Easy to learn initially, harder to evolve safely as the product grows

## Things A Junior Dev Should Notice

- Methods often call other service methods rather than duplicating logic. Example: quotation conversion uses `createSalesOrder`.
- Status transitions are not just UI labels. They are control points that enable side effects.
- Several “list” methods are simple, but the “submit” methods are where most correctness risk lives.
- `findRecord` always includes company scoping. That is a security and correctness pattern worth preserving.
- Reports are only as correct as the posting logic before them.
- `accountCategory` classifies accounts by account-name text. That works, but it is more fragile than it looks.
- There are places where the current model is intentionally simple:
  - no cancellation or reversal flows
  - no persistent transaction boundary
  - no negative-stock prevention logic

## Code Review Lens

If this file were in a pull request, a strong reviewer should focus on:

- whether the change preserves existing invariants around ledgers, status, and company scope
- whether new side effects happen exactly once
- whether role checks are present and in the right place
- whether any helper was bypassed in a way that weakens consistency
- whether new report logic is derived from canonical sources

Correctness risks:

- double-posting stock or GL
- mutating derived values directly
- invalid status transitions
- updating one module’s state but forgetting the related module
- under-validating relationships between records

Edge cases worth checking:

- retrying a submit action
- overpayment or mismatched payment reference
- referencing a warehouse or item from the wrong company
- approving a document that no longer needs approval
- adding a new account name that changes report classification

Maintainability concerns:

- the file is large enough that local fixes can have distant effects
- repeated role lists can drift
- multiple business concerns in one class make safe refactoring harder

Testability concerns:

- methods with side effects should be covered by integration-style tests
- report changes should be tested against source postings, not just snapshots

## Common Change Scenarios

### 1. Add a new business document flow

Before editing:

- inspect `DocumentType` and related interfaces in `models.ts`
- inspect `ERPStore.createCompanyRecord` for numbering setup
- inspect route registration in `app.ts`
- inspect existing create/submit patterns in a similar document flow

### 2. Change accounting rules for an invoice or payment

Before editing:

- inspect the relevant submit method
- inspect `postGL`
- inspect report methods that consume `glEntries`
- inspect tests that assert balances and report totals

### 3. Add validation to an existing operation

Before editing:

- inspect the matching `zod` schema near the top of the file
- inspect all routes that call the method
- inspect tests for current accepted behavior

### 4. Add a new report

Before editing:

- identify the canonical source collection
- check whether the report should derive from documents or from ledgers
- inspect similar methods like `trialBalance` or `aging`

### 5. Refactor the file into smaller services

Before editing:

- first identify stable seams, such as auth, master data, sales, buying, accounting, and projects
- be careful not to split helper methods away from the invariants they enforce

## Suggested Exercises

- Trace `submitSalesInvoice` and list every collection it can affect.
- Identify one invariant protected by `postStock` and one protected by `findRecord`.
- Propose a safer replacement for `accountCategory` that does not depend on name matching.
- Write a test case idea for an edge case not currently covered, such as overpayment or cross-company entity reference.

## Observed Facts vs Inference

Observed from code:

- This file holds validation schemas and almost all business behavior.
- Submit methods often create ledger side effects.
- Role checks are enforced inside the service methods.
- Reports are derived from ledger and document collections rather than precomputed totals.
- Duplicate ledger posting is guarded by helper methods.

Inference / likely intent:

- The author chose centralization to make the core ERP rules easier to find during early development.
- The system is designed around “documents create events, ledgers derive truth.”
- The next natural architectural step would be splitting this file by domain module once the behavior grows further.
