# Codebase Map

## What kind of application this is

This repository is a backend-first ERP starter built with TypeScript and Fastify. It exposes HTTP endpoints for CRM, sales, buying, inventory, accounting, projects, comments, attachments, reporting, and audit logs.

Observed from code:

- There is no frontend in this repo today.
- Persistence is in-memory, not a database.
- Most business behavior is concentrated in one domain service class.

Inference / likely intent:

- This is meant as an MVP foundation or learning scaffold, not a production-finished ERP.
- The code is organized to keep the HTTP layer thin and put business rules in one place.

## Major architectural layers

### 1. Process entry

- `src/server.ts` starts the Fastify server.
- It is intentionally tiny. That is a good sign: bootstrapping is separated from business logic.

### 2. HTTP and API composition

- `src/app.ts` builds the Fastify app, creates the store and service, registers routes, extracts auth context, and maps errors to HTTP responses.
- This is the main runtime boundary between outside callers and the domain code.

### 3. Domain and application logic

- `src/domain/erp-service.ts` holds the bulk of the rules:
  - validation
  - role checks
  - document state transitions
  - stock posting
  - GL posting
  - report derivation
  - comments, attachments, search, exports
- If you want to understand behavior, this is the center of gravity.

### 4. Domain model and contracts

- `src/domain/models.ts` defines the shared types for roles, documents, ledgers, projects, comments, and the overall `ERPState`.
- It shows what the system considers a “thing” and which invariants are supposed to exist.

### 5. Persistence and bootstrapping

- `src/domain/store.ts` is an in-memory store with helper methods for IDs, timestamps, numbering, company scoping, and demo seed data.
- In a larger system this layer would usually become a database adapter or repository layer.

### 6. Behavioral specification

- `tests/erp.test.ts` is not production code, but it is important for onboarding.
- It demonstrates the flows the codebase currently treats as critical:
  - quote to cash
  - stock ledger posting
  - GL correctness
  - approvals
  - idempotent submit behavior

## Major runtime boundaries

In this repo, the important boundaries are simpler than in a typical larger application:

- Client or test caller -> HTTP API
- HTTP API -> domain service
- Domain service -> in-memory store
- Domain service -> derived reports and ledger views

Observed from code:

- There is no database boundary yet.
- There are no background jobs, queues, websockets, caches, or external integrations yet.

Inference / likely intent:

- The code is organized so those boundaries could be added later without rewriting every route.
- The service class is acting as an application-service layer that would likely remain even if persistence changes.

## Most important directories

### `src/`

Top-level production code.

### `src/domain/`

The core of the system. This directory owns:

- types and contracts
- persistence state shape
- business workflows
- invariants around stock, GL, approvals, and document status

### `tests/`

High-value integration-style tests that exercise major flows through the Fastify app.

### `docs/onboarding/`

The onboarding docs you are reading now. These are meant to explain how to think about the code, not just where files are.

## How data flows through the app

The common flow is:

1. A request enters through a Fastify route in `src/app.ts`.
2. `getContext` extracts the bearer token and optional `x-company-id`.
3. `ERPService.authenticate` turns that into a `RequestContext`.
4. The route calls a service method like `createSalesInvoice` or `submitPurchaseReceipt`.
5. The service:
   - validates input with `zod`
   - checks roles
   - looks up related entities
   - mutates the in-memory store
   - posts stock and/or GL entries when needed
   - returns a plain object response
6. The route returns the result.
7. If anything throws, `app.ts` maps the error string to an HTTP status.

Example: purchase receipt submit

1. `POST /buying/receipts/:id/submit` hits `src/app.ts`.
2. `ERPService.submitPurchaseReceipt` loads the receipt from store state.
3. It changes status to `submitted`.
4. It posts stock ledger entries for each line.
5. It posts GL entries to `Inventory Asset` and `Goods Received Not Billed`.
6. Stock balance and trial balance later read from those ledger entries rather than from separate mutable totals.

That last point is one of the most important design ideas in the repo.

## Key concepts and invariants

### Company scoping matters everywhere

- Nearly every entity carries `companyId`.
- Requests are authenticated into a `RequestContext` with a single active company.
- Many queries filter through `byCompany`.

Practical lesson:

- If you add a new entity or endpoint, company scoping is not optional. It is part of correctness, not just access control.

### Business documents have lifecycles

- Documents like quotations, sales orders, invoices, purchase orders, and stock entries have statuses.
- Submit actions usually move a document from `draft` to a later state and trigger side effects.

Practical lesson:

- Status transitions are where hidden bugs appear, because they often trigger ledgers, approvals, or related document updates.

### Stock is derived, not manually maintained

- Stock balance is computed from `stockLedgerEntries`.
- Sales orders also affect “available” quantity through reservation logic.

Practical lesson:

- If you change stock by writing a direct quantity field somewhere, you are probably breaking the system model.

### Accounting is derived from GL entries

- Trial balance, P&L, and balance sheet all read from `glEntries`.
- Invoices and payments post GL entries as side effects of submit actions.

Practical lesson:

- When changing accounting logic, always think in terms of journal effects first and reports second.

### Submit behavior is meant to be idempotent

- `postStock` and `postGL` try to avoid double-posting identical entries.
- Several submit methods return early if a document is already submitted.

Practical lesson:

- Retry safety matters in distributed systems, even in a small MVP.

## Where a junior dev should be careful

- Do not update inventory or balances directly when the code expects them to be derived from ledgers.
- Do not add an endpoint without checking auth, company scoping, and role requirements.
- Do not change a document status without tracing which side effects are supposed to happen with that transition.
- Be careful with “simple” report changes. Many report values are downstream of ledger rules, not local calculations.
- Be cautious around error handling. Right now HTTP status mapping depends on matching text inside thrown error messages.

## Big picture risks and complexity hotspots

### The service class is doing a lot

Observed from code:

- `src/domain/erp-service.ts` owns validation, authorization, orchestration, ledger posting, reports, and some formatting.

Risk:

- This makes the file high leverage but also easy to overgrow into a maintenance bottleneck.

### Persistence and mutation are tightly coupled

Observed from code:

- The store exposes raw arrays, and service methods mutate them directly.

Risk:

- That is fine for an MVP, but it makes transaction boundaries, rollback, and concurrency harder later.

### Some logic is heuristic rather than strongly modeled

Observed from code:

- Account categories are inferred from account-name strings in `accountCategory`.
- Error handling in `app.ts` infers HTTP status from message text.

Risk:

- Small renames can accidentally change accounting classification or HTTP behavior.

### Cross-module flows are where most bugs will hide

Examples in this repo:

- quotation -> sales order -> sales invoice -> payment
- purchase receipt -> inventory + GRNI
- sales invoice -> receivable + revenue + COGS + inventory reduction

If you want to build programming judgment here, trace those flows end to end instead of studying one method in isolation.
