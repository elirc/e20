import { z } from "zod";
import type { ERPState } from "./models.js";
import { DomainError } from "./errors.js";
export const text = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/);
export const id = z.string().uuid();
export const money = z
  .number()
  .finite()
  .min(0)
  .max(10_000_000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001,
    "Use at most two decimal places",
  );
export const quantity = z.number().int().min(1).max(100_000);
export const cents = (v: number) => Math.round(v * 100);
export const rounded = (v: number) => Math.round(v * 100) / 100;
const amount = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000_000)
  .refine(
    (v) =>
      Number.isSafeInteger(cents(v)) && Math.abs(v * 100 - cents(v)) < 0.01,
  );
const date = z.string().datetime();
export const day = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Use a real date in 2000-2099");
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const roles = z.enum([
  "system_admin",
  "company_admin",
  "sales_user",
  "purchase_user",
  "inventory_user",
  "accounting_user",
  "project_user",
  "manufacturing_user",
  "auditor",
  "portal_customer",
  "portal_supplier",
]);
const base = {
  id,
  version,
  companyId: id,
  createdAt: date,
  updatedAt: date,
  createdBy: id,
};
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const docs = z.enum([
  "quotation",
  "sales_order",
  "sales_invoice",
  "purchase_order",
  "purchase_receipt",
  "purchase_invoice",
  "payment_entry",
  "journal_entry",
  "stock_entry",
]);
const docMap = <T extends z.ZodTypeAny>(value: T) =>
  object({
    quotation: value,
    sales_order: value,
    sales_invoice: value,
    purchase_order: value,
    purchase_receipt: value,
    purchase_invoice: value,
    payment_entry: value,
    journal_entry: value,
    stock_entry: value,
  });
