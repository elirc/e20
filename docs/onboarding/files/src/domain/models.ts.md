# `src/domain/models.ts`

## What This File Is For

This file defines the shared domain types for the ERP system.

It is primarily a contracts file and domain vocabulary file. It does not execute business rules. Instead, it describes:

- which entities exist
- how document types differ
- which statuses are legal
- what the overall in-memory state contains

## Why This File Matters

This file is one of the best places for a junior developer to start because it shows the system’s mental model without the noise of control flow.

Broader concepts it teaches:

- how to model a business domain with TypeScript
- the difference between master data, transaction documents, and derived ledger records
- how shared types shape the rest of the architecture

## Key Exports / Main Units

- `Role`
  - String union of application roles such as `sales_user`, `inventory_user`, and `auditor`.
- `DocumentStatus`
  - Shared lifecycle states used across multiple business documents.
- `DocumentType`
  - Supported transactional document categories.
- `AuditFields`
  - Common metadata embedded in many entities.
- `Company`
  - Company-level configuration, including document numbering and default accounts.
- `User`, `Session`
  - Auth-related identity and session types.
- `Customer`, `Supplier`, `Item`, `Warehouse`, `Lead`
  - Core master and CRM records.
- `DocumentLine`
  - Reusable line item shape for several commercial documents.
- `Quotation`, `SalesOrder`, `SalesInvoice`, `PurchaseOrder`, `PurchaseReceipt`, `PurchaseInvoice`
  - Main commercial document types.
- `PaymentEntry`, `JournalEntry`, `StockEntry`
  - Accounting and inventory transaction documents.
- `StockLedgerEntry`, `GLEntry`
  - Ledger records used as sources of truth for stock and accounting.
- `Project`, `Task`, `Timesheet`
  - Project management records.
- `ApprovalWorkflow`, `Comment`, `Attachment`, `AuditLog`
  - Cross-cutting support records.
- `ERPState`
  - The top-level in-memory store shape.
- `RequestContext`
  - The authenticated runtime identity used by the service layer.

## How It Works

The file uses string unions instead of enums for statuses, document types, and roles. That makes the types lightweight and easy to compare in runtime code.

One useful pattern is `AuditFields`, which is embedded into many entities. That tells you the codebase wants most business records to have:

- `id`
- `companyId`
- timestamps
- creator information

Another important pattern is the distinction between:

- business documents
  - like `SalesInvoice` or `PurchaseReceipt`
- ledger records
  - like `GLEntry` or `StockLedgerEntry`

That distinction matters because the code treats ledgers as the source for derived reports and balances.

`ERPState` is especially important. It acts like a map of the whole application’s persistent world:

- master data collections
- document collections
- ledger collections
- collaboration records
- audit log records

If you add a major new concept to the system, this file is one of the first places that should change.

## How It Connects To Other Files

Inbound relationships:

- `src/domain/store.ts` uses these types to shape state and seed records.
- `src/domain/erp-service.ts` uses them for method return values, lookups, and helper logic.

Outbound relationships:

- It has no runtime dependencies on the rest of the domain.

Contracts that matter:

- `ERPService` assumes `DocumentStatus` and `DocumentType` capture the valid states it needs to reason about.
- `ERPStore` assumes `ERPState` includes every collection it initializes.
- Reporting logic assumes `GLEntry` and `StockLedgerEntry` carry enough detail to derive balances later.

## Important Design Choices

- String unions over enums
  - Simpler runtime comparisons and less ceremony.
- Shared `AuditFields`
  - Reduces drift across entity shapes and reinforces auditability as a first-class concern.
- Ledger records modeled separately from documents
  - Encourages “derive from source events” thinking.
- `Company` contains numbering and default account configuration
  - Keeps those rules company-specific instead of globally hard-coded.
- `DocumentLine` reused across multiple document types
  - Simpler than separate line-item interfaces for each document in a small MVP.

Tradeoffs:

- Simplicity is high, but the model is less precise than a larger production schema.
- Some concepts are represented by plain strings where stronger modeling might reduce bugs later.

## Things A Junior Dev Should Notice

- `RequestContext` is intentionally small. That is a clue that auth context is supposed to be simple and explicit.
- `GLEntry.account` is a plain string, not a typed account identifier. That makes reporting logic easier to write quickly but easier to break accidentally.
- Some document types have fields that hint at future growth, like `approvalState` and `reservedQuantities`.
- Several interfaces embed arrays directly, like `items` on invoices and orders. In a database-backed design, these would likely become separate tables.
- The types express intent, but they do not enforce runtime validation by themselves. That happens in `erp-service.ts`.

## Code Review Lens

If this file were in a pull request, a strong reviewer should focus on:

- whether new fields belong on the right entity
- whether optional vs required fields match real workflow needs
- whether a new document type has been propagated consistently
- whether the type model preserves the existing invariants around ledgers and company scoping

Correctness risks:

- missing updates to `ERPState`
- adding a new status without updating transition logic
- broadening a type in a way that silently weakens invariants

Maintainability concerns:

- too many optional fields on one type
- inconsistent naming across similar document shapes
- using raw strings where a narrower union or dedicated type would be safer

## Common Change Scenarios

### 1. Add a new document type

Before editing:

- inspect `DocumentType`
- inspect `Company.numberingPrefixes` and `numberingCounters`
- inspect `ERPState`
- inspect `ERPService` methods and reports that switch or branch on document types

### 2. Add a new role

Before editing:

- inspect `Role`
- inspect `requireRoles` usage throughout `ERPService`
- inspect seeded users in `ERPStore.bootstrap`

### 3. Add fields to invoices or line items

Before editing:

- inspect the matching `zod` schemas in `ERPService`
- inspect helper methods like `buildDocumentLines`
- inspect tests that assert totals, outstanding amounts, or ledger posting

### 4. Improve accounting modeling

Before editing:

- inspect `GLEntry`
- inspect reporting helpers like `accountCategory`
- inspect company default accounts in `Company`

## Suggested Exercises

- List which interfaces represent source business events and which represent derived ledger records.
- Identify three places where adding a new `DocumentType` would require follow-up code changes outside this file.
- Propose one stronger type that could replace a plain string and reduce bugs.
- Write a test idea for a bug caused by a mismatch between a TypeScript interface and runtime validation.

## Observed Facts vs Inference

Observed from code:

- Roles, statuses, document types, and state shape are modeled with TypeScript types and interfaces.
- Stock and accounting concepts are represented separately through ledger entry interfaces.
- Most business records include audit fields and company scoping.

Inference / likely intent:

- The model is optimized for readability and iteration speed over database-grade precision.
- The author wants ledgers to act as durable sources of truth even in an MVP architecture.
- The current shape is intended to expand into more modules over time.
