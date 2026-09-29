export type Role =
  | "system_admin"
  | "company_admin"
  | "sales_user"
  | "purchase_user"
  | "inventory_user"
  | "accounting_user"
  | "project_user"
  | "manufacturing_user"
  | "auditor"
  | "portal_customer"
  | "portal_supplier";

export type DocumentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "submitted"
  | "partially_paid"
  | "paid"
  | "completed"
  | "cancelled";

export type PaymentDirection = "inbound" | "outbound";

export type StockEntryType =
  | "transfer"
  | "receipt"
  | "issue"
  | "reconciliation"
  | "manufacturing";

export type DocumentType =
  | "quotation"
  | "sales_order"
  | "sales_invoice"
  | "purchase_order"
  | "purchase_receipt"
  | "purchase_invoice"
  | "payment_entry"
  | "journal_entry"
  | "stock_entry";

export interface AuditFields {
  version: number;
  id: string;
  companyId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface Company extends AuditFields {
  name: string;
  currency: string;
  fiscalYearStartMonth: number;
  taxId?: string;
  address?: string;
  numberingPrefixes: Record<DocumentType, string>;
  numberingCounters: Record<DocumentType, number>;
  defaultAccounts: {
    accountsReceivable: string;
    accountsPayable: string;
    cash: string;
    sales: string;
    costOfGoodsSold: string;
    inventory: string;
    goodsReceivedNotBilled: string;
    retainedEarnings: string;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  companyIds: string[];
  passwordHash: string;
  active: boolean;
}

export interface Session {
  tokenHash: string;
  expiresAt: string;
  userId: string;
}

export interface Customer extends AuditFields {
  name: string;
  code: string;
  contactEmail?: string;
  billingAddress?: string;
  status: "active" | "inactive";
}

export interface Supplier extends AuditFields {
  name: string;
  code: string;
  contactEmail?: string;
  billingAddress?: string;
  status: "active" | "inactive";
}

export interface Item extends AuditFields {
  sku: string;
  name: string;
  description?: string;
  uom: string;
  itemGroup: string;
  isStockItem: boolean;
  standardCost: number;
  salesPrice: number;
  purchasePrice: number;
}

export interface Warehouse extends AuditFields {
  name: string;
  code: string;
}

export interface Lead extends AuditFields {
  name: string;
  email?: string;
  companyName?: string;
  source?: string;
  status: "open" | "qualified" | "converted" | "lost";
}

export interface DocumentLine {
  standardCost: number;
  isStockItem: boolean;
  id: string;
  itemId: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  warehouseId?: string;
}

export interface Quotation extends AuditFields {
  documentType: "quotation";
  number: string;
  status: DocumentStatus;
  leadId?: string;
  customerId?: string;
  currency: string;
  items: DocumentLine[];
  total: number;
  approvalState?: "not_required" | "pending" | "approved";
}

export interface SalesOrder extends AuditFields {
  documentType: "sales_order";
  number: string;
  status: DocumentStatus;
  customerId: string;
  quotationId?: string;
  currency: string;
  items: DocumentLine[];
  total: number;
  reservedQuantities: Record<string, number>;
}

export interface SalesInvoice extends AuditFields {
  documentType: "sales_invoice";
  number: string;
  status: DocumentStatus;
  customerId: string;
  salesOrderId?: string;
  currency: string;
  items: DocumentLine[];
  total: number;
  outstandingAmount: number;
  paidAmount: number;
}

export interface PurchaseOrder extends AuditFields {
  documentType: "purchase_order";
  number: string;
  status: DocumentStatus;
  supplierId: string;
  currency: string;
  items: DocumentLine[];
  total: number;
  approvalState: "not_required" | "pending" | "approved";
}

export interface PurchaseReceipt extends AuditFields {
  documentType: "purchase_receipt";
  number: string;
  status: DocumentStatus;
  supplierId: string;
  purchaseOrderId?: string;
  currency: string;
  items: DocumentLine[];
  total: number;
}

export interface PurchaseInvoice extends AuditFields {
  documentType: "purchase_invoice";
  number: string;
  status: DocumentStatus;
  supplierId: string;
  purchaseOrderId?: string;
  currency: string;
  items: DocumentLine[];
  total: number;
  outstandingAmount: number;
  paidAmount: number;
}

export interface PaymentEntry extends AuditFields {
  documentType: "payment_entry";
  number: string;
  status: DocumentStatus;
  direction: PaymentDirection;
  partyType: "customer" | "supplier";
  partyId: string;
  referenceType?: "sales_invoice" | "purchase_invoice";
  referenceId?: string;
  amount: number;
  currency: string;
}

export interface JournalEntry extends AuditFields {
  documentType: "journal_entry";
  number: string;
  status: DocumentStatus;
  memo?: string;
  lines: Array<{
    account: string;
    debit: number;
    credit: number;
  }>;
}

export interface StockEntry extends AuditFields {
  documentType: "stock_entry";
  number: string;
  status: DocumentStatus;
  entryType: StockEntryType;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  itemId: string;
  quantity: number;
  valuationRate: number;
}

export interface StockLedgerEntry extends AuditFields {
  voucherType: DocumentType;
  voucherId: string;
  itemId: string;
  warehouseId: string;
  quantityChange: number;
  valueChange: number;
}

export interface GLEntry extends AuditFields {
  voucherType: DocumentType;
  voucherId: string;
  account: string;
  debit: number;
  credit: number;
  partyType?: "customer" | "supplier";
  partyId?: string;
}

export interface Project extends AuditFields {
  name: string;
  customerId?: string;
  status: "open" | "completed" | "cancelled";
  budgetHours?: number;
}

export interface Task extends AuditFields {
  projectId: string;
  title: string;
  status: "open" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  assigneeUserId?: string;
  dueDate?: string;
}

export interface Timesheet extends AuditFields {
  projectId: string;
  taskId?: string;
  userId: string;
  hours: number;
  billable: boolean;
  note?: string;
  workDate: string;
}

export interface ApprovalWorkflow extends AuditFields {
  documentType: DocumentType;
  minAmount: number;
  approverRoles: Role[];
}

export interface Comment extends AuditFields {
  entityType: string;
  entityId: string;
  body: string;
}

export interface Attachment extends AuditFields {
  entityType: string;
  entityId: string;
  fileName: string;
  url: string;
}

export interface AuditLog {
  id: string;
  companyId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ERPState {
  companies: Company[];
  users: User[];
  sessions: Session[];
  customers: Customer[];
  suppliers: Supplier[];
  items: Item[];
  warehouses: Warehouse[];
  leads: Lead[];
  quotations: Quotation[];
  salesOrders: SalesOrder[];
  salesInvoices: SalesInvoice[];
  purchaseOrders: PurchaseOrder[];
  purchaseReceipts: PurchaseReceipt[];
  purchaseInvoices: PurchaseInvoice[];
  paymentEntries: PaymentEntry[];
  journalEntries: JournalEntry[];
  stockEntries: StockEntry[];
  stockLedgerEntries: StockLedgerEntry[];
  glEntries: GLEntry[];
  projects: Project[];
  tasks: Task[];
  timesheets: Timesheet[];
  approvalWorkflows: ApprovalWorkflow[];
  comments: Comment[];
  attachments: Attachment[];
  auditLogs: AuditLog[];
}

export interface RequestContext {
  user: User;
  companyId: string;
}
