import { z } from "zod";
import { DomainError } from "./errors.js";
import { sessionToken, tokenHash, verifyPassword } from "./security.js";
import { text, money, quantity, day, rounded, cents } from "./state-schema.js";
import type {
  ApprovalWorkflow,
  Attachment,
  Comment,
  Company,
  Customer,
  DocumentLine,
  DocumentStatus,
  DocumentType,
  GLEntry,
  Item,
  Lead,
  PaymentEntry,
  Project,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseReceipt,
  Quotation,
  RequestContext,
  Role,
  SalesInvoice,
  SalesOrder,
  StockEntry,
  StockLedgerEntry,
  Supplier,
  Task,
  Timesheet,
  User,
  Warehouse,
} from "./models.js";
import { ERPStore } from "./store.js";

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

const masterDataSchema = z
  .object({
    name: text,
    code: text.optional(),
    contactEmail: z.string().trim().email().max(254).optional(),
    billingAddress: text.optional(),
  })
  .strict();

const itemSchema = z
  .object({
    sku: text,
    name: text,
    description: text.optional(),
    uom: text,
    itemGroup: text,
    isStockItem: z.boolean().default(true),
    standardCost: money,
    salesPrice: money,
    purchasePrice: money,
  })
  .strict();

const warehouseSchema = z
  .object({
    name: text,
    code: text,
  })
  .strict();

const leadSchema = z
  .object({
    name: text,
    email: z.string().trim().email().max(254).optional(),
    companyName: text.optional(),
    source: text.optional(),
  })
  .strict();

const documentLineSchema = z
  .object({
    itemId: text,
    quantity: quantity,
    rate: money.optional(),
    warehouseId: text.optional(),
    description: text.optional(),
  })
  .strict();

