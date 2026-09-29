import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { ERPStore } from "../src/domain/store.js";
import { setup, fixtureEmails } from "../src/setup.js";
const passwords = Object.fromEntries(
  fixtureEmails.map((email) => [email, "Test-password-123!"]),
);
describe("ERP integrity", () => {
  let folder: string,
    path: string,
    app: ReturnType<typeof buildApp>,
    token: string,
    companyId: string,
    customer: any,
    supplier: any,
    item: any,
    warehouse: any;
  const headers = () => ({
    authorization: `Bearer ${token}`,
    "x-company-id": companyId,
  });
  const request = async (
    method: any,
    url: string,
    payload?: unknown,
    extra = {},
  ) =>
    app.inject({ method, url, payload, headers: { ...headers(), ...extra } });
  const ok = async (method: any, url: string, payload?: unknown) => {
    const r = await request(method, url, payload);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const snapshot = () => {
    const db = new DatabaseSync(path);
    try {
      return db.prepare("SELECT revision,body FROM workspace").get()!;
    } finally {
      db.close();
    }
  };
  const mutate = (change: (s: any) => void) => {
    const db = new DatabaseSync(path);
    try {
      const s = JSON.parse(
        db.prepare("SELECT body FROM workspace").get()!.body as string,
      );
      change(s);
      db.prepare("UPDATE workspace SET body=?").run(JSON.stringify(s));
    } finally {
      db.close();
    }
  };
  const receipt = async (
    items = [
      { itemId: item.id, quantity: 10, rate: 30, warehouseId: warehouse.id },
    ],
  ) => {
    const r = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      items,
    });
    return ok("POST", `/buying/receipts/${r.id}/submit`);
  };
  const invoice = async (quantity = 1) => {
    const r = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity, warehouseId: warehouse.id }],
    });
    return ok("POST", `/sales/invoices/${r.id}/submit`);
  };
  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), "erp-check-"));
    path = join(folder, "erp.sqlite");
    closeSync(openSync(path, "wx"));
    app = buildApp({ databasePath: path, seedPasswords: passwords });
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@acme.local",
        password: passwords["admin@acme.local"],
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    token = login.json().token;
    companyId = login.json().companies[0].id;
    customer = (await ok("GET", "/customers"))[0];
    supplier = (await ok("GET", "/suppliers"))[0];
    item = (await ok("GET", "/items"))[0];
    warehouse = (await ok("GET", "/warehouses"))[0];
  });
  afterEach(async () => {
    await app?.close();
    rmSync(folder, { recursive: true, force: true });
  });
  it("stores hashes rather than passwords or bearer tokens", () => {
    const body = snapshot().body as string;
    expect(body).not.toContain(passwords["admin@acme.local"]);
    expect(body).not.toContain(token);
    expect(body).not.toContain("admin@acme.local-token");
  });
  it("requires explicit company and rejects predictable tokens", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/customers",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request("GET", "/customers", undefined, {
          authorization: "Bearer admin@acme.local-token",
        })
      ).statusCode,
    ).toBe(401);
  });
  it("rejects expired sessions and freshly disabled accounts", async () => {
    mutate((s) =>
      s.sessions.forEach(
        (r: any) => (r.expiresAt = "2000-01-01T00:00:00.000Z"),
      ),
    );
    expect((await request("GET", "/customers")).statusCode).toBe(401);
    const r = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "admin@acme.local",
        password: passwords["admin@acme.local"],
      },
    });
    token = r.json().token;
    mutate(
      (s) =>
        (s.users.find((u: any) => u.email === "admin@acme.local").active =
          false),
    );
    expect((await request("GET", "/customers")).statusCode).toBe(401);
  });
  it("refreshes roles at the transaction boundary", async () => {
    mutate(
      (s) =>
        (s.users.find((u: any) => u.email === "admin@acme.local").roles = [
          "auditor",
        ]),
    );
    expect(
      (await request("POST", "/customers", { name: "Denied" })).statusCode,
    ).toBe(403);
    expect((await ok("GET", "/customers")).length).toBe(1);
  });
  it("rolls back an entire receipt when a later line lacks a warehouse", async () => {
    const r = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      items: [
        { itemId: item.id, quantity: 2, warehouseId: warehouse.id },
        { itemId: item.id, quantity: 1 },
      ],
    });
    const before = snapshot();
    expect(
      (await request("POST", `/buying/receipts/${r.id}/submit`)).statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it("retains identical stock lines and replays submit only once", async () => {
    const r = await receipt([
      { itemId: item.id, quantity: 2, rate: 30, warehouseId: warehouse.id },
      { itemId: item.id, quantity: 2, rate: 30, warehouseId: warehouse.id },
    ]);
    const before = snapshot();
    await ok("POST", `/buying/receipts/${r.id}/submit`);
    expect(snapshot()).toEqual(before);
    expect((await ok("GET", "/inventory/stock-ledger")).length).toBe(2);
    expect((await ok("GET", "/inventory/stock-balance"))[0].quantity).toBe(4);
  });
  it("retains identical journal lines", async () => {
    const j = await ok("POST", "/accounting/journal-entries", {
      lines: [
        { account: "Bank", debit: 10, credit: 0 },
        { account: "Bank", debit: 10, credit: 0 },
        { account: "Retained Earnings", debit: 0, credit: 20 },
      ],
    });
    await ok("POST", `/accounting/journal-entries/${j.id}/submit`);
    const b = await ok("GET", "/reports/trial-balance");
    expect(b.find((x: any) => x.account === "Bank").debit).toBe(20);
  });
  it("rejects insufficient stock without ledger, status, or audit changes", async () => {
    const r = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    const before = snapshot();
    expect(
      (await request("POST", `/sales/invoices/${r.id}/submit`)).statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it("respects reservations when invoicing unrelated orders", async () => {
    await receipt([
      { itemId: item.id, quantity: 1, rate: 30, warehouseId: warehouse.id },
    ]);
    const o = await ok("POST", "/sales/orders", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    await ok("POST", `/sales/orders/${o.id}/submit`);
    const i = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    const before = snapshot();
    expect(
      (await request("POST", `/sales/invoices/${i.id}/submit`)).statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it("keeps accepted costs after item edits", async () => {
    await receipt();
    const inv = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    const { id, version, companyId, createdAt, updatedAt, createdBy, ...data } =
      item;
    await ok("PUT", `/items/${id}`, {
      version,
      data: { ...data, standardCost: 99 },
    });
    await ok("POST", `/sales/invoices/${inv.id}/submit`);
    expect((await ok("GET", "/reports/profit-and-loss")).expenses).toBe(35);
  });
  it("preserves a zero receipt rate", async () => {
    await receipt([
      { itemId: item.id, quantity: 1, rate: 0, warehouseId: warehouse.id },
    ]);
    expect((await ok("GET", "/inventory/stock-balance"))[0].stockValue).toBe(0);
  });
  it("deducts zero-cost stock but never service quantities", async () => {
    const { id, version, companyId, createdAt, updatedAt, createdBy, ...data } =
      item;
    await ok("PUT", `/items/${id}`, {
      version,
      data: { ...data, standardCost: 0 },
    });
    await receipt();
    await invoice();
    expect((await ok("GET", "/inventory/stock-balance"))[0].quantity).toBe(9);
    const service = await ok("POST", "/items", {
      ...data,
      sku: "SVC-01",
      isStockItem: false,
      standardCost: 99,
    });
    const inv = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: service.id, quantity: 1 }],
    });
    await ok("POST", `/sales/invoices/${inv.id}/submit`);
    expect((await ok("GET", "/reports/profit-and-loss")).expenses).toBe(0);
  });
  it("rejects payment overage and duplicate payment acceptance", async () => {
    await receipt();
    const i = await invoice();
    const payload = {
      direction: "inbound",
      partyType: "customer",
      partyId: customer.id,
      referenceType: "sales_invoice",
      referenceId: i.id,
      amount: 75,
    };
    const p = await ok("POST", "/accounting/payments", payload);
    const p2 = await ok("POST", "/accounting/payments", payload);
    await ok("POST", `/accounting/payments/${p.id}/submit`);
    const before = snapshot();
    await ok("POST", `/accounting/payments/${p.id}/submit`);
    expect(snapshot()).toEqual(before);
    expect(
      (await request("POST", `/accounting/payments/${p2.id}/submit`))
        .statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(before);
  });
  it("rejects payment against draft, wrong party, and wrong direction", async () => {
    const i = await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    const p = {
      direction: "inbound",
      partyType: "customer",
      partyId: customer.id,
      referenceType: "sales_invoice",
      referenceId: i.id,
      amount: 75,
    };
    expect((await request("POST", "/accounting/payments", p)).statusCode).toBe(
      400,
    );
    await receipt();
    await ok("POST", `/sales/invoices/${i.id}/submit`);
    const c = await ok("POST", "/customers", { name: "Other customer" });
    expect(
      (await request("POST", "/accounting/payments", { ...p, partyId: c.id }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/accounting/payments", {
          ...p,
          direction: "outbound",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("guards stale edits and referenced deletes atomically", async () => {
    const payload = { name: "Renamed", code: customer.code, status: "active" };
    await ok("PUT", `/customers/${customer.id}`, { version: 1, data: payload });
    const before = snapshot();
    expect(
      (
        await request("PUT", `/customers/${customer.id}`, {
          version: 1,
          data: { ...payload, name: "Stale" },
        })
      ).statusCode,
    ).toBe(409);
    expect(snapshot()).toEqual(before);
    await ok("POST", "/projects", {
      name: "References customer",
      customerId: customer.id,
    });
    const linked = snapshot();
    expect(
      (await request("DELETE", `/customers/${customer.id}`, { version: 2 }))
        .statusCode,
    ).toBe(400);
    expect(snapshot()).toEqual(linked);
  });
  it("rejects duplicate codes, fractional money, fractional quantity, and unknown fields", async () => {
    for (const body of [
      { name: "Duplicate", code: customer.code.toLowerCase() },
      { name: "Unknown", admin: true },
    ])
      expect((await request("POST", "/customers", body)).statusCode).toBe(400);
    for (const line of [
      { itemId: item.id, quantity: 0.5 },
      { itemId: item.id, quantity: 1, rate: 1.234 },
    ])
      expect(
        (
          await request("POST", "/sales/invoices", {
            customerId: customer.id,
            items: [line],
          })
        ).statusCode,
      ).toBe(400);
  });
  it("checks project/task relationships and real dates", async () => {
    const p = await ok("POST", "/projects", { name: "A" }),
      p2 = await ok("POST", "/projects", { name: "B" });
    const task = await ok("POST", "/projects/tasks", {
      projectId: p.id,
      title: "Task",
    });
    const me = await ok("GET", "/auth/me");
    expect(
      (
        await request("POST", "/projects/timesheets", {
          projectId: p2.id,
          taskId: task.id,
          userId: me.user.id,
          hours: 1,
          workDate: "2026-09-09",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/projects/tasks", {
          projectId: p.id,
          title: "Bad date",
          dueDate: "2026-02-30",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("does not count draft invoices as aging or outstanding", async () => {
    await ok("POST", "/sales/invoices", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1 }],
    });
    expect((await ok("GET", "/reports/aging")).receivables).toEqual([]);
    expect(
      (await ok("GET", "/dashboards/summary")).receivablesOutstanding,
    ).toBe(0);
  });
  it("checks entity access for comments and search", async () => {
    const p = await ok("POST", "/projects", { name: "Confidential launch" });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "sales@acme.local",
        password: passwords["sales@acme.local"],
      },
    });
    token = login.json().token;
    expect(
      (await request("GET", `/documents/project/${p.id}/comments`)).statusCode,
    ).toBe(403);
    expect(await ok("GET", "/search?q=Confidential")).toEqual([]);
    expect((await request("GET", "/dashboards/summary")).statusCode).toBe(403);
  });
  it("guards host and origin and neutralizes CSV formulas", async () => {
    expect(
      (await request("GET", "/customers", undefined, { host: "evil.example" }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await request("GET", "/customers", undefined, {
          origin: "https://evil.example",
        })
      ).statusCode,
    ).toBe(403);
    await ok("POST", "/customers", { name: "=SUM(1,2)" });
    expect((await request("GET", "/reports/export/customers")).body).toContain(
      "'=SUM(1,2)",
    );
  });
  it("persists across restart and sees other connection changes", async () => {
    const second = buildApp({ databasePath: path });
    try {
      await ok("POST", "/customers", { name: "Across connections" });
      const r = await second.inject({
        method: "GET",
        url: "/customers",
        headers: headers(),
      });
      expect(r.json().some((c: any) => c.name === "Across connections")).toBe(
        true,
      );
    } finally {
      await second.close();
    }
    await app.close();
    app = buildApp({ databasePath: path });
    expect(
      (await ok("GET", "/customers")).some(
        (c: any) => c.name === "Across connections",
      ),
    ).toBe(true);
  });
  it("rolls back a failed SQLite write and accepts a later explicit retry", async () => {
    const draft = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    const before = snapshot();
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER fail_save BEFORE UPDATE ON workspace BEGIN SELECT RAISE(FAIL, 'Forced test failure'); END",
    );
    db.close();
    const response = await request(
      "POST",
      `/buying/receipts/${draft.id}/submit`,
    );
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("Forced test failure");
    expect(snapshot()).toEqual(before);
    const repair = new DatabaseSync(path);
    repair.exec("DROP TRIGGER fail_save");
    repair.close();
    await ok("POST", `/buying/receipts/${draft.id}/submit`);
    expect((await ok("GET", "/inventory/stock-balance"))[0].quantity).toBe(1);
  });
  it("does not overwrite malformed persisted state", async () => {
    const db = new DatabaseSync(path);
    db.prepare("UPDATE workspace SET body=?").run('{"broken":true}');
    db.close();
    const before = snapshot();
    expect((await request("GET", "/customers")).statusCode).toBe(500);
    expect(snapshot()).toEqual(before);
  });
  it("refuses asynchronous transaction callbacks and rolls back", () => {
    const store = new ERPStore({ databasePath: path });
    const before = snapshot();
    try {
      expect(() => store.access(true, () => Promise.resolve(1))).toThrow(
        "synchronous",
      );
      expect(snapshot()).toEqual(before);
    } finally {
      store.close();
    }
  });
  it("setup refuses existing database and credential paths", () => {
    expect(() => setup(path, join(folder, "new-credentials.json"))).toThrow();
    expect(() =>
      setup(join(folder, "new.sqlite"), join(folder, "new-credentials.json")),
    ).toThrow();
    expect(snapshot().body).toContain("Acme Manufacturing");
  });
});
