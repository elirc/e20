# 7. Trace lab: explain one change from input to committed state

This lab combines the browser, HTTP, domain service, and database. Use fictional records and keep a short evidence notebook. Record observations without copying passwords or bearer tokens into screenshots, reports, or Git.

## Part one: trace a customer edit

Sign in as the company administrator. Create a customer named `Trace Lab Customer` with code `TRACE-001`. Open its editor and note version 1. Change the name to `Trace Lab Customer Revised` and save. Find the update in the browser Network panel and inspect the request body. You should see the expected version and editable data, while company selection travels in `x-company-id`.

Put a breakpoint in `editMaster`. Confirm that the stored record belongs to the selected company and has the submitted version. Step through replacement of editable properties and the increment to version 2. Then step into `SnapshotDatabase.access` and inspect the candidate before validation and before the update statement.

```text
Before: customer version 1, original name
Candidate: version 2, revised name, one new audit event
After commit: the candidate becomes the accepted database state
Response: the browser refreshes its module list
```

Now repeat from two tabs. Load version 2 in both. Save one tab, then try saving the other. Write down which layer returns 409 and which browser variable retains the rejected draft. Export that draft and inspect the JSON: it should contain the old baseline version and your unsaved field values, not a session token.

## Part two: trace a project relationship

Create a project and a task linked to it. Create a timesheet linked to that task and project. Use a different project ID in a direct timesheet request. The request should fail even if both projects are in the same company, because the selected task belongs to one specific project.

The TypeScript type says both values are strings. The runtime relationship check establishes the stronger business fact. Find the check in `validateState`. Explain why a UUID format check alone cannot prove that the task belongs to the selected project.

Try deleting the referenced project. The candidate would leave a task or timesheet without its parent, so validation rejects the whole deletion. The original project and audit state remain. Marking a project completed is a different operation that retains its identity and references.

## Part three: trace stock contention

Read the process test that creates one available unit and two draft invoices. Both worker processes receive permission to attempt submission. SQLite grants one write transaction at a time. The first accepted transaction consumes the unit; the second reloads that new state and fails the availability check.

Draw the timeline on paper. Include the point where each process obtains its write transaction, loads state, validates, and commits or rolls back. Do not draw both processes reading the same candidate and then independently committing; the test is designed to disprove that unsafe sequence.

Finish by explaining what the trace does not prove. It is not a power-loss certification, a distributed multi-host test, or a complete stock valuation audit. It demonstrates the stated local process coordination and business invariants. This habit of defining the practical limits of evidence is part of the transition from junior implementation work to mid-level engineering judgment.