const quotationSchema = z
  .object({
    customerId: text.optional(),
    leadId: text.optional(),
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const salesOrderSchema = z
  .object({
    customerId: text,
    quotationId: text.optional(),
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const salesInvoiceSchema = z
  .object({
    customerId: text,
    salesOrderId: text.optional(),
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const purchaseOrderSchema = z
  .object({
    supplierId: text,
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const purchaseReceiptSchema = z
  .object({
    supplierId: text,
    purchaseOrderId: text.optional(),
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const purchaseInvoiceSchema = z
  .object({
    supplierId: text,
    purchaseOrderId: text.optional(),
    currency: z.literal("USD").default("USD"),
    items: z.array(documentLineSchema).min(1).max(100),
  })
  .strict();

const paymentSchema = z
  .object({
    direction: z.enum(["inbound", "outbound"]),
    partyType: z.enum(["customer", "supplier"]),
    partyId: text,
    referenceType: z.enum(["sales_invoice", "purchase_invoice"]).optional(),
    referenceId: text.optional(),
    amount: money.refine((v) => v > 0),
    currency: z.literal("USD").default("USD"),
  })
  .strict();

const journalSchema = z
  .object({
    memo: text.optional(),
    lines: z
      .array(
        z.object({
          account: text,
          debit: money,
          credit: money,
        }),
      )
      .min(2)
      .max(100),
  })
  .strict();

const stockEntrySchema = z
  .object({
    entryType: z.enum(["transfer", "receipt", "issue"]),
    fromWarehouseId: text.optional(),
    toWarehouseId: text.optional(),
    itemId: text,
    quantity: quantity,
    valuationRate: money.optional(),
  })
  .strict();

const projectSchema = z
  .object({
    name: text,
    customerId: text.optional(),
    budgetHours: money.optional(),
  })
  .strict();

const taskSchema = z
  .object({
    projectId: text,
    title: text,
    status: z.enum(["open", "in_progress", "done"]).default("open"),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    assigneeUserId: text.optional(),
    dueDate: day.optional(),
  })
  .strict();

const timesheetSchema = z
  .object({
    projectId: text,
    taskId: text.optional(),
    userId: text,
    hours: z.number().positive().max(24),
    billable: z.boolean().default(true),
    note: text.optional(),
    workDate: day,
  })
  .strict();

export class ERPService {
  constructor(private readonly store: ERPStore) {}

  login(input: unknown) {
    const payload = loginSchema.parse(input);
    const user = this.store.state.users.find(
      (entry) => entry.email.toLowerCase() === payload.email.toLowerCase(),
    );
    const valid = verifyPassword(payload.password, user?.passwordHash);
    if (!valid || !user?.active)
      throw new DomainError("Invalid credentials", 401);
    const token = sessionToken();
    this.store.state.sessions = this.store.state.sessions.filter(
      (s) => s.expiresAt > this.store.now(),
    );
    if (this.store.state.sessions.length >= 1000)
      throw new DomainError(
        "Session capacity reached; retry after expiry",
        429,
      );
    this.store.state.sessions.push({
      tokenHash: tokenHash(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    return {
      token,
      user: this.serializeUser(user),
      companies: this.store.state.companies
        .filter((c) => user.companyIds.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name })),
    };
  }

  authenticate(token?: string, requestedCompanyId?: string): RequestContext {
    if (!token) throw new DomainError("Missing bearer token", 401);
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new DomainError("Invalid session", 401);
    const session = this.store.state.sessions.find(
      (s) => s.tokenHash === tokenHash(token) && s.expiresAt > this.store.now(),
    );
    const user =
      session &&
      this.store.state.users.find((u) => u.id === session.userId && u.active);
    if (!user) throw new DomainError("Invalid session", 401);
    return this.store.assertContextCompany(user, requestedCompanyId);
  }

  logout(token: string) {
    this.store.state.sessions = this.store.state.sessions.filter(
      (s) => s.tokenHash !== tokenHash(token),
    );
    return { ok: true };
  }

  references(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
      "auditor",
    ]);
    const has = (roles: Role[]) =>
      context.user.roles.some((r) =>
        ["system_admin", "company_admin", ...roles].includes(r),
      );
    const brief = (
      rows: Array<{ id: string; companyId: string; name: string }>,
    ) =>
      this.byCompany(rows, context.companyId).map(({ id, name }) => ({
        id,
        name,
      }));
    return {
      customers: has([
        "sales_user",
        "accounting_user",
        "project_user",
        "auditor",
      ])
        ? brief(this.store.state.customers)
        : [],
      projects: has(["project_user", "auditor"])
        ? brief(this.store.state.projects)
        : [],
      tasks: has(["project_user", "auditor"])
        ? this.byCompany(this.store.state.tasks, context.companyId).map(
            (t) => ({ id: t.id, name: t.title, projectId: t.projectId }),
          )
        : [],
      users: has(["project_user"])
        ? this.store.state.users
            .filter((u) => u.active && u.companyIds.includes(context.companyId))
            .map((u) => ({ id: u.id, name: u.name }))
        : [],
    };
  }

  listMe(context: RequestContext) {
    return {
      user: this.serializeUser(context.user),
      company: this.store.getCompany(context.companyId),
    };
  }

  listCompanies(context: RequestContext) {
    this.requireRoles(context, ["system_admin", "company_admin", "auditor"]);
    return this.store.state.companies.filter((entry) =>
      context.user.companyIds.includes(entry.id),
    );
  }

  createCompany(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["system_admin"]);
    const payload = z
      .object({
        name: text,
        currency: z.literal("USD").default("USD"),
        fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
        address: text.optional(),
        taxId: text.optional(),
      })
      .parse(input);

    const company = this.store.createCompanyRecord(
      payload.name,
      context.user.id,
      {
        currency: payload.currency,
        fiscalYearStartMonth: payload.fiscalYearStartMonth,
        address: payload.address,
        taxId: payload.taxId,
      },
    );

    this.store.state.companies.push(company);
    context.user.companyIds.push(company.id);
    this.log(context, "create", "company", company.id, { name: company.name });
    return company;
  }

  listCustomers(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "accounting_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.customers, context.companyId);
  }

  createCustomer(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const payload = masterDataSchema.parse(input);
    const customer: Customer = {
      ...this.store.base(context.companyId, context.user.id),
      name: payload.name,
      code: payload.code ?? `CUST-${this.store.id()}`,
      contactEmail: payload.contactEmail,
      billingAddress: payload.billingAddress,
      status: "active",
    };

    this.store.state.customers.push(customer);
    this.log(context, "create", "customer", customer.id, {
      code: customer.code,
    });
    return customer;
  }

  listSuppliers(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "accounting_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.suppliers, context.companyId);
  }

  createSupplier(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "purchase_user"]);
    const payload = masterDataSchema.parse(input);
    const supplier: Supplier = {
      ...this.store.base(context.companyId, context.user.id),
      name: payload.name,
      code: payload.code ?? `SUP-${this.store.id()}`,
      contactEmail: payload.contactEmail,
      billingAddress: payload.billingAddress,
      status: "active",
    };

    this.store.state.suppliers.push(supplier);
    this.log(context, "create", "supplier", supplier.id, {
      code: supplier.code,
    });
    return supplier;
  }

  listItems(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.items, context.companyId);
  }

  createItem(context: RequestContext, input: unknown) {
    this.requireRoles(context, [
      "company_admin",
      "inventory_user",
      "purchase_user",
    ]);
    const payload = itemSchema.parse(input);
    const item: Item = {
      ...this.store.base(context.companyId, context.user.id),
      ...payload,
    };

    this.store.state.items.push(item);
    this.log(context, "create", "item", item.id, { sku: item.sku });
    return item;
  }

  listWarehouses(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "inventory_user",
      "auditor",
      "sales_user",
      "purchase_user",
    ]);
    return this.byCompany(this.store.state.warehouses, context.companyId);
  }

  createWarehouse(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "inventory_user"]);
    const payload = warehouseSchema.parse(input);
    const warehouse: Warehouse = {
      ...this.store.base(context.companyId, context.user.id),
      ...payload,
    };

    this.store.state.warehouses.push(warehouse);
    this.log(context, "create", "warehouse", warehouse.id, {
      code: warehouse.code,
    });
    return warehouse;
  }

  listLeads(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "sales_user", "auditor"]);
    return this.byCompany(this.store.state.leads, context.companyId);
  }

  createLead(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const payload = leadSchema.parse(input);
    const lead: Lead = {
      ...this.store.base(context.companyId, context.user.id),
      ...payload,
      status: "open",
    };

    this.store.state.leads.push(lead);
    this.log(context, "create", "lead", lead.id);
    return lead;
  }

  listQuotations(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "sales_user", "auditor"]);
    return this.byCompany(this.store.state.quotations, context.companyId);
  }

  // ===== Sales: quotation -> sales order -> sales invoice =====
  createQuotation(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const payload = quotationSchema.parse(input);
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "sales");
    const quotation: Quotation = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "quotation",
      number: this.store.nextNumber(company, "quotation"),
      status: "draft",
      leadId: payload.leadId,
      customerId: payload.customerId,
      currency: payload.currency,
      items,
      total: this.sumLines(items),
      approvalState: "not_required",
    };

    this.store.state.quotations.push(quotation);
    this.log(context, "create", "quotation", quotation.id, {
      number: quotation.number,
    });
    return quotation;
  }

  submitQuotation(context: RequestContext, quotationId: string) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const quotation = this.findDocument(
      this.store.state.quotations,
      quotationId,
      context.companyId,
    );
    if (["submitted", "completed"].includes(quotation.status)) return quotation;
    this.ensureDraftLike(quotation.status);
    quotation.status = "submitted";
    quotation.updatedAt = this.store.now();
    quotation.version += 1;
    this.log(context, "submit", "quotation", quotation.id, {
      number: quotation.number,
    });
    return quotation;
  }

  convertQuotationToSalesOrder(context: RequestContext, quotationId: string) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const quotation = this.findDocument(
      this.store.state.quotations,
      quotationId,
      context.companyId,
    );
    const existing = this.store.state.salesOrders.find(
      (o) =>
        o.companyId === context.companyId && o.quotationId === quotation.id,
    );
    if (existing) return existing;
    if (!["draft", "submitted"].includes(quotation.status))
      throw new DomainError(
        "Quotation cannot be converted from its current status",
      );
    if (!quotation.customerId) {
      throw new DomainError("Quotation requires a customer before conversion");
    }

    if (quotation.status === "draft") {
      this.submitQuotation(context, quotationId);
    }

    const salesOrder = this.createSalesOrder(context, {
      customerId: quotation.customerId,
      quotationId: quotation.id,
      currency: quotation.currency,
      items: quotation.items.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        rate: line.rate,
        warehouseId: line.warehouseId,
        description: line.description,
      })),
    });

    quotation.status = "completed";
    quotation.updatedAt = this.store.now();
    quotation.version += 1;
    this.log(context, "convert", "quotation", quotation.id, {
      salesOrderId: salesOrder.id,
    });
    return salesOrder;
  }

  listSalesOrders(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "inventory_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.salesOrders, context.companyId);
  }

  createSalesOrder(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const payload = salesOrderSchema.parse(input);
    this.findRecord(
      this.store.state.customers,
      payload.customerId,
      context.companyId,
      "Customer",
    );
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "sales");
    this.checkLinkedDocument(
      context,
      payload.quotationId,
      "quotations",
      payload.customerId,
      items,
    );
    const salesOrder: SalesOrder = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "sales_order",
      number: this.store.nextNumber(company, "sales_order"),
      status: "draft",
      customerId: payload.customerId,
      quotationId: payload.quotationId,
      currency: payload.currency,
      items,
      total: this.sumLines(items),
      reservedQuantities: {},
    };

    this.store.state.salesOrders.push(salesOrder);
    this.log(context, "create", "sales_order", salesOrder.id, {
      number: salesOrder.number,
    });
    return salesOrder;
  }

  submitSalesOrder(context: RequestContext, salesOrderId: string) {
    this.requireRoles(context, ["company_admin", "sales_user"]);
    const salesOrder = this.findDocument(
      this.store.state.salesOrders,
      salesOrderId,
      context.companyId,
    );
    if (
      salesOrder.status === "submitted" ||
      salesOrder.status === "completed"
    ) {
      return salesOrder;
    }

    this.ensureDraftLike(salesOrder.status);
    salesOrder.status = "submitted";
    salesOrder.updatedAt = this.store.now();
    salesOrder.version += 1;
    salesOrder.reservedQuantities = {};

    for (const line of salesOrder.items) {
      if (!line.warehouseId) {
        continue;
      }

      const reserved = salesOrder.reservedQuantities[line.itemId] ?? 0;
      salesOrder.reservedQuantities[line.itemId] = reserved + line.quantity;
    }

    this.log(context, "submit", "sales_order", salesOrder.id, {
      number: salesOrder.number,
    });
    return salesOrder;
  }

  listSalesInvoices(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "accounting_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.salesInvoices, context.companyId);
  }

  createSalesInvoice(context: RequestContext, input: unknown) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "accounting_user",
    ]);
    const payload = salesInvoiceSchema.parse(input);
    this.findRecord(
      this.store.state.customers,
      payload.customerId,
      context.companyId,
      "Customer",
    );
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "sales");
    this.checkLinkedDocument(
      context,
      payload.salesOrderId,
      "salesOrders",
      payload.customerId,
      items,
    );
    const total = this.sumLines(items);
    const invoice: SalesInvoice = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "sales_invoice",
      number: this.store.nextNumber(company, "sales_invoice"),
      status: "draft",
      customerId: payload.customerId,
      salesOrderId: payload.salesOrderId,
      currency: payload.currency,
      items,
      total,
      outstandingAmount: total,
      paidAmount: 0,
    };

    this.store.state.salesInvoices.push(invoice);
    this.log(context, "create", "sales_invoice", invoice.id, {
      number: invoice.number,
    });
    return invoice;
  }

  submitSalesInvoice(context: RequestContext, invoiceId: string) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "accounting_user",
    ]);
    const invoice = this.findDocument(
      this.store.state.salesInvoices,
      invoiceId,
      context.companyId,
    );
    if (
      invoice.status === "submitted" ||
      invoice.status === "partially_paid" ||
      invoice.status === "paid"
    ) {
      return invoice;
    }

    this.checkLinkedDocument(
      context,
      invoice.salesOrderId,
      "salesOrders",
      invoice.customerId,
      invoice.items,
    );
    this.ensureDraftLike(invoice.status);
    invoice.status = "submitted";
    invoice.updatedAt = this.store.now();
    invoice.version += 1;

    const company = this.store.getCompany(context.companyId);
    this.postGL(context, invoice.documentType, invoice.id, [
      {
        account: company.defaultAccounts.accountsReceivable,
        debit: invoice.total,
        credit: 0,
        partyType: "customer",
        partyId: invoice.customerId,
      },
      {
        account: company.defaultAccounts.sales,
        debit: 0,
        credit: invoice.total,
      },
    ]);

    const inventoryCredit = invoice.items.reduce(
      (sum, line) =>
        sum +
        (line.isStockItem ? line.quantity * cents(line.standardCost) : 0) / 100,
      0,
    );
    if (inventoryCredit > 0) {
      this.postGL(context, invoice.documentType, invoice.id, [
        {
          account: company.defaultAccounts.costOfGoodsSold,
          debit: inventoryCredit,
          credit: 0,
        },
        {
          account: company.defaultAccounts.inventory,
          debit: 0,
          credit: inventoryCredit,
        },
      ]);
    }
    for (const line of invoice.items.filter((l) => l.isStockItem)) {
      if (!line.warehouseId)
        throw new DomainError("Stock invoice lines require warehouseId");
      this.postStock(context, invoice.documentType, invoice.id, {
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        quantityChange: -line.quantity,
        valueChange: (-line.quantity * cents(line.standardCost)) / 100,
      });
    }

    if (invoice.salesOrderId) {
      const order = this.findDocument(
        this.store.state.salesOrders,
        invoice.salesOrderId,
        context.companyId,
      );
      order.status = "completed";
      order.updatedAt = this.store.now();
      order.version += 1;
    }

    this.log(context, "submit", "sales_invoice", invoice.id, {
      number: invoice.number,
    });
    return invoice;
  }

  listPurchaseOrders(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "accounting_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.purchaseOrders, context.companyId);
  }

  // ===== Purchasing: purchase order -> receipt -> purchase invoice =====
  createPurchaseOrder(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "purchase_user"]);
    const payload = purchaseOrderSchema.parse(input);
    this.findRecord(
      this.store.state.suppliers,
      payload.supplierId,
      context.companyId,
      "Supplier",
    );
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "purchase");
    const total = this.sumLines(items);
    const workflow = this.findApprovalWorkflow(
      context.companyId,
      "purchase_order",
      total,
    );
    const purchaseOrder: PurchaseOrder = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "purchase_order",
      number: this.store.nextNumber(company, "purchase_order"),
      status: "draft",
      supplierId: payload.supplierId,
      currency: payload.currency,
      items,
      total,
      approvalState: workflow ? "pending" : "not_required",
    };

    this.store.state.purchaseOrders.push(purchaseOrder);
    this.log(context, "create", "purchase_order", purchaseOrder.id, {
      number: purchaseOrder.number,
    });
    return purchaseOrder;
  }

  submitPurchaseOrder(context: RequestContext, purchaseOrderId: string) {
    this.requireRoles(context, ["company_admin", "purchase_user"]);
    const purchaseOrder = this.findDocument(
      this.store.state.purchaseOrders,
      purchaseOrderId,
      context.companyId,
    );
    if (purchaseOrder.status === "submitted") {
      return purchaseOrder;
    }

    this.ensureDraftLike(purchaseOrder.status);
    const workflow = this.findApprovalWorkflow(
      context.companyId,
      "purchase_order",
      purchaseOrder.total,
    );
    if (workflow) {
      purchaseOrder.status = "pending_approval";
      purchaseOrder.approvalState = "pending";
    } else {
      purchaseOrder.status = "submitted";
      purchaseOrder.approvalState = "not_required";
    }

    purchaseOrder.updatedAt = this.store.now();
    purchaseOrder.version += 1;
    this.log(context, "submit", "purchase_order", purchaseOrder.id, {
      number: purchaseOrder.number,
      approvalState: purchaseOrder.approvalState,
    });
    return purchaseOrder;
  }

  approvePurchaseOrder(context: RequestContext, purchaseOrderId: string) {
    const purchaseOrder = this.findDocument(
      this.store.state.purchaseOrders,
      purchaseOrderId,
      context.companyId,
    );
    const workflow = this.findApprovalWorkflow(
      context.companyId,
      "purchase_order",
      purchaseOrder.total,
    );
    if (!workflow) {
      throw new DomainError("Approval is not required for this purchase order");
    }

    this.requireRoles(context, workflow.approverRoles);
    if (purchaseOrder.status !== "pending_approval") {
      throw new DomainError("Purchase order is not awaiting approval");
    }

    purchaseOrder.status = "submitted";
    purchaseOrder.approvalState = "approved";
    purchaseOrder.updatedAt = this.store.now();
    purchaseOrder.version += 1;
    this.log(context, "approve", "purchase_order", purchaseOrder.id, {
      number: purchaseOrder.number,
    });
    return purchaseOrder;
  }

  listPurchaseReceipts(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "inventory_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.purchaseReceipts, context.companyId);
  }

  createPurchaseReceipt(context: RequestContext, input: unknown) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "inventory_user",
    ]);
    const payload = purchaseReceiptSchema.parse(input);
    this.findRecord(
      this.store.state.suppliers,
      payload.supplierId,
      context.companyId,
      "Supplier",
    );
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "purchase");
    this.checkLinkedDocument(
      context,
      payload.purchaseOrderId,
      "purchaseOrders",
      payload.supplierId,
      items,
    );
    const receipt: PurchaseReceipt = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "purchase_receipt",
      number: this.store.nextNumber(company, "purchase_receipt"),
      status: "draft",
      supplierId: payload.supplierId,
      purchaseOrderId: payload.purchaseOrderId,
      currency: payload.currency,
      items,
      total: this.sumLines(items),
    };

    this.store.state.purchaseReceipts.push(receipt);
    this.log(context, "create", "purchase_receipt", receipt.id, {
      number: receipt.number,
    });
    return receipt;
  }

  submitPurchaseReceipt(context: RequestContext, purchaseReceiptId: string) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "inventory_user",
    ]);
    const receipt = this.findDocument(
      this.store.state.purchaseReceipts,
      purchaseReceiptId,
      context.companyId,
    );
    if (receipt.status === "submitted") {
      return receipt;
    }

    this.checkLinkedDocument(
      context,
      receipt.purchaseOrderId,
      "purchaseOrders",
      receipt.supplierId,
      receipt.items,
    );
    if (
      receipt.purchaseOrderId &&
      this.store.state.purchaseReceipts.some(
        (d) =>
          d.id !== receipt.id &&
          d.companyId === context.companyId &&
          d.purchaseOrderId === receipt.purchaseOrderId &&
          d.status !== "draft",
      )
    )
      throw new DomainError(
        "Linked order already posted for this document type",
        409,
      );
    this.ensureDraftLike(receipt.status);
    receipt.status = "submitted";
    receipt.updatedAt = this.store.now();
    receipt.version += 1;

    const company = this.store.getCompany(context.companyId);
    for (const line of receipt.items) {
      if (!line.isStockItem)
        throw new DomainError("Purchase receipts support stock items only");
      if (!line.warehouseId) {
        throw new DomainError("Purchase receipt lines require warehouseId");
      }

      const item = this.getItem(context.companyId, line.itemId);
      const value = (line.quantity * cents(line.rate)) / 100;
      this.postStock(context, receipt.documentType, receipt.id, {
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        quantityChange: line.quantity,
        valueChange: value,
      });
    }

    this.postGL(context, receipt.documentType, receipt.id, [
      {
        account: company.defaultAccounts.inventory,
        debit: receipt.total,
        credit: 0,
      },
      {
        account: company.defaultAccounts.goodsReceivedNotBilled,
        debit: 0,
        credit: receipt.total,
        partyType: "supplier",
        partyId: receipt.supplierId,
      },
    ]);

    this.log(context, "submit", "purchase_receipt", receipt.id, {
      number: receipt.number,
    });
    return receipt;
  }

  listPurchaseInvoices(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "accounting_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.purchaseInvoices, context.companyId);
  }

  createPurchaseInvoice(context: RequestContext, input: unknown) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "accounting_user",
    ]);
    const payload = purchaseInvoiceSchema.parse(input);
    this.findRecord(
      this.store.state.suppliers,
      payload.supplierId,
      context.companyId,
      "Supplier",
    );
    const company = this.store.getCompany(context.companyId);
    const items = this.buildDocumentLines(context, payload.items, "purchase");
    this.checkLinkedDocument(
      context,
      payload.purchaseOrderId,
      "purchaseOrders",
      payload.supplierId,
      items,
    );
    const total = this.sumLines(items);
    const invoice: PurchaseInvoice = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "purchase_invoice",
      number: this.store.nextNumber(company, "purchase_invoice"),
      status: "draft",
      supplierId: payload.supplierId,
      purchaseOrderId: payload.purchaseOrderId,
      currency: payload.currency,
      items,
      total,
      outstandingAmount: total,
      paidAmount: 0,
    };

    this.store.state.purchaseInvoices.push(invoice);
    this.log(context, "create", "purchase_invoice", invoice.id, {
      number: invoice.number,
    });
    return invoice;
  }

  submitPurchaseInvoice(context: RequestContext, invoiceId: string) {
    this.requireRoles(context, [
      "company_admin",
      "purchase_user",
      "accounting_user",
    ]);
    const invoice = this.findDocument(
      this.store.state.purchaseInvoices,
      invoiceId,
      context.companyId,
    );
    if (
      invoice.status === "submitted" ||
      invoice.status === "partially_paid" ||
      invoice.status === "paid"
    ) {
      return invoice;
    }

    this.checkLinkedDocument(
      context,
      invoice.purchaseOrderId,
      "purchaseOrders",
      invoice.supplierId,
      invoice.items,
    );
    if (
      invoice.purchaseOrderId &&
      this.store.state.purchaseInvoices.some(
        (d) =>
          d.id !== invoice.id &&
          d.companyId === context.companyId &&
          d.purchaseOrderId === invoice.purchaseOrderId &&
          d.status !== "draft",
      )
    )
      throw new DomainError(
        "Linked order already posted for this document type",
        409,
      );
    this.ensureDraftLike(invoice.status);
    invoice.status = "submitted";
    invoice.updatedAt = this.store.now();
    invoice.version += 1;

    const company = this.store.getCompany(context.companyId);
    this.postGL(context, invoice.documentType, invoice.id, [
      {
        account: company.defaultAccounts.goodsReceivedNotBilled,
        debit: invoice.total,
        credit: 0,
        partyType: "supplier",
        partyId: invoice.supplierId,
      },
      {
        account: company.defaultAccounts.accountsPayable,
        debit: 0,
        credit: invoice.total,
        partyType: "supplier",
        partyId: invoice.supplierId,
      },
    ]);

    this.log(context, "submit", "purchase_invoice", invoice.id, {
      number: invoice.number,
    });
    return invoice;
  }

  listPayments(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "accounting_user",
      "sales_user",
      "purchase_user",
      "auditor",
    ]);
    return this.byCompany(this.store.state.paymentEntries, context.companyId);
  }

  // ===== Accounting: payments and journal entries =====
  createPayment(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "accounting_user"]);
    const payload = paymentSchema.parse(input);
    const company = this.store.getCompany(context.companyId);
    const payment: PaymentEntry = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "payment_entry",
      number: this.store.nextNumber(company, "payment_entry"),
      status: "draft",
      direction: payload.direction,
      partyType: payload.partyType,
      partyId: payload.partyId,
      referenceType: payload.referenceType,
      referenceId: payload.referenceId,
      amount: payload.amount,
      currency: payload.currency,
    };

    this.validatePayment(context, payment);
    this.store.state.paymentEntries.push(payment);
    this.log(context, "create", "payment_entry", payment.id, {
      number: payment.number,
    });
    return payment;
  }

  submitPayment(context: RequestContext, paymentId: string) {
    this.requireRoles(context, ["company_admin", "accounting_user"]);
    const payment = this.findDocument(
      this.store.state.paymentEntries,
      paymentId,
      context.companyId,
    );
    if (payment.status === "submitted") {
      return payment;
    }

    this.validatePayment(context, payment);
    this.ensureDraftLike(payment.status);
    payment.status = "submitted";
    payment.updatedAt = this.store.now();
    payment.version += 1;

    const company = this.store.getCompany(context.companyId);
    this.postGL(
      context,
      payment.documentType,
      payment.id,
      this.paymentGL(company, payment),
    );
    this.applyPaymentToReference(context, payment);
    this.log(context, "submit", "payment_entry", payment.id, {
      number: payment.number,
    });
    return payment;
  }

  listJournalEntries(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "accounting_user", "auditor"]);
    return this.byCompany(this.store.state.journalEntries, context.companyId);
  }

  createJournalEntry(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "accounting_user"]);
    const payload = journalSchema.parse(input);
    const company = this.store.getCompany(context.companyId);
    const validAccounts = Object.values(company.defaultAccounts);
    if (
      payload.lines.some(
        (l) =>
          !validAccounts.includes(l.account) || l.debit > 0 === l.credit > 0,
      )
    )
      throw new DomainError(
        "Journal lines require a known account and exactly one positive side",
      );
    const totalDebit = payload.lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = payload.lines.reduce(
      (sum, line) => sum + line.credit,
      0,
    );
    if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
      throw new DomainError("Journal entry must balance");
    }

    const journalEntry = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "journal_entry" as const,
      number: this.store.nextNumber(company, "journal_entry"),
      status: "draft" as DocumentStatus,
      memo: payload.memo,
      lines: payload.lines,
    };

    this.store.state.journalEntries.push(journalEntry);
    this.log(context, "create", "journal_entry", journalEntry.id, {
      number: journalEntry.number,
    });
    return journalEntry;
  }

  submitJournalEntry(context: RequestContext, journalEntryId: string) {
    this.requireRoles(context, ["company_admin", "accounting_user"]);
    const journalEntry = this.findDocument(
      this.store.state.journalEntries,
      journalEntryId,
      context.companyId,
    );
    if (journalEntry.status === "submitted") {
      return journalEntry;
    }

    this.ensureDraftLike(journalEntry.status);
    journalEntry.status = "submitted";
    journalEntry.updatedAt = this.store.now();
    journalEntry.version += 1;
    this.postGL(
      context,
      journalEntry.documentType,
      journalEntry.id,
      journalEntry.lines.map((line) => ({
        account: line.account,
        debit: line.debit,
        credit: line.credit,
      })),
    );

    this.log(context, "submit", "journal_entry", journalEntry.id, {
      number: journalEntry.number,
    });
    return journalEntry;
  }

  listStockEntries(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "inventory_user", "auditor"]);
    return this.byCompany(this.store.state.stockEntries, context.companyId);
  }

  // ===== Stock: stock entries and balances =====
  createStockEntry(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "inventory_user"]);
    const payload = stockEntrySchema.parse(input);
    this.getItem(context.companyId, payload.itemId);
    const company = this.store.getCompany(context.companyId);
    const stockItem = this.getItem(context.companyId, payload.itemId);
    if (!stockItem.isStockItem)
      throw new DomainError("Stock entries require a stock item");
    if (
      payload.entryType === "transfer" &&
      (!payload.fromWarehouseId ||
        !payload.toWarehouseId ||
        payload.fromWarehouseId === payload.toWarehouseId)
    )
      throw new DomainError("Transfer requires two different warehouses");
    if (
      payload.entryType === "receipt" &&
      (!payload.toWarehouseId || payload.fromWarehouseId)
    )
      throw new DomainError("Receipt requires only a destination warehouse");
    if (
      payload.entryType === "issue" &&
      (!payload.fromWarehouseId || payload.toWarehouseId)
    )
      throw new DomainError("Issue requires only a source warehouse");
    const stockEntry: StockEntry = {
      ...this.store.base(context.companyId, context.user.id),
      documentType: "stock_entry",
      number: this.store.nextNumber(company, "stock_entry"),
      status: "draft",
      entryType: payload.entryType,
      fromWarehouseId: payload.fromWarehouseId,
      toWarehouseId: payload.toWarehouseId,
      itemId: payload.itemId,
      quantity: payload.quantity,
      valuationRate:
        payload.valuationRate ??
        this.getItem(context.companyId, payload.itemId).standardCost,
    };

    this.store.state.stockEntries.push(stockEntry);
    this.log(context, "create", "stock_entry", stockEntry.id, {
      number: stockEntry.number,
    });
    return stockEntry;
  }

  submitStockEntry(context: RequestContext, stockEntryId: string) {
    this.requireRoles(context, ["company_admin", "inventory_user"]);
    const stockEntry = this.findDocument(
      this.store.state.stockEntries,
      stockEntryId,
      context.companyId,
    );
    if (stockEntry.status === "submitted") {
      return stockEntry;
    }

    this.ensureDraftLike(stockEntry.status);
    const value = stockEntry.quantity * stockEntry.valuationRate;
    stockEntry.status = "submitted";
    stockEntry.updatedAt = this.store.now();
    stockEntry.version += 1;

    if (stockEntry.entryType === "transfer") {
      if (!stockEntry.fromWarehouseId || !stockEntry.toWarehouseId) {
        throw new DomainError(
          "Transfer requires fromWarehouseId and toWarehouseId",
        );
      }

      this.postStock(context, stockEntry.documentType, stockEntry.id, {
        itemId: stockEntry.itemId,
        warehouseId: stockEntry.fromWarehouseId,
        quantityChange: -stockEntry.quantity,
        valueChange: -value,
      });
      this.postStock(context, stockEntry.documentType, stockEntry.id, {
        itemId: stockEntry.itemId,
        warehouseId: stockEntry.toWarehouseId,
        quantityChange: stockEntry.quantity,
        valueChange: value,
      });
    } else if (stockEntry.entryType === "receipt") {
      if (!stockEntry.toWarehouseId) {
        throw new DomainError("Receipt requires toWarehouseId");
      }

      this.postStock(context, stockEntry.documentType, stockEntry.id, {
        itemId: stockEntry.itemId,
        warehouseId: stockEntry.toWarehouseId,
        quantityChange: stockEntry.quantity,
        valueChange: value,
      });
    } else if (stockEntry.entryType === "issue") {
      if (!stockEntry.fromWarehouseId) {
        throw new DomainError("Issue requires fromWarehouseId");
      }

      this.postStock(context, stockEntry.documentType, stockEntry.id, {
        itemId: stockEntry.itemId,
        warehouseId: stockEntry.fromWarehouseId,
        quantityChange: -stockEntry.quantity,
        valueChange: -value,
      });
    } else {
      if (!stockEntry.toWarehouseId) {
        throw new DomainError(
          "Reconciliation or manufacturing requires toWarehouseId",
        );
      }

      this.postStock(context, stockEntry.documentType, stockEntry.id, {
        itemId: stockEntry.itemId,
        warehouseId: stockEntry.toWarehouseId,
        quantityChange: stockEntry.quantity,
        valueChange: value,
      });
    }

    this.log(context, "submit", "stock_entry", stockEntry.id, {
      number: stockEntry.number,
    });
    return stockEntry;
  }

  listProjects(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "project_user", "auditor"]);
    return this.byCompany(this.store.state.projects, context.companyId);
  }

  createProject(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "project_user"]);
    const payload = projectSchema.parse(input);
    const project: Project = {
      ...this.store.base(context.companyId, context.user.id),
      name: payload.name,
      customerId: payload.customerId,
      status: "open",
      budgetHours: payload.budgetHours,
    };

    this.store.state.projects.push(project);
    this.log(context, "create", "project", project.id);
    return project;
  }

  listTasks(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "project_user", "auditor"]);
    return this.byCompany(this.store.state.tasks, context.companyId);
  }

  createTask(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "project_user"]);
    const payload = taskSchema.parse(input);
    this.findRecord(
      this.store.state.projects,
      payload.projectId,
      context.companyId,
      "Project",
    );
    const task: Task = {
      ...this.store.base(context.companyId, context.user.id),
      ...payload,
    };

    this.store.state.tasks.push(task);
    this.log(context, "create", "task", task.id);
    return task;
  }

  listTimesheets(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "project_user", "auditor"]);
    return this.byCompany(this.store.state.timesheets, context.companyId);
  }

  createTimesheet(context: RequestContext, input: unknown) {
    this.requireRoles(context, ["company_admin", "project_user"]);
    const payload = timesheetSchema.parse(input);
    this.findRecord(
      this.store.state.projects,
      payload.projectId,
      context.companyId,
      "Project",
    );
    const timesheet: Timesheet = {
      ...this.store.base(context.companyId, context.user.id),
      ...payload,
    };

    this.store.state.timesheets.push(timesheet);
    this.log(context, "create", "timesheet", timesheet.id);
    return timesheet;
  }

  listComments(context: RequestContext, entityType: string, entityId: string) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
      "auditor",
    ]);
    this.ensureEntityBelongsToCompany(entityType, entityId, context.companyId);
    this.requireEntityRead(context, entityType);
    return this.byCompany(this.store.state.comments, context.companyId).filter(
      (entry) => entry.entityType === entityType && entry.entityId === entityId,
    );
  }

  addComment(
    context: RequestContext,
    entityType: string,
    entityId: string,
    body: string,
  ) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
    ]);
    this.ensureEntityBelongsToCompany(entityType, entityId, context.companyId);
    this.requireEntityRead(context, entityType);
    const comment: Comment = {
      ...this.store.base(context.companyId, context.user.id),
      entityType,
      entityId,
      body: text.parse(body),
    };

    this.store.state.comments.push(comment);
    this.log(context, "comment", entityType, entityId);
    return comment;
  }

  listAttachments(
    context: RequestContext,
    entityType: string,
    entityId: string,
  ) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
      "auditor",
    ]);
    this.ensureEntityBelongsToCompany(entityType, entityId, context.companyId);
    this.requireEntityRead(context, entityType);
    return this.byCompany(
      this.store.state.attachments,
      context.companyId,
    ).filter(
      (entry) => entry.entityType === entityType && entry.entityId === entityId,
    );
  }

  addAttachment(
    context: RequestContext,
    entityType: string,
    entityId: string,
    fileName: string,
    url: string,
  ) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
    ]);
    this.ensureEntityBelongsToCompany(entityType, entityId, context.companyId);
    this.requireEntityRead(context, entityType);
    const attachment: Attachment = {
      ...this.store.base(context.companyId, context.user.id),
      entityType,
      entityId,
      fileName: text.max(200).parse(fileName),
      url: z
        .string()
        .url()
        .max(2000)
        .refine((value) => {
          const u = new URL(value);
          return u.protocol === "https:" && !u.username && !u.password;
        })
        .parse(url),
    };

    this.store.state.attachments.push(attachment);
    this.log(context, "attach", entityType, entityId, { fileName });
    return attachment;
  }

  dashboard(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "auditor"]);
    const salesInvoices = this.byCompany(
      this.store.state.salesInvoices,
      context.companyId,
    ).filter((d) => ["submitted", "partially_paid", "paid"].includes(d.status));
    const purchaseInvoices = this.byCompany(
      this.store.state.purchaseInvoices,
      context.companyId,
    ).filter((d) => ["submitted", "partially_paid", "paid"].includes(d.status));
    const projects = this.byCompany(
      this.store.state.projects,
      context.companyId,
    );

    return {
      openLeads: this.byCompany(
        this.store.state.leads,
        context.companyId,
      ).filter((entry) => entry.status === "open").length,
      draftQuotations: this.byCompany(
        this.store.state.quotations,
        context.companyId,
      ).filter((entry) => entry.status === "draft").length,
      pendingPurchaseApprovals: this.byCompany(
        this.store.state.purchaseOrders,
        context.companyId,
      ).filter((entry) => entry.status === "pending_approval").length,
      receivablesOutstanding: salesInvoices.reduce(
        (sum, entry) => sum + entry.outstandingAmount,
        0,
      ),
      payablesOutstanding: purchaseInvoices.reduce(
        (sum, entry) => sum + entry.outstandingAmount,
        0,
      ),
      stockValue: this.stockBalance(context).reduce(
        (sum, entry) => sum + entry.stockValue,
        0,
      ),
      activeProjects: projects.filter((entry) => entry.status === "open")
        .length,
      totalTimesheetHours: this.byCompany(
        this.store.state.timesheets,
        context.companyId,
      ).reduce((sum, entry) => sum + entry.hours, 0),
    };
  }

  search(context: RequestContext, query: string) {
    this.requireRoles(context, [
      "company_admin",
      "sales_user",
      "purchase_user",
      "inventory_user",
      "accounting_user",
      "project_user",
      "auditor",
    ]);
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }

    const sources = [
      ...this.byCompany(this.store.state.customers, context.companyId).map(
        (entry) => ({
          type: "customer",
          id: entry.id,
          label: `${entry.code} ${entry.name}`,
        }),
      ),
      ...this.byCompany(this.store.state.suppliers, context.companyId).map(
        (entry) => ({
          type: "supplier",
          id: entry.id,
          label: `${entry.code} ${entry.name}`,
        }),
      ),
      ...this.byCompany(this.store.state.items, context.companyId).map(
        (entry) => ({
          type: "item",
          id: entry.id,
          label: `${entry.sku} ${entry.name}`,
        }),
      ),
      ...this.byCompany(this.store.state.quotations, context.companyId).map(
        (entry) => ({
          type: "quotation",
          id: entry.id,
          label: `${entry.number}`,
        }),
      ),
      ...this.byCompany(this.store.state.salesOrders, context.companyId).map(
        (entry) => ({
          type: "sales_order",
          id: entry.id,
          label: `${entry.number}`,
        }),
      ),
      ...this.byCompany(this.store.state.salesInvoices, context.companyId).map(
        (entry) => ({
          type: "sales_invoice",
          id: entry.id,
          label: `${entry.number}`,
        }),
      ),
      ...this.byCompany(this.store.state.purchaseOrders, context.companyId).map(
        (entry) => ({
          type: "purchase_order",
          id: entry.id,
          label: `${entry.number}`,
        }),
      ),
      ...this.byCompany(this.store.state.projects, context.companyId).map(
        (entry) => ({
          type: "project",
          id: entry.id,
          label: `${entry.name}`,
        }),
      ),
    ];

    return sources
      .filter(
        (entry) =>
          this.canReadEntity(context, entry.type) &&
          entry.label.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }

  stockBalance(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "inventory_user",
      "purchase_user",
      "sales_user",
      "auditor",
    ]);
    const ledgerEntries = this.byCompany(
      this.store.state.stockLedgerEntries,
      context.companyId,
    );
    const aggregates = new Map<
      string,
      {
        itemId: string;
        warehouseId: string;
        quantity: number;
        stockValue: number;
      }
    >();

    for (const entry of ledgerEntries) {
      const key = `${entry.itemId}:${entry.warehouseId}`;
      const current = aggregates.get(key) ?? {
        itemId: entry.itemId,
        warehouseId: entry.warehouseId,
        quantity: 0,
        stockValue: 0,
      };
      current.quantity += entry.quantityChange;
      current.stockValue = rounded(current.stockValue + entry.valueChange);
      aggregates.set(key, current);
    }

    return Array.from(aggregates.values()).map((entry) => ({
      ...entry,
      availableQuantity:
        entry.quantity -
        this.reservedQuantity(
          context.companyId,
          entry.itemId,
          entry.warehouseId,
        ),
    }));
  }

  stockLedger(context: RequestContext) {
    this.requireRoles(context, [
      "company_admin",
      "inventory_user",
      "purchase_user",
      "sales_user",
      "auditor",
    ]);
    return this.byCompany(
      this.store.state.stockLedgerEntries,
      context.companyId,
    );
  }

  trialBalance(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "accounting_user", "auditor"]);
    const balances = new Map<
      string,
      { account: string; debit: number; credit: number; balance: number }
    >();
    for (const entry of this.byCompany(
      this.store.state.glEntries,
      context.companyId,
    )) {
      const current = balances.get(entry.account) ?? {
        account: entry.account,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      current.debit = rounded(current.debit + entry.debit);
      current.credit = rounded(current.credit + entry.credit);
      current.balance = rounded(current.balance + entry.debit - entry.credit);
      balances.set(entry.account, current);
    }

    return Array.from(balances.values());
  }

  profitAndLoss(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "accounting_user", "auditor"]);
    const ledger = this.byCompany(
      this.store.state.glEntries,
      context.companyId,
    );
    let income = 0;
    let expenses = 0;

    for (const entry of ledger) {
      const bucket = this.accountCategory(entry.account);
      if (bucket === "income") {
        income = rounded(income + entry.credit - entry.debit);
      }
      if (bucket === "expense") {
        expenses = rounded(expenses + entry.debit - entry.credit);
      }
    }

    return {
      income,
      expenses,
      netProfit: rounded(income - expenses),
    };
  }

  balanceSheet(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "accounting_user", "auditor"]);
    const ledger = this.byCompany(
      this.store.state.glEntries,
      context.companyId,
    );
    let assets = 0;
    let liabilities = 0;
    let equity = 0;

    for (const entry of ledger) {
      const bucket = this.accountCategory(entry.account);
      if (bucket === "asset") {
        assets = rounded(assets + entry.debit - entry.credit);
      }
      if (bucket === "liability") {
        liabilities = rounded(liabilities + entry.credit - entry.debit);
      }
      if (bucket === "equity") {
        equity = rounded(equity + entry.credit - entry.debit);
      }
    }

    const pnl = this.profitAndLoss(context);
    return {
      assets,
      liabilities,
      equity: rounded(equity + pnl.netProfit),
    };
  }

  aging(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "accounting_user", "auditor"]);
    const now = new Date();
    const bucketFor = (isoDate: string) => {
      const ageInDays = Math.floor(
        (now.getTime() - new Date(isoDate).getTime()) / 86_400_000,
      );
      if (ageInDays <= 30) {
        return "0-30";
      }
      if (ageInDays <= 60) {
        return "31-60";
      }
      if (ageInDays <= 90) {
        return "61-90";
      }
      return "90+";
    };

    const receivables = this.byCompany(
      this.store.state.salesInvoices,
      context.companyId,
    )
      .filter(
        (entry) =>
          ["submitted", "partially_paid"].includes(entry.status) &&
          entry.outstandingAmount > 0,
      )
      .map((entry) => ({
        type: "receivable",
        documentNumber: entry.number,
        amount: entry.outstandingAmount,
        bucket: bucketFor(entry.createdAt),
      }));

    const payables = this.byCompany(
      this.store.state.purchaseInvoices,
      context.companyId,
    )
      .filter(
        (entry) =>
          ["submitted", "partially_paid"].includes(entry.status) &&
          entry.outstandingAmount > 0,
      )
      .map((entry) => ({
        type: "payable",
        documentNumber: entry.number,
        amount: entry.outstandingAmount,
        bucket: bucketFor(entry.createdAt),
      }));

    return {
      receivables,
      payables,
    };
  }

  exportCollection(context: RequestContext, collection: string) {
    const rows = this.getCollectionRows(context, collection);
    if (rows.length === 0) {
      return "";
    }

    const headers = Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );

    return [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((header) => this.csvCell(row[header])).join(","),
      ),
    ].join("\n");
  }

  auditLogs(context: RequestContext) {
    this.requireRoles(context, ["company_admin", "auditor"]);
    return this.byCompany(this.store.state.auditLogs, context.companyId);
  }

  private checkLinkedDocument(
    context: RequestContext,
    linkedId: string | undefined,
    collection: "quotations" | "salesOrders" | "purchaseOrders",
    partyId: string,
    items: DocumentLine[],
  ) {
    if (!linkedId) return;
    const linked = this.findDocument(
      this.store.state[collection] as Array<
        Quotation | SalesOrder | PurchaseOrder
      >,
      linkedId,
      context.companyId,
    );
    const linkedParty =
      "customerId" in linked
        ? linked.customerId
        : "supplierId" in linked
          ? linked.supplierId
          : undefined;
    if (linkedParty !== partyId || linked.status !== "submitted")
      throw new DomainError(
        "Linked document must be submitted for the same party",
      );
    const signature = (lines: DocumentLine[]) =>
      JSON.stringify(
        lines
          .map((l) => [
            l.itemId,
            l.warehouseId ?? "",
            l.quantity,
            cents(l.rate),
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
    if (signature(items) !== signature(linked.items))
      throw new DomainError(
        "Linked document requires the complete matching item quantities and rates",
      );
  }

  private validatePayment(context: RequestContext, payment: PaymentEntry) {
    const sales = payment.direction === "inbound";
    if (
      payment.partyType !== (sales ? "customer" : "supplier") ||
      payment.referenceType !==
        (sales ? "sales_invoice" : "purchase_invoice") ||
      !payment.referenceId
    )
      throw new DomainError(
        "Payments require a matching party, direction, and invoice reference",
      );
    const invoice = this.findDocument(
      (sales
        ? this.store.state.salesInvoices
        : this.store.state.purchaseInvoices) as Array<
        SalesInvoice | PurchaseInvoice
      >,
      payment.referenceId,
      context.companyId,
    );
    const party =
      "customerId" in invoice ? invoice.customerId : invoice.supplierId;
    if (
      party !== payment.partyId ||
      invoice.currency !== payment.currency ||
      !["submitted", "partially_paid"].includes(invoice.status)
    )
      throw new DomainError(
        "Payment reference must be a posted unpaid invoice for the same party and currency",
      );
    if (cents(payment.amount) > cents(invoice.outstandingAmount))
      throw new DomainError("Payment exceeds outstanding balance", 409);
  }

  private canReadEntity(context: RequestContext, type: string) {
    const policy: Record<string, Role[]> = {
      customer: ["sales_user", "accounting_user"],
      supplier: ["purchase_user", "accounting_user"],
      item: ["sales_user", "purchase_user", "inventory_user"],
      quotation: ["sales_user"],
      sales_order: ["sales_user", "inventory_user"],
      sales_invoice: ["sales_user", "accounting_user"],
      purchase_order: ["purchase_user", "accounting_user"],
      purchase_receipt: ["purchase_user", "inventory_user", "accounting_user"],
      purchase_invoice: ["purchase_user", "accounting_user"],
      project: ["project_user"],
      task: ["project_user"],
    };
    return (
      Object.hasOwn(policy, type) &&
      context.user.roles.some((r) =>
        ["system_admin", "company_admin", "auditor", ...policy[type]].includes(
          r,
        ),
      )
    );
  }
  private requireEntityRead(context: RequestContext, type: string) {
    if (!this.canReadEntity(context, type))
      throw new DomainError("Forbidden entity access", 403);
  }

  editMaster(
    context: RequestContext,
    collection: string,
    recordId: string,
    input: unknown,
    remove = false,
  ) {
    const policies: Record<
      string,
      { roles: Role[]; schema: z.ZodTypeAny; type: string }
    > = {
      customers: {
        roles: ["sales_user"],
        schema: masterDataSchema.extend({
          status: z.enum(["active", "inactive"]),
        }),
        type: "customer",
      },
      suppliers: {
        roles: ["purchase_user"],
        schema: masterDataSchema.extend({
          status: z.enum(["active", "inactive"]),
        }),
        type: "supplier",
      },
      items: {
        roles: ["inventory_user", "purchase_user"],
        schema: itemSchema,
        type: "item",
      },
      warehouses: {
        roles: ["inventory_user"],
        schema: warehouseSchema,
        type: "warehouse",
      },
      leads: {
        roles: ["sales_user"],
        schema: leadSchema.extend({
          status: z.enum(["open", "qualified", "converted", "lost"]),
        }),
        type: "lead",
      },
      projects: {
        roles: ["project_user"],
        schema: projectSchema.extend({
          status: z.enum(["open", "completed", "cancelled"]),
        }),
        type: "project",
      },
      tasks: { roles: ["project_user"], schema: taskSchema, type: "task" },
      timesheets: {
        roles: ["project_user"],
        schema: timesheetSchema,
        type: "timesheet",
      },
    };
    if (!Object.hasOwn(policies, collection))
      throw new DomainError("Unknown CRUD collection", 404);
    const policy = policies[collection];
    this.requireRoles(context, ["company_admin", ...policy.roles]);
    const envelope = z
      .object({
        version: z.number().int().positive(),
        data: z.unknown().optional(),
      })
      .strict()
      .parse(input);
    const rows = this.store.state[
      collection as keyof typeof this.store.state
    ] as unknown as Array<
      Record<string, any> & { id: string; companyId: string }
    >;
    const record = this.findRecord(
      rows,
      recordId,
      context.companyId,
      policy.type,
    );
    if (record.version !== envelope.version)
      throw new DomainError(
        "Record changed; reload current data before retrying",
        409,
      );
    if (remove) {
      if (
        this.store.state.comments.some(
          (c) => c.entityType === policy.type && c.entityId === recordId,
        ) ||
        this.store.state.attachments.some(
          (c) => c.entityType === policy.type && c.entityId === recordId,
        )
      )
        throw new DomainError("Record has discussion history; retain it", 409);
      rows.splice(rows.indexOf(record), 1);
    } else {
      const payload = policy.schema.parse(envelope.data);
      if (
        collection === "items" &&
        payload.isStockItem !== record.isStockItem &&
        this.store.state.stockLedgerEntries.some((l) => l.itemId === recordId)
      )
        throw new DomainError(
          "Stock classification cannot change after ledger history",
          409,
        );
      for (const key of Object.keys(record))
        if (
          ![
            "id",
            "companyId",
            "createdAt",
            "updatedAt",
            "createdBy",
            "version",
          ].includes(key)
        )
          delete record[key];
      Object.assign(record, payload, {
        updatedAt: this.store.now(),
        version: record.version + 1,
      });
      if (
        (collection === "customers" || collection === "suppliers") &&
        !record.code
      )
        throw new DomainError("Existing party code is required");
    }
    this.log(context, remove ? "delete" : "update", policy.type, recordId, {
      previousVersion: envelope.version,
    });
    return remove ? { deleted: true, id: recordId } : record;
  }

  private getCollectionRows(context: RequestContext, collection: string) {
    switch (collection) {
      case "customers":
        return this.listCustomers(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "suppliers":
        return this.listSuppliers(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "items":
        return this.listItems(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "quotations":
        return this.listQuotations(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "sales_orders":
        return this.listSalesOrders(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "sales_invoices":
        return this.listSalesInvoices(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "purchase_orders":
        return this.listPurchaseOrders(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "purchase_receipts":
        return this.listPurchaseReceipts(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "purchase_invoices":
        return this.listPurchaseInvoices(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "projects":
        return this.listProjects(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "tasks":
        return this.listTasks(context) as unknown as Array<
          Record<string, unknown>
        >;
      case "timesheets":
        return this.listTimesheets(context) as unknown as Array<
          Record<string, unknown>
        >;
      default:
        throw new DomainError("Unknown export collection");
    }
  }

  private csvCell(value: unknown) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const safe = /^[\s]*[=+@-]/.test(text ?? "") ? "'" + text : text;
    const escaped = (safe ?? "").replaceAll('"', '""');
    return `"${escaped}"`;
  }

  private applyPaymentToReference(
    context: RequestContext,
    payment: PaymentEntry,
  ) {
    if (!payment.referenceType || !payment.referenceId) {
      return;
    }

    if (payment.referenceType === "sales_invoice") {
      const invoice = this.findDocument(
        this.store.state.salesInvoices,
        payment.referenceId,
        context.companyId,
      );
      invoice.paidAmount =
        (cents(invoice.paidAmount) + cents(payment.amount)) / 100;
      invoice.outstandingAmount =
        (cents(invoice.total) - cents(invoice.paidAmount)) / 100;
      invoice.updatedAt = this.store.now();
      invoice.version += 1;
      invoice.status =
        invoice.outstandingAmount === 0 ? "paid" : "partially_paid";
      return;
    }

    const invoice = this.findDocument(
      this.store.state.purchaseInvoices,
      payment.referenceId,
      context.companyId,
    );
    invoice.paidAmount =
      (cents(invoice.paidAmount) + cents(payment.amount)) / 100;
    invoice.outstandingAmount =
      (cents(invoice.total) - cents(invoice.paidAmount)) / 100;
    invoice.updatedAt = this.store.now();
    invoice.version += 1;
    invoice.status =
      invoice.outstandingAmount === 0 ? "paid" : "partially_paid";
  }

  private paymentGL(company: Company, payment: PaymentEntry) {
    if (payment.direction === "inbound") {
      return [
        {
          account: company.defaultAccounts.cash,
          debit: payment.amount,
          credit: 0,
        },
        {
          account: company.defaultAccounts.accountsReceivable,
          debit: 0,
          credit: payment.amount,
          partyType: "customer" as const,
          partyId: payment.partyId,
        },
      ];
    }

    return [
      {
        account: company.defaultAccounts.accountsPayable,
        debit: payment.amount,
        credit: 0,
        partyType: "supplier" as const,
        partyId: payment.partyId,
      },
      {
        account: company.defaultAccounts.cash,
        debit: 0,
        credit: payment.amount,
      },
    ];
  }

  private buildDocumentLines(
    context: RequestContext,
    inputLines: Array<z.infer<typeof documentLineSchema>>,
    mode: "sales" | "purchase",
  ): DocumentLine[] {
    return inputLines.map((line) => {
      const item = this.getItem(context.companyId, line.itemId);
      if (line.warehouseId) {
        this.findRecord(
          this.store.state.warehouses,
          line.warehouseId,
          context.companyId,
          "Warehouse",
        );
      }

      const rate =
        line.rate ?? (mode === "sales" ? item.salesPrice : item.purchasePrice);
      return {
        id: this.store.id(),
        itemId: line.itemId,
        standardCost: item.standardCost,
        isStockItem: item.isStockItem,
        description: line.description ?? item.name,
        quantity: line.quantity,
        rate,
        amount: (cents(rate) * line.quantity) / 100,
        warehouseId: line.warehouseId,
      };
    });
  }

  private sumLines(items: DocumentLine[]) {
    return items.reduce((sum, line) => sum + cents(line.amount), 0) / 100;
  }

  private findApprovalWorkflow(
    companyId: string,
    documentType: DocumentType,
    total: number,
  ): ApprovalWorkflow | undefined {
    return this.byCompany(this.store.state.approvalWorkflows, companyId).find(
      (entry) =>
        entry.documentType === documentType && total >= entry.minAmount,
    );
  }

  private ensureEntityBelongsToCompany(
    entityType: string,
    entityId: string,
    companyId: string,
  ) {
    const collections: Record<
      string,
      Array<{ id: string; companyId: string }>
    > = {
      quotation: this.store.state.quotations,
      sales_order: this.store.state.salesOrders,
      sales_invoice: this.store.state.salesInvoices,
      purchase_order: this.store.state.purchaseOrders,
      purchase_invoice: this.store.state.purchaseInvoices,
      purchase_receipt: this.store.state.purchaseReceipts,
      project: this.store.state.projects,
      task: this.store.state.tasks,
      customer: this.store.state.customers,
      supplier: this.store.state.suppliers,
      item: this.store.state.items,
    };

    const collection = Object.hasOwn(collections, entityType)
      ? collections[entityType]
      : undefined;
    if (!collection) {
      throw new DomainError("Entity type not supported");
    }

    this.findRecord(collection, entityId, companyId, "Entity");
  }

  private postStock(
    context: RequestContext,
    voucherType: DocumentType,
    voucherId: string,
    entry: {
      itemId: string;
      warehouseId: string;
      quantityChange: number;
      valueChange: number;
    },
  ) {
    const stockLedgerEntry: StockLedgerEntry = {
      ...this.store.base(context.companyId, context.user.id),
      voucherType,
      voucherId,
      itemId: entry.itemId,
      warehouseId: entry.warehouseId,
      quantityChange: entry.quantityChange,
      valueChange: entry.valueChange,
    };

    this.store.state.stockLedgerEntries.push(stockLedgerEntry);
    return stockLedgerEntry;
  }

  private postGL(
    context: RequestContext,
    voucherType: DocumentType,
    voucherId: string,
    lines: Array<{
      account: string;
      debit: number;
      credit: number;
      partyType?: "customer" | "supplier";
      partyId?: string;
    }>,
  ) {
    for (const line of lines) {
      const glEntry: GLEntry = {
        ...this.store.base(context.companyId, context.user.id),
        voucherType,
        voucherId,
        account: line.account,
        debit: line.debit,
        credit: line.credit,
        partyType: line.partyType,
        partyId: line.partyId,
      };

      this.store.state.glEntries.push(glEntry);
    }
  }

  private requireRoles(context: RequestContext, roles: Role[]) {
    if (
      !context.user.roles.includes("system_admin") &&
      !context.user.roles.some((role) => roles.includes(role))
    ) {
      throw new DomainError("Forbidden", 403);
    }
  }

  private log(
    context: RequestContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ) {
    this.store.state.auditLogs.push({
      id: this.store.id(),
      companyId: context.companyId,
      actorUserId: context.user.id,
      action,
      entityType,
      entityId,
      createdAt: this.store.now(),
      metadata,
    });
  }

  private ensureDraftLike(status: DocumentStatus) {
    if (!["draft", "approved", "pending_approval"].includes(status)) {
      throw new DomainError(
        `Document cannot be submitted from status ${status}`,
      );
    }
  }

  private findRecord<T extends { id: string; companyId: string }>(
    collection: T[],
    id: string,
    companyId: string,
    label: string,
  ) {
    const record = collection.find(
      (entry) => entry.id === id && entry.companyId === companyId,
    );
    if (!record) {
      throw new DomainError(`${label} not found`, 404);
    }

    return record;
  }

  private findDocument<
    T extends { id: string; companyId: string; status: DocumentStatus },
  >(collection: T[], id: string, companyId: string) {
    return this.findRecord(collection, id, companyId, "Document");
  }

  private byCompany<T extends { companyId: string }>(
    collection: T[],
    companyId: string,
  ) {
    return collection.filter((entry) => entry.companyId === companyId);
  }

  private serializeUser(user: User) {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  private getItem(companyId: string, itemId: string) {
    return this.findRecord(this.store.state.items, itemId, companyId, "Item");
  }

  private reservedQuantity(
    companyId: string,
    itemId: string,
    warehouseId: string,
  ) {
    return this.byCompany(this.store.state.salesOrders, companyId)
      .filter((entry) => entry.status === "submitted")
      .reduce((sum, entry) => {
        const reserved = entry.items
          .filter(
            (line) =>
              line.itemId === itemId && line.warehouseId === warehouseId,
          )
          .reduce((qty, line) => qty + line.quantity, 0);
        return sum + reserved;
      }, 0);
  }

  private accountCategory(account: string) {
    const chart: Record<string, string> = {
      "Accounts Receivable": "asset",
      Bank: "asset",
      "Inventory Asset": "asset",
      "Accounts Payable": "liability",
      "Goods Received Not Billed": "liability",
      "Retained Earnings": "equity",
      "Sales Revenue": "income",
      "Cost of Goods Sold": "expense",
    };
    if (!Object.hasOwn(chart, account))
      throw new DomainError("Unknown account");
    return chart[account];
  }
}
