# ERP workshop

A local Fastify and TypeScript ERP learning project with persistent SQLite transactions and a browser workbench for customer, supplier, item, warehouse, lead, project, task, and timesheet CRUD.

## Run

Use Node 22.16+ within the Node 22 release line. From this directory:

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:5182`. Setup generates eight fictional accounts and private credentials in `data/local-credentials.json`; use the company administrator account for the complete workbench. Existing database and credential files are never replaced. Set `ERP_DATABASE` and `ERP_CREDENTIALS` to new paths for another practice workspace. The server uses `ERP_DATABASE` and defaults to `data/erp.sqlite`.

Saved records survive restart. Browser sessions and unsaved drafts remain in tab memory. Export a draft before closing its tab. A stale version returns a conflict and preserves the draft. After an uncertain create response, review current data before retrying.

## Learn and verify

Start with the [nine-part upskilling course](astraupskill/README.md), then run `npm.cmd test` and `npm.cmd run build`. Optional real-browser verification is in [scripts/verify_browser.py](scripts/verify_browser.py). Use a new `ERP_CHECK_DIR` for each run so earlier evidence and credentials are preserved.

The API retains sales, purchasing, approvals, stock ledgers, accounting, collaboration, search, and reports. The browser focuses on master and project CRUD. Bearers expire after 30 minutes; every scoped API request requires `x-company-id` from the login company choices. Edits use `PUT /collection/:id` with `{version,data}`; deletes use `DELETE /collection/:id` with `{version}`.

This is a bounded local teaching system, not a production accounting package. Read [verification and limits](astraupskill/VERIFICATION.md), especially the illustrative valuation model, lack of durable create-request idempotency, and unsupported partial fulfillment. Original onboarding material remains available; the [historical README](docs/HISTORICAL-README.md) describes the earlier starter and may contain obsolete setup or authentication instructions.