const accounts = object({
  accountsReceivable: text,
  accountsPayable: text,
  cash: text,
  sales: text,
  costOfGoodsSold: text,
  inventory: text,
  goodsReceivedNotBilled: text,
  retainedEarnings: text,
});
const line = object({
  id,
  itemId: id,
  description: text,
  quantity,
  rate: money,
  amount,
  warehouseId: id.optional(),
  standardCost: money,
  isStockItem: z.boolean(),
});
const status = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "submitted",
  "partially_paid",
  "paid",
  "completed",
  "cancelled",
]);
const document = {
  ...base,
  number: text,
  status,
  currency: z.literal("USD"),
  items: z.array(line).min(1).max(100),
  total: amount,
};
const party = {
  ...base,
  name: text,
  code: text,
  contactEmail: z.string().email().max(254).optional(),
  billingAddress: text.optional(),
  status: z.enum(["active", "inactive"]),
};
const invoice = { ...document, outstandingAmount: amount, paidAmount: amount };
const schemas = {
  companies: object({
    ...base,
    name: text,
    currency: z.literal("USD"),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    taxId: text.optional(),
    address: text.optional(),
    numberingPrefixes: docMap(text),
    numberingCounters: docMap(z.number().int().min(0).max(1_000_000_000)),
    defaultAccounts: accounts,
  }),
  users: object({
    id,
    email: z.string().email().max(254),
    name: text,
    roles: z.array(roles).min(1).max(12),
    companyIds: z.array(id).min(1).max(100),
    passwordHash: z.string().regex(/^[a-f0-9]{32}:[a-f0-9]{128}$/),
    active: z.boolean(),
  }),
  sessions: object({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    userId: id,
    expiresAt: date,
  }),
  customers: object(party),
  suppliers: object(party),
  items: object({
    ...base,
    sku: text,
    name: text,
    description: text.optional(),
    uom: text,
    itemGroup: text,
    isStockItem: z.boolean(),
    standardCost: money,
    salesPrice: money,
    purchasePrice: money,
  }),
  warehouses: object({ ...base, name: text, code: text }),
  leads: object({
    ...base,
    name: text,
    email: z.string().email().max(254).optional(),
    companyName: text.optional(),
    source: text.optional(),
    status: z.enum(["open", "qualified", "converted", "lost"]),
  }),
  quotations: object({
    ...document,
    documentType: z.literal("quotation"),
    leadId: id.optional(),
    customerId: id.optional(),
    approvalState: z.enum(["not_required", "pending", "approved"]).optional(),
  }),
  salesOrders: object({
    ...document,
    documentType: z.literal("sales_order"),
    customerId: id,
    quotationId: id.optional(),
    reservedQuantities: z.record(
      id,
      z.number().int().nonnegative().max(10_000_000),
    ),
  }),
  salesInvoices: object({
    ...invoice,
    documentType: z.literal("sales_invoice"),
    customerId: id,
    salesOrderId: id.optional(),
  }),
  purchaseOrders: object({
    ...document,
    documentType: z.literal("purchase_order"),
    supplierId: id,
    approvalState: z.enum(["not_required", "pending", "approved"]),
  }),
  purchaseReceipts: object({
    ...document,
    documentType: z.literal("purchase_receipt"),
    supplierId: id,
    purchaseOrderId: id.optional(),
  }),
  purchaseInvoices: object({
    ...invoice,
    documentType: z.literal("purchase_invoice"),
    supplierId: id,
    purchaseOrderId: id.optional(),
  }),
  paymentEntries: object({
    ...base,
    documentType: z.literal("payment_entry"),
    number: text,
    status,
    direction: z.enum(["inbound", "outbound"]),
    partyType: z.enum(["customer", "supplier"]),
    partyId: id,
    referenceType: z.enum(["sales_invoice", "purchase_invoice"]).optional(),
    referenceId: id.optional(),
    amount: money,
    currency: z.literal("USD"),
  }),
  journalEntries: object({
    ...base,
    documentType: z.literal("journal_entry"),
    number: text,
    status,
    memo: text.optional(),
    lines: z
      .array(object({ account: text, debit: money, credit: money }))
      .min(2)
      .max(100),
  }),
  stockEntries: object({
    ...base,
    documentType: z.literal("stock_entry"),
    number: text,
    status,
    entryType: z.enum(["transfer", "receipt", "issue"]),
    fromWarehouseId: id.optional(),
    toWarehouseId: id.optional(),
    itemId: id,
    quantity,
    valuationRate: money,
  }),
  stockLedgerEntries: object({
    ...base,
    voucherType: docs,
    voucherId: id,
    itemId: id,
    warehouseId: id,
    quantityChange: z.number().int().min(-100_000).max(100_000),
    valueChange: z.number().finite().min(-1e12).max(1e12),
  }),
  glEntries: object({
    ...base,
    voucherType: docs,
    voucherId: id,
    account: text,
    debit: amount,
    credit: amount,
    partyType: z.enum(["customer", "supplier"]).optional(),
    partyId: id.optional(),
  }),
  projects: object({
    ...base,
    name: text,
    customerId: id.optional(),
    status: z.enum(["open", "completed", "cancelled"]),
    budgetHours: z.number().nonnegative().max(1e6).optional(),
  }),
  tasks: object({
    ...base,
    projectId: id,
    title: text,
    status: z.enum(["open", "in_progress", "done"]),
    priority: z.enum(["low", "medium", "high"]),
    assigneeUserId: id.optional(),
    dueDate: day.optional(),
  }),
  timesheets: object({
    ...base,
    projectId: id,
    taskId: id.optional(),
    userId: id,
    hours: z.number().positive().max(24),
    billable: z.boolean(),
    note: text.optional(),
    workDate: day,
  }),
  approvalWorkflows: object({
    ...base,
    documentType: docs,
    minAmount: money,
    approverRoles: z.array(roles).min(1).max(12),
  }),
  comments: object({ ...base, entityType: text, entityId: id, body: text }),
  attachments: object({
    ...base,
    entityType: text,
    entityId: id,
    fileName: text,
    url: z
      .string()
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      }),
  }),
  auditLogs: object({
    id,
    companyId: id,
    actorUserId: id,
    action: text,
    entityType: text,
    entityId: id,
    createdAt: date,
    metadata: z.record(z.unknown()).optional(),
  }),
};
const stateSchema = object(
  Object.fromEntries(
    Object.entries(schemas).map(([key, schema]) => [
      key,
      z.array(schema).max(key === "sessions" ? 1000 : 10_000),
    ]),
  ),
);
export const MAX_BYTES = 20 * 1024 * 1024;
export function validateState(value: unknown): ERPState {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_BYTES)
    throw new DomainError("Workspace reached its 20 MiB limit");
  const state = stateSchema.parse(value) as unknown as ERPState;
  const collections = state as unknown as Record<
    string,
    Array<Record<string, any>>
  >;
  const exists = (key: string, id: string, companyId?: string) =>
    collections[key]?.some(
      (r) => r.id === id && (!companyId || r.companyId === companyId),
    );
  const check = (condition: unknown, message: string) => {
    if (!condition) throw new DomainError(message);
  };
  const refs: Record<string, string> = {
    customerId: "customers",
    supplierId: "suppliers",
    itemId: "items",
    warehouseId: "warehouses",
    fromWarehouseId: "warehouses",
    toWarehouseId: "warehouses",
    quotationId: "quotations",
    salesOrderId: "salesOrders",
    purchaseOrderId: "purchaseOrders",
    projectId: "projects",
    taskId: "tasks",
    leadId: "leads",
  };
  for (const [key, records] of Object.entries(collections)) {
    const ids = new Set<string>();
    for (const r of records) {
      const identity = r.id ?? r.tokenHash;
      check(!ids.has(identity), "Duplicate record identity");
      ids.add(identity);
      if (r.companyId)
        check(exists("companies", r.companyId), "Company reference not found");
      if (r.createdBy)
        check(exists("users", r.createdBy), "Creator reference not found");
      if (r.actorUserId)
        check(exists("users", r.actorUserId), "Audit actor not found");
      for (const [field, target] of Object.entries(refs))
        if (r[field])
          check(
            exists(target, r[field], r.companyId),
            `${field} reference not found in company`,
          );
      for (const field of ["userId", "assigneeUserId"])
        if (r[field])
          check(
            state.users.some(
              (u) =>
                u.id === r[field] &&
                (!r.companyId || u.companyIds.includes(r.companyId)),
            ),
            "User reference not found in company",
          );
      if (r.companyIds)
        for (const companyId of r.companyIds)
          check(exists("companies", companyId), "Membership company not found");
      if (r.taskId)
        check(
          state.tasks.find((t) => t.id === r.taskId)?.projectId === r.projectId,
          "Task belongs to another project",
        );
      if (r.items) {
        const lineIds = new Set<string>();
        for (const l of r.items) {
          check(!lineIds.has(l.id), "Duplicate line identity");
          lineIds.add(l.id);
          check(
            exists("items", l.itemId, r.companyId),
            "Line item not found in company",
          );
          if (l.warehouseId)
            check(
              exists("warehouses", l.warehouseId, r.companyId),
              "Line warehouse not found in company",
            );
          check(
            cents(l.amount) === cents(l.rate) * l.quantity,
            "Line amount mismatch",
          );
        }
        check(
          cents(r.total) ===
            r.items.reduce((sum: number, l: any) => sum + cents(l.amount), 0),
          "Document total mismatch",
        );
      }
      if (r.outstandingAmount !== undefined)
        check(
          cents(r.outstandingAmount) + cents(r.paidAmount) === cents(r.total),
          "Invoice balance mismatch",
        );
      if (r.partyId)
        check(
          exists(
            r.partyType === "customer" ? "customers" : "suppliers",
            r.partyId,
            r.companyId,
          ),
          "Party reference not found in company",
        );
    }
  }
  for (const [key, field] of [
    ["customers", "code"],
    ["suppliers", "code"],
    ["items", "sku"],
    ["warehouses", "code"],
    ["users", "email"],
  ]) {
    const values = new Set<string>();
    for (const r of collections[key]) {
      const identity = `${r.companyId ?? ""}:${r[field].toLowerCase()}`;
      check(!values.has(identity), `${field} must be unique`);
      values.add(identity);
    }
  }
  const vouchers: Record<string, string> = {
    quotation: "quotations",
    sales_order: "salesOrders",
    sales_invoice: "salesInvoices",
    purchase_order: "purchaseOrders",
    purchase_receipt: "purchaseReceipts",
    purchase_invoice: "purchaseInvoices",
    payment_entry: "paymentEntries",
    journal_entry: "journalEntries",
    stock_entry: "stockEntries",
  };
  const entities: Record<string, string> = {
    ...vouchers,
    customer: "customers",
    supplier: "suppliers",
    item: "items",
    project: "projects",
    task: "tasks",
  };
  for (const r of [...state.stockLedgerEntries, ...state.glEntries]) {
    const collection = collections[vouchers[r.voucherType]];
    const voucher = collection.find(
      (d) => d.id === r.voucherId && d.companyId === r.companyId,
    );
    check(
      voucher &&
        ["submitted", "partially_paid", "paid", "completed"].includes(
          voucher.status,
        ),
      "Ledger voucher must exist and be posted",
    );
  }
  for (const r of [...state.comments, ...state.attachments])
    check(
      Object.hasOwn(entities, r.entityType) &&
        exists(entities[r.entityType], r.entityId, r.companyId),
      "Discussion entity not found in company",
    );
  for (const p of state.paymentEntries) {
    const sales = p.direction === "inbound";
    check(
      p.partyType === (sales ? "customer" : "supplier") &&
        p.referenceType === (sales ? "sales_invoice" : "purchase_invoice") &&
        p.referenceId,
      "Payment direction and reference mismatch",
    );
    const invoice = collections[
      sales ? "salesInvoices" : "purchaseInvoices"
    ].find((i) => i.id === p.referenceId && i.companyId === p.companyId);
    check(
      invoice &&
        invoice[sales ? "customerId" : "supplierId"] === p.partyId &&
        invoice.currency === p.currency,
      "Payment invoice mismatch",
    );
  }
  const converted = new Set<string>();
  for (const order of state.salesOrders.filter((o) => o.quotationId)) {
    check(!converted.has(order.quotationId!), "Quotation already has an order");
    converted.add(order.quotationId!);
  }
  for (const r of [
    ...state.salesOrders,
    ...state.salesInvoices,
    ...state.purchaseReceipts,
    ...state.purchaseInvoices,
  ]) {
    const row = r as unknown as Record<string, any>;
    for (const [field, collection, party] of [
      ["quotationId", "quotations", "customerId"],
      ["salesOrderId", "salesOrders", "customerId"],
      ["purchaseOrderId", "purchaseOrders", "supplierId"],
    ])
      if (row[field]) {
        const parent = collections[collection].find(
          (p) => p.id === row[field] && p.companyId === r.companyId,
        );
        check(
          parent && parent[party] === row[party],
          "Linked document party mismatch",
        );
      }
  }
  const stock = new Map<string, number>();
  const keyFor = (r: any) => `${r.companyId}:${r.itemId}:${r.warehouseId}`;
  for (const r of state.stockLedgerEntries)
    stock.set(keyFor(r), (stock.get(keyFor(r)) ?? 0) + r.quantityChange);
  for (const r of state.salesOrders.filter((o) => o.status === "submitted"))
    for (const l of r.items.filter((l) => l.isStockItem)) {
      check(l.warehouseId, "Stock item requires warehouse");
      const key = keyFor({ ...l, companyId: r.companyId });
      stock.set(key, (stock.get(key) ?? 0) - l.quantity);
    }
  for (const available of stock.values())
    check(available >= 0, "Insufficient available stock; transaction rejected");
  const balances = new Map<string, number>();
  for (const r of state.glEntries) {
    const key = `${r.companyId}:${r.voucherType}:${r.voucherId}`;
    balances.set(
      key,
      (balances.get(key) ?? 0) + cents(r.debit) - cents(r.credit),
    );
  }
  for (const balance of balances.values())
    check(balance === 0, "Unbalanced ledger voucher");
  return state;
}
