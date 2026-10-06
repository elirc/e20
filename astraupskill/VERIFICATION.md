# Verification and practical limits

The implementation is verified through the original ERP workflow suite, added integrity scenarios, independent process checks, a TypeScript build, and a real Chromium workbench run. The final delivery report records the completed counts and environment. Consult [the test guide](04-TESTING-AND-DEBUGGING.md) for reproduction commands rather than treating a screenshot as proof of persistence or authorization.

## What the checks exercise

The original workflows cover sales quotation through payment, purchase receipts, ledger-derived reports, purchase approvals, repeat submission, and project collaboration. New API checks exercise password and token storage, explicit company selection, expiry and current-user policy, full rollback after a late receipt failure, identical ledger lines, stock reservations, accepted cost snapshots, zero rates, overpayments, stale edits, reference guards, bounded input, real dates, report filtering, entity access, CSV escaping, restart behavior, invalid persisted state, and setup refusal of existing outputs.

The separate-process tests send competing requests through actual server instances sharing one database. They check version conflicts and competition for the last available stock unit. Additional scenarios cover cross-company references, quotation replay, purchase approval before linked receipt, logout, unsupported stock modes, unsafe attachment URLs, and refusal to initialize an unrelated SQLite database.

Browser checks cover master CRUD, project/task/timesheet relationships, two-tab conflicts, retained and exported drafts, auditor restrictions, a deliberately lost create acknowledgement, literal search, pagination, and responsive widths. The browser fixture uses generated local credentials and an exclusively created database. It does not access real accounts or external ERP services.

## Limits you should be able to explain

The persistence model is a bounded JSON aggregate in SQLite, with at most 10,000 records per collection, 1,000 sessions, and a 20 MiB serialized workspace. It is deliberately synchronous and serializes writes. It is useful for tracing transactions, but is not a normalized, indexed, horizontally scaled ERP storage design.

Sessions expire after 30 minutes and require current active users and company membership. There is no account provisioning UI, password recovery, MFA, refresh-token rotation, or distributed rate limiter. The server binds to loopback; deployment behind a public reverse proxy is not implemented or certified.

The accounting model is illustrative. It uses USD, whole stock quantities, purchase rates for receipts, and accepted standard costs for sales. It does not implement tax, currency conversion, period closing, valuation variance reconciliation, statutory reporting, real payment processing, or bank integration. Manufacturing and reconciliation stock modes are rejected instead of pretending to implement them.

Linked documents require complete matching quantities and rates; partial fulfillment and reversals need a separate design. Submitted-document replay is supported, while durable idempotency for creation requests is not. After a lost create response, inspect current data before deciding to retry. Draft exports support manual review and do not implement automatic draft import or durable tab restoration.

The workbench focuses on master data and project CRUD. Operational sales, purchasing, stock posting, and accounting routes remain API workflows taught in the tests and trace exercises. Browser checks do not establish full accessibility compliance, all-browser compatibility, power-loss recovery, or production readiness. Preserve those distinctions when presenting this project in a portfolio.

## Recorded delivery checks

The final API run completed with **39 of 39 tests passed and process exit code 0**. It used one Vitest worker, disabled file parallelism, a 60-second hook timeout and a 90-second default test timeout. The two explicitly longer independent-process scenarios keep their own declared limits. A previous 38-test run produced passing assertions but a nonzero process exit; that run was not accepted as clean verification. The final verbose log and JSON report both support the recorded result.

The TypeScript production build completed successfully. All **seven distinct Chromium browser scenarios passed**. After visual review found the overlapping status banner, five affected scenarios were rerun successfully with an additional non-overlap assertion. Those five are rechecks, not five extra unique feature tests. Seven final screenshots were visually reviewed and linked from the course index. The package manifest and lockfile root dependencies, development dependencies, and Node engine match.

The combined count is **46 unique checks: 39 API/process tests plus seven browser scenarios**. Verification ran on Node 22.16.0 with builtin SQLite, Fastify 5.8.2, TypeScript 5.9.3, Vitest 3.2.4, and Chromium 148. All generated credentials and database fixtures stayed in disposable verification directories. No live business workspace or external account was used. The central implementation report retains the per-project evidence and delivery hashes.

## Status note (2026-10-06 documentation pass)

The delivery figures above are a frozen record; they were not re-run in this pass because no dependencies were installed. What was re-checked against the current code:

- **Test count:** 39 = `tests/concurrency.test.ts` 8 + `tests/erp.test.ts` 6 + `tests/integrity.test.ts` 25, counted from `it(` blocks.
- **Browser scenarios:** `scripts/verify_browser.py` defines seven: `masters`, `projects`, `conflict`, `permissions`, `uncertain`, `layout`, `pagination`.
- **Limits:** the 10,000-record / 1,000-session cap (`src/domain/state-schema.ts:341`) and the 20 MiB `MAX_BYTES` (`:345`) match the text.
- **Practice checks:** warm-ups W2 and W3 in [05-PRACTICE](05-PRACTICE.md) were executed as dependency-free `node --test` files on Node 22.16.0 and passed. W4's vitest command was not run.
- **Corrections in this pass:**
  - 01-CODEBASE-MAP previously placed the authorization decision in `security.ts`; it lives in `erp-service.ts`.
  - 04 referenced a `unit-final.log` that is not in the repo.
  - Worked Assignment D named service methods that do not exist and claimed duplicate codes return 409; they return 400.

