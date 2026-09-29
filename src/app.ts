import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { DomainError } from "./domain/errors.js";
import { ERPService } from "./domain/erp-service.js";
import { ERPStore } from "./domain/store.js";

export function buildApp(options: {
  databasePath: string;
  seedPasswords?: Record<string, string>;
}) {
  const app = Fastify({
    logger: false,
    exposeHeadRoutes: false,
    bodyLimit: 256 * 1024,
  });

  const assets: Record<string, string> = Object.fromEntries(
    ["index.html", "workbench.js", "workbench.css"].map((file) => [
      file,
      readFileSync(resolve("public", file), "utf8"),
    ]),
  );
  const store = new ERPStore(options);
  const service = new ERPService(store);
  app.addHook("onClose", async () => store.close());
  app.addHook("onRequest", async (request, reply) => {
    const host = request.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      throw new DomainError("Forbidden host", 403);
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`)
      throw new DomainError("Forbidden origin", 403);
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store");
  });
  app.addHook("onRoute", (route) => {
    const handler = route.handler;
    const method = Array.isArray(route.method) ? route.method[0] : route.method;
    route.handler = async function (request, reply) {
      return store.access(!["GET", "HEAD"].includes(method), () =>
        handler.call(this, request, reply),
      );
    };
  });
  const authAttempts = new Map<string, { count: number; resetAt: number }>();

  const getContext = (request: { headers: Record<string, unknown> }) => {
    const authorization = String(request.headers.authorization ?? "");
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
    const companyIdHeader = request.headers["x-company-id"];
    const companyId =
      typeof companyIdHeader === "string" ? companyIdHeader : undefined;
    return service.authenticate(token, companyId);
  };

  const rateLimitLogin = (ip: string) => {
    const now = Date.now();
    for (const [key, value] of authAttempts)
      if (value.resetAt <= now) authAttempts.delete(key);
    if (!authAttempts.has(ip) && authAttempts.size >= 1000)
      throw new DomainError("Too many login attempts", 429);
    const existing = authAttempts.get(ip);
    if (!existing || existing.resetAt < now) {
      authAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return;
    }

    if (existing.count >= 10) {
      throw new DomainError(
        "Too many login attempts, please retry in a minute",
        429,
      );
    }

    existing.count += 1;
  };

  for (const [url, file, type] of [
    ["/", "index.html", "text/html; charset=utf-8"],
    ["/workbench.js", "workbench.js", "text/javascript; charset=utf-8"],
    ["/workbench.css", "workbench.css", "text/css; charset=utf-8"],
  ]) {
    const content = assets[file];
    app.get(url, (_request, reply) => {
      reply
        .type(type)
        .header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      return content;
    });
  }
  app.get("/reference-data", (request) =>
    service.references(getContext(request)),
  );
  app.get("/health", () => ({
    ok: true,
    service: "erp-suite-starter",
  }));

  app.post("/auth/login", (request) => {
    rateLimitLogin(request.ip);
    return service.login(request.body);
  });

  app.post("/auth/logout", (request) => {
    getContext(request);
    return service.logout(String(request.headers.authorization).slice(7));
  });
  app.get("/auth/me", (request) => service.listMe(getContext(request)));

  app.get("/companies", (request) =>
    service.listCompanies(getContext(request)),
  );
  app.post("/companies", (request) =>
    service.createCompany(getContext(request), request.body),
  );

  app.get("/customers", (request) =>
    service.listCustomers(getContext(request)),
  );
  app.post("/customers", (request) =>
    service.createCustomer(getContext(request), request.body),
  );

  app.get("/suppliers", (request) =>
    service.listSuppliers(getContext(request)),
  );
  app.post("/suppliers", (request) =>
    service.createSupplier(getContext(request), request.body),
  );

  app.get("/items", (request) => service.listItems(getContext(request)));
  app.post("/items", (request) =>
    service.createItem(getContext(request), request.body),
  );

  app.get("/warehouses", (request) =>
    service.listWarehouses(getContext(request)),
  );
  app.post("/warehouses", (request) =>
    service.createWarehouse(getContext(request), request.body),
  );

  for (const [route, collection] of [
    ["customers", "customers"],
    ["suppliers", "suppliers"],
    ["items", "items"],
    ["warehouses", "warehouses"],
    ["crm/leads", "leads"],
    ["projects", "projects"],
    ["projects/tasks", "tasks"],
    ["projects/timesheets", "timesheets"],
  ]) {
    app.put(`/${route}/:id`, (request) =>
      service.editMaster(
        getContext(request),
        collection,
        String((request.params as { id: string }).id),
        request.body,
      ),
    );
    app.delete(`/${route}/:id`, (request) =>
      service.editMaster(
        getContext(request),
        collection,
        String((request.params as { id: string }).id),
        request.body,
        true,
      ),
    );
  }
  app.get("/crm/leads", (request) => service.listLeads(getContext(request)));
  app.post("/crm/leads", (request) =>
    service.createLead(getContext(request), request.body),
  );

  app.get("/sales/quotations", (request) =>
    service.listQuotations(getContext(request)),
  );
  app.post("/sales/quotations", (request) =>
    service.createQuotation(getContext(request), request.body),
  );
  app.post("/sales/quotations/:id/submit", (request) =>
    service.submitQuotation(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );
  app.post("/sales/quotations/:id/convert", (request) =>
    service.convertQuotationToSalesOrder(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/sales/orders", (request) =>
    service.listSalesOrders(getContext(request)),
  );
  app.post("/sales/orders", (request) =>
    service.createSalesOrder(getContext(request), request.body),
  );
  app.post("/sales/orders/:id/submit", (request) =>
    service.submitSalesOrder(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/sales/invoices", (request) =>
    service.listSalesInvoices(getContext(request)),
  );
  app.post("/sales/invoices", (request) =>
    service.createSalesInvoice(getContext(request), request.body),
  );
  app.post("/sales/invoices/:id/submit", (request) =>
    service.submitSalesInvoice(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/buying/orders", (request) =>
    service.listPurchaseOrders(getContext(request)),
  );
  app.post("/buying/orders", (request) =>
    service.createPurchaseOrder(getContext(request), request.body),
  );
  app.post("/buying/orders/:id/submit", (request) =>
    service.submitPurchaseOrder(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );
  app.post("/buying/orders/:id/approve", (request) =>
    service.approvePurchaseOrder(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/buying/receipts", (request) =>
    service.listPurchaseReceipts(getContext(request)),
  );
  app.post("/buying/receipts", (request) =>
    service.createPurchaseReceipt(getContext(request), request.body),
  );
  app.post("/buying/receipts/:id/submit", (request) =>
    service.submitPurchaseReceipt(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/buying/invoices", (request) =>
    service.listPurchaseInvoices(getContext(request)),
  );
  app.post("/buying/invoices", (request) =>
    service.createPurchaseInvoice(getContext(request), request.body),
  );
  app.post("/buying/invoices/:id/submit", (request) =>
    service.submitPurchaseInvoice(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/accounting/payments", (request) =>
    service.listPayments(getContext(request)),
  );
  app.post("/accounting/payments", (request) =>
    service.createPayment(getContext(request), request.body),
  );
  app.post("/accounting/payments/:id/submit", (request) =>
    service.submitPayment(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/accounting/journal-entries", (request) =>
    service.listJournalEntries(getContext(request)),
  );
  app.post("/accounting/journal-entries", (request) =>
    service.createJournalEntry(getContext(request), request.body),
  );
  app.post("/accounting/journal-entries/:id/submit", (request) =>
    service.submitJournalEntry(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );

  app.get("/inventory/stock-entries", (request) =>
    service.listStockEntries(getContext(request)),
  );
  app.post("/inventory/stock-entries", (request) =>
    service.createStockEntry(getContext(request), request.body),
  );
  app.post("/inventory/stock-entries/:id/submit", (request) =>
    service.submitStockEntry(
      getContext(request),
      String((request.params as { id: string }).id),
    ),
  );
  app.get("/inventory/stock-balance", (request) =>
    service.stockBalance(getContext(request)),
  );
  app.get("/inventory/stock-ledger", (request) =>
    service.stockLedger(getContext(request)),
  );

  app.get("/projects", (request) => service.listProjects(getContext(request)));
  app.post("/projects", (request) =>
    service.createProject(getContext(request), request.body),
  );
  app.get("/projects/tasks", (request) =>
    service.listTasks(getContext(request)),
  );
  app.post("/projects/tasks", (request) =>
    service.createTask(getContext(request), request.body),
  );
  app.get("/projects/timesheets", (request) =>
    service.listTimesheets(getContext(request)),
  );
  app.post("/projects/timesheets", (request) =>
    service.createTimesheet(getContext(request), request.body),
  );

  app.get("/documents/:entityType/:id/comments", (request) => {
    const params = request.params as { entityType: string; id: string };
    return service.listComments(
      getContext(request),
      params.entityType,
      params.id,
    );
  });
  app.post("/documents/:entityType/:id/comments", (request) => {
    const params = request.params as { entityType: string; id: string };
    const body = request.body as { body: string };
    return service.addComment(
      getContext(request),
      params.entityType,
      params.id,
      body.body,
    );
  });
  app.get("/documents/:entityType/:id/attachments", (request) => {
    const params = request.params as { entityType: string; id: string };
    return service.listAttachments(
      getContext(request),
      params.entityType,
      params.id,
    );
  });
  app.post("/documents/:entityType/:id/attachments", (request) => {
    const params = request.params as { entityType: string; id: string };
    const body = request.body as { fileName: string; url: string };
    return service.addAttachment(
      getContext(request),
      params.entityType,
      params.id,
      body.fileName,
      body.url,
    );
  });

  app.get("/dashboards/summary", (request) =>
    service.dashboard(getContext(request)),
  );
  app.get("/search", (request) => {
    const query = String((request.query as { q?: string }).q ?? "");
    return service.search(getContext(request), query);
  });

  app.get("/reports/trial-balance", (request) =>
    service.trialBalance(getContext(request)),
  );
  app.get("/reports/profit-and-loss", (request) =>
    service.profitAndLoss(getContext(request)),
  );
  app.get("/reports/balance-sheet", (request) =>
    service.balanceSheet(getContext(request)),
  );
  app.get("/reports/aging", (request) => service.aging(getContext(request)));
  app.get("/reports/export/:collection", (request, reply) => {
    const collection = String(
      (request.params as { collection: string }).collection,
    );
    const csv = service.exportCollection(getContext(request), collection);
    reply.header("content-type", "text/csv; charset=utf-8");
    return csv;
  });
  app.get("/audit-logs", (request) => service.auditLogs(getContext(request)));

  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof DomainError || error instanceof ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    const statusCode =
      error instanceof DomainError
        ? error.statusCode
        : error instanceof ZodError
          ? 400
          : frameworkStatus;
    reply
      .status(statusCode)
      .send({
        error: known
          ? error.message
          : statusCode < 500
            ? "Invalid request"
            : "Operation could not be saved; no change was accepted",
        requestId: request.id,
      });
  });

  return app;
}
