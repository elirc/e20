import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { fixtureEmails } from "../src/setup.js";
const passwords = Object.fromEntries(
  fixtureEmails.map((e) => [e, "Test-password-123!"]),
);
describe("Independent processes and scope", () => {
  let app: ReturnType<typeof buildApp>,
    folder: string,
    path: string,
    headers: Record<string, string>;
  const request = (method: any, url: string, payload?: unknown) =>
    app.inject({ method, url, headers, payload });
  const ok = async (method: any, url: string, payload?: unknown) => {
    const r = await request(method, url, payload);
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const state = () => {
    const db = new DatabaseSync(path);
    try {
      return db.prepare("SELECT body FROM workspace").get()!.body as string;
    } finally {
      db.close();
    }
  };
  beforeEach(async () => {
    folder = mkdtempSync(join(tmpdir(), "erp-race-"));
    path = join(folder, "erp.sqlite");
    closeSync(openSync(path, "wx"));
    app = buildApp({ databasePath: path, seedPasswords: passwords });
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "system@erp.local",
        password: passwords["system@erp.local"],
      },
    });
    headers = {
      authorization: `Bearer ${login.json().token}`,
      "x-company-id": login.json().companies[0].id,
    };
  });
  afterEach(async () => {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  async function race(
    jobs: Array<{ method: string; url: string; payload?: unknown }>,
  ) {
    const children = jobs.map(() =>
      spawn(
        process.execPath,
        ["--import", "tsx", resolve("tests/request-worker.ts")],
        {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          windowsHide: true,
        },
      ),
    );
    try {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("Worker readiness timeout")),
                60000,
              );
              child.once("error", reject);
              child.once("message", () => {
                clearTimeout(timeout);
                resolve();
              });
            }),
        ),
      );
      return await Promise.all(
        children.map(
          (child, index) =>
            new Promise<number>((resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error("Worker result timeout")),
                60000,
              );
              child.once("message", (result: any) => {
                clearTimeout(timeout);
                resolve(result.status);
              });
              child.send({ path, headers, ...jobs[index] });
            }),
        ),
      );
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null) {
                resolve();
                return;
              }
              child.once("exit", () => resolve());
              child.kill();
            }),
        ),
      );
    }
  }
  it("two server processes cannot both accept the same expected version", async () => {
    const customer = (await ok("GET", "/customers"))[0];
    const jobs = ["Writer one", "Writer two"].map((name) => ({
      method: "PUT",
      url: `/customers/${customer.id}`,
      payload: {
        version: 1,
        data: { name, code: customer.code, status: "active" },
      },
    }));
    expect((await race(jobs)).sort()).toEqual([200, 409]);
    const saved = (await ok("GET", "/customers"))[0];
    expect(saved.version).toBe(2);
    expect(
      JSON.parse(state()).auditLogs.filter((a: any) => a.action === "update"),
    ).toHaveLength(1);
  }, 90000);
  it("two processes cannot consume the same last stock unit", async () => {
    const customer = (await ok("GET", "/customers"))[0],
      supplier = (await ok("GET", "/suppliers"))[0],
      item = (await ok("GET", "/items"))[0],
      warehouse = (await ok("GET", "/warehouses"))[0];
    const receipt = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
    });
    await ok("POST", `/buying/receipts/${receipt.id}/submit`);
    const invoices = [];
    for (let n = 0; n < 2; n++)
      invoices.push(
        await ok("POST", "/sales/invoices", {
          customerId: customer.id,
          items: [{ itemId: item.id, quantity: 1, warehouseId: warehouse.id }],
        }),
      );
    expect(
      (
        await race(
          invoices.map((i) => ({
            method: "POST",
            url: `/sales/invoices/${i.id}/submit`,
          })),
        )
      ).sort(),
    ).toEqual([200, 400]);
    expect((await ok("GET", "/inventory/stock-balance"))[0].quantity).toBe(0);
    expect(
      (await ok("GET", "/sales/invoices")).filter(
        (i: any) => i.status === "submitted",
      ),
    ).toHaveLength(1);
  }, 90000);
  it("rejects cross-company records even for a user in both companies", async () => {
    const original = headers["x-company-id"],
      customer = (await ok("GET", "/customers"))[0];
    const company = await ok("POST", "/companies", {
      name: "Second fictional company",
    });
    headers["x-company-id"] = company.id;
    expect(await ok("GET", "/customers")).toEqual([]);
    expect(
      (
        await request("PUT", `/customers/${customer.id}`, {
          version: 1,
          data: { name: "Wrong tenant", code: customer.code, status: "active" },
        })
      ).statusCode,
    ).toBe(404);
    const before = state();
    expect(
      (
        await request("POST", "/projects", {
          name: "Wrong reference",
          customerId: customer.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(state()).toBe(before);
    headers["x-company-id"] = original;
    expect((await ok("GET", "/customers"))[0].name).toBe(customer.name);
  });
  it("replaying quotation conversion returns one existing order", async () => {
    const customer = (await ok("GET", "/customers"))[0],
      item = (await ok("GET", "/items"))[0];
    const q = await ok("POST", "/sales/quotations", {
      customerId: customer.id,
      items: [{ itemId: item.id, quantity: 1 }],
    });
    const first = await ok("POST", `/sales/quotations/${q.id}/convert`);
    const before = state();
    const second = await ok("POST", `/sales/quotations/${q.id}/convert`);
    expect(second.id).toBe(first.id);
    expect(state()).toBe(before);
  });
  it("purchase order approval is required before a linked receipt", async () => {
    const supplier = (await ok("GET", "/suppliers"))[0],
      item = (await ok("GET", "/items"))[0],
      warehouse = (await ok("GET", "/warehouses"))[0];
    const items = [
      { itemId: item.id, quantity: 40, rate: 30, warehouseId: warehouse.id },
    ];
    const po = await ok("POST", "/buying/orders", {
      supplierId: supplier.id,
      items,
    });
    await ok("POST", `/buying/orders/${po.id}/submit`);
    expect(
      (
        await request("POST", "/buying/receipts", {
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          items,
        })
      ).statusCode,
    ).toBe(400);
    await ok("POST", `/buying/orders/${po.id}/approve`);
    const receipt = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      purchaseOrderId: po.id,
      items,
    });
    await ok("POST", `/buying/receipts/${receipt.id}/submit`);
    const extra = await ok("POST", "/buying/receipts", {
      supplierId: supplier.id,
      purchaseOrderId: po.id,
      items,
    });
    const before = state();
    expect(
      (await request("POST", `/buying/receipts/${extra.id}/submit`)).statusCode,
    ).toBe(409);
    expect(state()).toBe(before);
  });
  it("logout revokes the current bearer", async () => {
    await ok("POST", "/auth/logout");
    expect((await request("GET", "/customers")).statusCode).toBe(401);
  });
  it("does not turn unrelated SQLite files into ERP databases", () => {
    const unrelated = join(folder, "unrelated.sqlite");
    const db = new DatabaseSync(unrelated);
    db.exec("CREATE TABLE personal_notes(id INTEGER PRIMARY KEY, note TEXT)");
    db.close();
    expect(() => buildApp({ databasePath: unrelated })).toThrow(
      "schema not found",
    );
    const check = new DatabaseSync(unrelated);
    try {
      expect(
        check
          .prepare("SELECT name FROM sqlite_master WHERE name='workspace'")
          .get(),
      ).toBeUndefined();
    } finally {
      check.close();
    }
  });
  it("rejects unsafe attachment URLs and unsupported stock modes", async () => {
    const project = await ok("POST", "/projects", {
      name: "Attachment project",
    });
    for (const url of [
      "javascript:alert(1)",
      "http://example.com/file",
      "https://user:password@example.com/file",
    ])
      expect(
        (
          await request(
            "POST",
            `/documents/project/${project.id}/attachments`,
            { fileName: "File", url },
          )
        ).statusCode,
      ).toBe(400);
    const item = (await ok("GET", "/items"))[0];
    for (const entryType of ["manufacturing", "reconciliation"])
      expect(
        (
          await request("POST", "/inventory/stock-entries", {
            entryType,
            itemId: item.id,
            quantity: 1,
          })
        ).statusCode,
      ).toBe(400);
  });
});
