# Job-readiness pack: E20 ERP starter

The `astraupskill/` course next door explains how this system works. This folder turns it into interview material for CRUD and back-end web roles.

## The one-paragraph pitch

E20 is a small ERP on Fastify and TypeScript: companies, users and roles, master data, sales quotation through order, invoice and payment, purchase order through receipt and invoice, stock ledger postings, general-ledger entries, projects and timesheets. Persistence is unusual and worth being able to defend: the entire workspace is one validated JSON aggregate in a single SQLite row, and every HTTP request runs inside one database transaction, wired once in a Fastify `onRoute` hook so no handler can forget it. That single decision is what makes a purchase-receipt submission all-or-nothing. The worked defect is exactly that: a receipt whose second line had no warehouse used to leave the document submitted and the first line's stock already posted. The regression test does not assert an error code; it captures the whole database row before the attempt and asserts it is unchanged afterwards, which proves no version was consumed, no audit event appended and no stock entry left behind. Verification is 46 unique checks: 39 API and cross-process tests plus seven Chromium browser scenarios, on Node 22.16.0 with builtin SQLite.

## Target stack

This is on-stack for TypeScript and Node roles: Fastify hooks, Zod parsing with `.strict()`, `node:sqlite`'s `DatabaseSync`, `BEGIN IMMEDIATE`, scrypt password hashing and `timingSafeEqual`. Most of it carries to ASP.NET Core almost unchanged, because the pattern is the classic unit of work: the `onRoute` wrapper is what a scoped `DbContext` plus a transaction filter gives you there, and the version envelope on every edit is `[ConcurrencyCheck]` plus a 409. The one thing that does not carry is the aggregate itself, and saying why is a good answer rather than an awkward one.

## Two-week route

- Days 1-2: `01-INTERVIEW-QUESTIONS.md` screening group, with `src/domain/database.ts` and `src/app.ts` open. Both are short and both matter more than their size suggests.
- Days 3-5: deep dive, one sitting each on the transaction boundary, the receipt rollback, and stale edits.
- Days 6-7: `03-CODE-READING-DRILL.md`, answers closed.
- Days 8-9: rehearse `02-STORIES-AND-RESUME.md` aloud; time the 60-second summary.
- Days 10-13: `04-TAKE-HOME.md`. Run one test at a time; the full suite is slow.

## Files

- [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md)
- [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md)
- [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md)
- [04-TAKE-HOME.md](04-TAKE-HOME.md)

One habit to carry into the interview from `astraupskill/VERIFICATION.md`: the limits are part of the answer. This is USD-only, whole stock quantities, no tax, no period closing, no partial fulfillment, and manufacturing and reconciliation stock modes are rejected rather than faked. Naming those first is what makes the rest of the claims credible.
