# `src/domain/store.ts`

## What This File Is For

This file owns the in-memory persistence layer and demo bootstrap data.

It is a store and bootstrapping file. Its main responsibilities are:

- hold the full `ERPState`
- create IDs and timestamps
- generate document numbers
- enforce company scoping at the store boundary
- seed the application with an initial company, users, and sample records

## Why This File Matters

This file matters because every service method eventually reads from or writes to the data structures created here.

Broader concepts it teaches:

- how application state is laid out
- how shared metadata is created consistently
- how small systems often start with an in-memory store before moving to a database
- how seed data shapes both demos and tests

## Key Exports / Main Units

- `ERPStore`
  - The main store class holding application state and store helper methods.

Important methods:

- `constructor`
  - Initializes empty collections and seeds demo data through `bootstrap`.
- `now`
  - Returns ISO timestamps.
- `id`
  - Generates UUIDs.
- `base`
  - Creates shared audit fields for a new record.
- `nextNumber`
  - Increments a company-specific document counter and returns the formatted document number.
- `getCompany`
  - Looks up a company by ID.
- `assertContextCompany`
  - Verifies that a user is allowed to operate in the requested company.
- `createCompanyRecord`
  - Creates a new company object with numbering and default accounts initialized.
- `bootstrap`
  - Seeds the application with one company, several users, and sample master data.

## How It Works

The constructor builds an `ERPState` object filled with empty arrays, then immediately calls `bootstrap`.

That means:

- every new `ERPStore` starts from a predictable baseline
- every new `buildApp()` call gets fresh seed data
- tests can use app recreation as isolation

`base` is a helpful method to notice. It centralizes shared record metadata:

- `id`
- `companyId`
- `createdAt`
- `updatedAt`
- `createdBy`

That is a small but good design choice because it reduces copy-paste mistakes.

`nextNumber` mutates the company’s numbering counter in place. That is the store’s numbering mechanism for quotations, orders, invoices, payments, journals, and stock entries.

`assertContextCompany` is another important guardrail. It chooses a company from:

- the requested company header, or
- the user’s first company

Then it checks that the user actually belongs to that company.

`bootstrap` seeds:

- one company
- a system admin
- role-specific demo users
- one customer
- one supplier
- one item
- one warehouse
- one purchase-order approval workflow

This is why the app feels usable immediately without setup.

## How It Connects To Other Files

Inbound relationships:

- `src/app.ts` creates a new `ERPStore`.
- `src/domain/erp-service.ts` reads and mutates `store.state` heavily.

Outbound relationships:

- depends on `src/domain/models.ts` for all entity and state types

Contract relationships that matter:

- `ERPService` assumes `ERPState` collections are present and mutable.
- `ERPService.authenticate` relies on sessions seeded here.
- Company numbering and default account behavior depend on the shapes initialized here.

## Important Design Choices

- In-memory arrays instead of a database
  - Simple for an MVP and excellent for teaching, but not durable.
- Bootstrap on construction
  - Makes local use and testing easy.
- Store helper methods for IDs, timestamps, and numbering
  - Keeps record creation rules consistent.
- Company-scoped numbering
  - Matches real ERP expectations better than one global counter.
- Demo users with predictable tokens and passwords
  - Convenient for local development, not secure for production.

Tradeoffs:

- Very easy to understand and test.
- Very weak on concurrency, durability, and transaction semantics.

## Things A Junior Dev Should Notice

- `state` is public. That means the service mutates arrays directly instead of going through repository methods.
- `bootstrap` is doing real work, not just tests-only seeding. It defines the default runtime experience.
- `createCompanyRecord` centralizes default accounts and numbering counters. If you add a new document type, this file is part of the job.
- Sessions are precomputed from users. There is no token signing or persistence boundary yet.
- `assertContextCompany` is a key security helper, even though it looks small.

## Code Review Lens

If this file were in a pull request, a strong reviewer should focus on:

- whether new collections are added consistently to `ERPState`
- whether new records always receive correct audit and company fields
- whether numbering remains deterministic and company-scoped
- whether bootstrap changes unintentionally alter test or demo assumptions

Correctness risks:

- wrong `companyId`
- duplicate or inconsistent numbering
- seeding invalid roles or permissions
- adding persistence shortcuts that bypass shared helpers

Maintainability concerns:

- direct public mutation of `state`
- bootstrap becoming too large or too environment-specific
- helper logic drifting from domain expectations

## Common Change Scenarios

### 1. Add a new collection to the system

Before editing:

- inspect `ERPState` in `models.ts`
- inspect service methods that should read or write the new collection
- inspect bootstrap if the new concept needs demo data

### 2. Change document numbering

Before editing:

- inspect `Company.numberingPrefixes`
- inspect `nextNumber`
- inspect any tests or reports that assume current number formats

### 3. Move from in-memory state to a database-backed repository

Before editing:

- inspect all direct `store.state` mutations in `ERPService`
- identify where transactions would be needed for multi-step submit flows

### 4. Add another default company or more complex demo users

Before editing:

- inspect `assertContextCompany`
- inspect auth flows and tests that rely on a single seeded company

## Suggested Exercises

- Trace how a fresh `ERPStore` becomes a usable app state without any HTTP requests.
- Identify all the places where adding a new `DocumentType` would require store changes.
- Propose a safe first step toward hiding `state` behind narrower methods.
- Identify one place where moving to a real database would require transaction handling.

## Observed Facts vs Inference

Observed from code:

- The store holds mutable arrays for all state.
- Each new store bootstraps demo company, users, and sample records.
- Numbering and default accounts are company-specific.
- Company access is validated through `assertContextCompany`.

Inference / likely intent:

- The store is intentionally simple so the service logic can be explored without infrastructure complexity.
- This file would likely become a repository or persistence adapter layer in a more mature version of the application.
