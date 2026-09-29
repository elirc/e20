# ERP Suite Starter

Modular ERP MVP foundation for small-to-mid-sized businesses, built as a TypeScript/Fastify API with a shared master-data and document engine.

## Included modules

- Auth and demo users with role-based access control
- Multi-company-aware company, customer, supplier, item, and warehouse master data
- CRM basics: leads and quotations
- Sales flow: quotation -> sales order -> sales invoice -> payment
- Buying flow: purchase order -> approval -> purchase receipt -> purchase invoice
- Inventory ledger, stock balance, and stock entry APIs
- Accounting journal, GL posting, trial balance, P&L, balance sheet, and aging
- Projects, tasks, and timesheets
- Comments, attachments, dashboard summaries, search, CSV exports, and audit logs

## Tech stack

- Node.js 22+
- TypeScript
- Fastify
- Vitest
- In-memory data store for rapid MVP iteration

## Run locally

```bash
npm install
npm run dev
```

The API starts on `http://localhost:3000`.

Production build:

```bash
npm run build
npm start
```

## Demo login accounts

Use `POST /auth/login` with password `password`.

- `admin@acme.local`
- `sales@acme.local`
- `purchase@acme.local`
- `inventory@acme.local`
- `accounts@acme.local`
- `projects@acme.local`
- `audit@acme.local`

After login, send:

- `Authorization: Bearer <token>`
- `x-company-id: <company id from GET /auth/me>`

## Important implementation rules

- Stock is derived from `stock_ledger_entries`, not ad hoc quantity mutation.
- Accounting balances are derived from `gl_entries`.
- Business documents carry status, company scope, creator, and timestamps.
- Purchase approvals are enforced server-side from configurable workflow records.
- Submit actions are idempotent for already-posted ledger flows.

## Key endpoints

- `POST /auth/login`
- `GET /auth/me`
- `GET|POST /customers`
- `GET|POST /suppliers`
- `GET|POST /items`
- `GET|POST /warehouses`
- `GET|POST /crm/leads`
- `GET|POST /sales/quotations`
- `POST /sales/quotations/:id/submit`
- `POST /sales/quotations/:id/convert`
- `GET|POST /sales/orders`
- `POST /sales/orders/:id/submit`
- `GET|POST /sales/invoices`
- `POST /sales/invoices/:id/submit`
- `GET|POST /buying/orders`
- `POST /buying/orders/:id/submit`
- `POST /buying/orders/:id/approve`
- `GET|POST /buying/receipts`
- `POST /buying/receipts/:id/submit`
- `GET|POST /buying/invoices`
- `POST /buying/invoices/:id/submit`
- `GET|POST /accounting/payments`
- `POST /accounting/payments/:id/submit`
- `GET|POST /accounting/journal-entries`
- `POST /accounting/journal-entries/:id/submit`
- `GET|POST /inventory/stock-entries`
- `GET /inventory/stock-balance`
- `GET /inventory/stock-ledger`
- `GET|POST /projects`
- `GET|POST /projects/tasks`
- `GET|POST /projects/timesheets`
- `GET|POST /documents/:entityType/:id/comments`
- `GET|POST /documents/:entityType/:id/attachments`
- `GET /dashboards/summary`
- `GET /search?q=term`
- `GET /reports/trial-balance`
- `GET /reports/profit-and-loss`
- `GET /reports/balance-sheet`
- `GET /reports/aging`
- `GET /reports/export/:collection`
- `GET /audit-logs`

## Tests

```bash
npm test
```

The test suite covers:

- sales lifecycle transitions
- stock ledger correctness
- GL posting correctness
- approval enforcement
- idempotent submit behavior
- projects/search/comments/attachments/export flows

## Current limits

- Persistence is in-memory; restarting the server resets data.
- Manufacturing, assets, batch/serial tracking, and multi-currency are not fully implemented yet.
- Attachments are metadata-only hooks in this starter.
- Background jobs and a frontend UI are planned next layers rather than part of this initial backend foundation.
