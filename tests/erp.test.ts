import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

type TokenMap = Record<string, string>;

describe("ERP starter API", () => {
  let app: ReturnType<typeof buildApp>;
  let companyId: string;
  let tokens: TokenMap;
  let customerId: string;
  let supplierId: string;
  let itemId: string;
  let warehouseId: string;

  beforeEach(async () => {
    app = buildApp({
      databasePath: ":memory:",
      seedPasswords: Object.fromEntries(
        [
          "system@erp.local",
          "admin@acme.local",
          "sales@acme.local",
          "purchase@acme.local",
          "inventory@acme.local",
          "accounts@acme.local",
          "projects@acme.local",
          "audit@acme.local",
        ].map((email) => [email, "Test-password-123!"]),
      ),
    });
    await app.ready();
    companyId = "";

    tokens = {
      admin: await login("admin@acme.local"),
      sales: await login("sales@acme.local"),
      purchase: await login("purchase@acme.local"),
      inventory: await login("inventory@acme.local"),
      accounts: await login("accounts@acme.local"),
      projects: await login("projects@acme.local"),
      auditor: await login("audit@acme.local"),
    };

    const me = await authedGet("/auth/me", tokens.admin);
    companyId = me.company.id;

    customerId = (await authedGet("/customers", tokens.sales))[0].id;
    supplierId = (await authedGet("/suppliers", tokens.purchase))[0].id;
    itemId = (await authedGet("/items", tokens.inventory))[0].id;
    warehouseId = (await authedGet("/warehouses", tokens.inventory))[0].id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("runs the sales lifecycle from quotation to invoice to payment", async () => {
    const receipt = await authedPost("/buying/receipts", tokens.purchase, {
      supplierId,
      items: [{ itemId, quantity: 2, rate: 30, warehouseId }],
    });
    await authedPost(`/buying/receipts/${receipt.id}/submit`, tokens.purchase);
    const quotation = await authedPost("/sales/quotations", tokens.sales, {
      customerId,
      items: [{ itemId, quantity: 2, warehouseId }],
    });

    expect(quotation.status).toBe("draft");

    const submittedQuotation = await authedPost(
      `/sales/quotations/${quotation.id}/submit`,
      tokens.sales,
    );
    expect(submittedQuotation.status).toBe("submitted");

    const salesOrder = await authedPost(
      `/sales/quotations/${quotation.id}/convert`,
      tokens.sales,
    );
    expect(salesOrder.status).toBe("draft");

    const submittedOrder = await authedPost(
      `/sales/orders/${salesOrder.id}/submit`,
      tokens.sales,
    );
    expect(submittedOrder.status).toBe("submitted");

    const invoice = await authedPost("/sales/invoices", tokens.accounts, {
      customerId,
      salesOrderId: salesOrder.id,
      items: [{ itemId, quantity: 2, warehouseId }],
    });

    const submittedInvoice = await authedPost(
      `/sales/invoices/${invoice.id}/submit`,
      tokens.accounts,
    );
    expect(submittedInvoice.status).toBe("submitted");
    expect(submittedInvoice.outstandingAmount).toBe(150);

    const payment = await authedPost("/accounting/payments", tokens.accounts, {
      direction: "inbound",
      partyType: "customer",
      partyId: customerId,
      referenceType: "sales_invoice",
      referenceId: invoice.id,
      amount: 150,
    });

    const submittedPayment = await authedPost(
      `/accounting/payments/${payment.id}/submit`,
      tokens.accounts,
    );
    expect(submittedPayment.status).toBe("submitted");

    const invoices = await authedGet("/sales/invoices", tokens.accounts);
    const paidInvoice = invoices.find(
      (entry: { id: string }) => entry.id === invoice.id,
    );
    expect(paidInvoice.status).toBe("paid");
    expect(paidInvoice.outstandingAmount).toBe(0);

    const dashboard = await authedGet("/dashboards/summary", tokens.admin);
    expect(dashboard.receivablesOutstanding).toBe(0);
  });

  it("updates stock strictly through the stock ledger on purchase receipt submit", async () => {
    const receipt = await authedPost("/buying/receipts", tokens.inventory, {
      supplierId,
      items: [{ itemId, quantity: 5, warehouseId, rate: 30 }],
    });

    const submittedReceipt = await authedPost(
      `/buying/receipts/${receipt.id}/submit`,
      tokens.inventory,
    );
    expect(submittedReceipt.status).toBe("submitted");

    const stockBalance = await authedGet(
      "/inventory/stock-balance",
      tokens.inventory,
    );
    const mainBalance = stockBalance.find(
      (entry: { itemId: string; warehouseId: string }) =>
        entry.itemId === itemId && entry.warehouseId === warehouseId,
    );

    expect(mainBalance.quantity).toBe(5);
    expect(mainBalance.stockValue).toBe(150);

    const stockLedger = await authedGet(
      "/inventory/stock-ledger",
      tokens.inventory,
    );
    expect(stockLedger).toHaveLength(1);
    expect(stockLedger[0].quantityChange).toBe(5);
  });

  it("posts balanced GL entries and report totals follow source documents", async () => {
    const receipt = await authedPost("/buying/receipts", tokens.inventory, {
      supplierId,
      items: [{ itemId, quantity: 3, warehouseId, rate: 30 }],
    });
    await authedPost(`/buying/receipts/${receipt.id}/submit`, tokens.inventory);

    const invoice = await authedPost("/sales/invoices", tokens.accounts, {
      customerId,
      items: [{ itemId, quantity: 2, warehouseId }],
    });
    await authedPost(`/sales/invoices/${invoice.id}/submit`, tokens.accounts);

    const trialBalance = await authedGet(
      "/reports/trial-balance",
      tokens.accounts,
    );
    const debitTotal = trialBalance.reduce(
      (sum: number, line: { debit: number }) => sum + line.debit,
      0,
    );
    const creditTotal = trialBalance.reduce(
      (sum: number, line: { credit: number }) => sum + line.credit,
      0,
    );

    expect(debitTotal).toBe(310);
    expect(creditTotal).toBe(310);

    const pnl = await authedGet("/reports/profit-and-loss", tokens.accounts);
    expect(pnl.income).toBe(150);
    expect(pnl.expenses).toBe(70);
    expect(pnl.netProfit).toBe(80);

    const balanceSheet = await authedGet(
      "/reports/balance-sheet",
      tokens.accounts,
    );
    expect(balanceSheet.assets).toBe(170);
    expect(balanceSheet.liabilities).toBe(90);
    expect(balanceSheet.equity).toBe(80);
  });

  it("enforces approval roles for purchase orders above the threshold", async () => {
    const purchaseOrder = await authedPost("/buying/orders", tokens.purchase, {
      supplierId,
      items: [{ itemId, quantity: 40, warehouseId, rate: 30 }],
    });

    const submittedPurchaseOrder = await authedPost(
      `/buying/orders/${purchaseOrder.id}/submit`,
      tokens.purchase,
    );
    expect(submittedPurchaseOrder.status).toBe("pending_approval");

    const failedApproval = await app.inject({
      method: "POST",
      url: `/buying/orders/${purchaseOrder.id}/approve`,
      headers: headersFor(tokens.purchase),
    });

    expect(failedApproval.statusCode).toBe(403);

    const approved = await authedPost(
      `/buying/orders/${purchaseOrder.id}/approve`,
      tokens.admin,
    );
    expect(approved.status).toBe("submitted");
    expect(approved.approvalState).toBe("approved");
  });

  it("keeps submit actions idempotent so retries do not double post ledgers", async () => {
    const receipt = await authedPost("/buying/receipts", tokens.inventory, {
      supplierId,
      items: [{ itemId, quantity: 2, warehouseId, rate: 30 }],
    });
    await authedPost(`/buying/receipts/${receipt.id}/submit`, tokens.inventory);

    const invoice = await authedPost("/sales/invoices", tokens.accounts, {
      customerId,
      items: [{ itemId, quantity: 1, warehouseId }],
    });

    await authedPost(`/sales/invoices/${invoice.id}/submit`, tokens.accounts);
    await authedPost(`/sales/invoices/${invoice.id}/submit`, tokens.accounts);

    const trialBalance = await authedGet(
      "/reports/trial-balance",
      tokens.accounts,
    );
    const accountsReceivable = trialBalance.find(
      (entry: { account: string }) => entry.account === "Accounts Receivable",
    );
    const salesRevenue = trialBalance.find(
      (entry: { account: string }) => entry.account === "Sales Revenue",
    );
    const cogs = trialBalance.find(
      (entry: { account: string }) => entry.account === "Cost of Goods Sold",
    );

    expect(accountsReceivable.balance).toBe(75);
    expect(salesRevenue.credit).toBe(75);
    expect(cogs.debit).toBe(35);

    const stockLedger = await authedGet(
      "/inventory/stock-ledger",
      tokens.inventory,
    );
    expect(stockLedger).toHaveLength(2);
  });

  it("supports projects, tasks, timesheets, search, comments, attachments, and csv exports", async () => {
    const project = await authedPost("/projects", tokens.projects, {
      name: "Client rollout",
      customerId,
      budgetHours: 40,
    });

    const task = await authedPost("/projects/tasks", tokens.projects, {
      projectId: project.id,
      title: "Configure warehouse sync",
      priority: "high",
    });

    const timesheet = await authedPost(
      "/projects/timesheets",
      tokens.projects,
      {
        projectId: project.id,
        taskId: task.id,
        userId: (await authedGet("/auth/me", tokens.projects)).user.id,
        hours: 3.5,
        billable: true,
        workDate: "2026-03-21",
      },
    );

    expect(timesheet.hours).toBe(3.5);

    const comment = await authedPost(
      `/documents/project/${project.id}/comments`,
      tokens.projects,
      {
        body: "Kickoff completed",
      },
    );
    expect(comment.body).toContain("Kickoff");

    const attachment = await authedPost(
      `/documents/project/${project.id}/attachments`,
      tokens.projects,
      {
        fileName: "scope.pdf",
        url: "https://example.com/scope.pdf",
      },
    );
    expect(attachment.fileName).toBe("scope.pdf");

    const searchResults = await authedGet("/search?q=rollout", tokens.projects);
    expect(
      searchResults.some((entry: { id: string }) => entry.id === project.id),
    ).toBe(true);

    const exportResponse = await app.inject({
      method: "GET",
      url: "/reports/export/projects",
      headers: headersFor(tokens.projects),
    });

    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body).toContain("Client rollout");
  });

  async function login(email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email,
        password: "Test-password-123!",
      },
    });

    expect(response.statusCode).toBe(200);
    companyId = response.json().user.companyIds[0];
    return response.json().token as string;
  }

  function headersFor(token: string) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };

    if (companyId) {
      headers["x-company-id"] = companyId;
    }

    return headers;
  }

  async function authedGet(url: string, token: string) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: headersFor(token),
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function authedPost(url: string, token: string, payload?: unknown) {
    const response = await app.inject({
      method: "POST",
      url,
      headers: headersFor(token),
      payload,
    });

    expect(response.statusCode).toBe(200);
    return response.json();
  }
});
