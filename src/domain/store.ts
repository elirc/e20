import { hashPassword } from "./security.js";
import { DomainError } from "./errors.js";
import { SnapshotDatabase } from "./database.js";
import { v4 as uuid } from "uuid";
import type {
  ApprovalWorkflow,
  Company,
  Customer,
  ERPState,
  Item,
  RequestContext,
  Role,
  Session,
  Supplier,
  User,
  Warehouse,
} from "./models.js";

const defaultPrefixes = {
  quotation: "QTN-",
  sales_order: "SO-",
  sales_invoice: "SINV-",
  purchase_order: "PO-",
  purchase_receipt: "PREC-",
  purchase_invoice: "PINV-",
  payment_entry: "PAY-",
  journal_entry: "JV-",
  stock_entry: "STE-",
} as const;

export class ERPStore {
  private working?: ERPState;
  private readonly database: SnapshotDatabase;
  get state(): ERPState {
    if (!this.working) throw new Error("State access requires a transaction");
    return this.working;
  }
  private set state(value: ERPState) {
    this.working = value;
  }

  constructor(options: {
    databasePath: string;
    seedPasswords?: Record<string, string>;
  }) {
    this.database = new SnapshotDatabase(
      options.databasePath,
      !!options.seedPasswords,
    );
    if (this.database.initialized) return;
    if (!options.seedPasswords) {
      this.database.close();
      throw new Error("Database requires explicit setup; run npm run setup");
    }
    this.state = {
      companies: [],
      users: [],
      sessions: [],
      customers: [],
      suppliers: [],
      items: [],
      warehouses: [],
      leads: [],
      quotations: [],
      salesOrders: [],
      salesInvoices: [],
      purchaseOrders: [],
      purchaseReceipts: [],
      purchaseInvoices: [],
      paymentEntries: [],
      journalEntries: [],
      stockEntries: [],
      stockLedgerEntries: [],
      glEntries: [],
      projects: [],
      tasks: [],
      timesheets: [],
      approvalWorkflows: [],
      comments: [],
      attachments: [],
      auditLogs: [],
    };

    try {
      this.bootstrap(options.seedPasswords);
      this.database.initialize(this.state);
    } catch (error) {
      this.database.close();
      throw error;
    }
    this.working = undefined;
  }

  access<T>(write: boolean, operation: () => T): T {
    if (this.working) throw new Error("Nested state access is unsupported");
    return this.database.access(write, (state) => {
      this.working = state;
      try {
        const result = operation();
        if (
          result &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          throw new Error("Transactions require synchronous operations");
        }
        return structuredClone(result);
      } finally {
        this.working = undefined;
      }
    });
  }

  close() {
    this.database.close();
  }

  now() {
    return new Date().toISOString();
  }

  id() {
    return uuid();
  }

  base(companyId: string, createdBy: string) {
    const timestamp = this.now();
    return {
      id: this.id(),
      version: 1,
      companyId,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };
  }

  nextNumber(
    company: Company,
    documentType: keyof Company["numberingPrefixes"],
  ) {
    company.numberingCounters[documentType] += 1;
    const prefix = company.numberingPrefixes[documentType];
    const sequence = String(company.numberingCounters[documentType]).padStart(
      5,
      "0",
    );
    return `${prefix}${sequence}`;
  }

  getCompany(companyId: string) {
    const company = this.state.companies.find(
      (entry) => entry.id === companyId,
    );
    if (!company) {
      throw new DomainError("Company not found", 404);
    }

    return company;
  }

  assertContextCompany(
    user: User,
    requestedCompanyId?: string,
  ): RequestContext {
    const companyId = requestedCompanyId;
    if (!companyId || !user.companyIds.includes(companyId)) {
      throw new DomainError(
        "Forbidden company scope; select an explicit company",
        403,
      );
    }

    return { user, companyId };
  }

  createCompanyRecord(
    name: string,
    createdBy: string,
    overrides?: Partial<Company>,
  ): Company {
    const companyId = this.id();
    return {
      ...this.base(companyId, createdBy),
      name,
      currency: "USD",
      fiscalYearStartMonth: 1,
      numberingPrefixes: { ...defaultPrefixes },
      numberingCounters: {
        quotation: 0,
        sales_order: 0,
        sales_invoice: 0,
        purchase_order: 0,
        purchase_receipt: 0,
        purchase_invoice: 0,
        payment_entry: 0,
        journal_entry: 0,
        stock_entry: 0,
      },
      defaultAccounts: {
        accountsReceivable: "Accounts Receivable",
        accountsPayable: "Accounts Payable",
        cash: "Bank",
        sales: "Sales Revenue",
        costOfGoodsSold: "Cost of Goods Sold",
        inventory: "Inventory Asset",
        goodsReceivedNotBilled: "Goods Received Not Billed",
        retainedEarnings: "Retained Earnings",
      },
      ...overrides,
      id: companyId,
      companyId,
    } as Company;
  }

  private bootstrap(passwords: Record<string, string>) {
    const systemUserId = this.id();
    const companyId = this.id();
    const timestamp = this.now();

    const company: Company = {
      id: companyId,
      version: 1,
      companyId,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: systemUserId,
      name: "Acme Manufacturing",
      currency: "USD",
      fiscalYearStartMonth: 1,
      address: "100 Market Street",
      taxId: "US-ACME-001",
      numberingPrefixes: { ...defaultPrefixes },
      numberingCounters: {
        quotation: 0,
        sales_order: 0,
        sales_invoice: 0,
        purchase_order: 0,
        purchase_receipt: 0,
        purchase_invoice: 0,
        payment_entry: 0,
        journal_entry: 0,
        stock_entry: 0,
      },
      defaultAccounts: {
        accountsReceivable: "Accounts Receivable",
        accountsPayable: "Accounts Payable",
        cash: "Bank",
        sales: "Sales Revenue",
        costOfGoodsSold: "Cost of Goods Sold",
        inventory: "Inventory Asset",
        goodsReceivedNotBilled: "Goods Received Not Billed",
        retainedEarnings: "Retained Earnings",
      },
    };

    const users: User[] = [
      {
        id: systemUserId,
        email: "system@erp.local",
        name: "System Admin",
        roles: ["system_admin"],
        companyIds: [companyId],
        passwordHash: "",
        active: true,
      },
      this.demoUser(companyId, "admin@acme.local", "Company Admin", [
        "company_admin",
        "accounting_user",
      ]),
      this.demoUser(companyId, "sales@acme.local", "Sales User", [
        "sales_user",
      ]),
      this.demoUser(companyId, "purchase@acme.local", "Purchase User", [
        "purchase_user",
      ]),
      this.demoUser(companyId, "inventory@acme.local", "Inventory User", [
        "inventory_user",
      ]),
      this.demoUser(companyId, "accounts@acme.local", "Accounting User", [
        "accounting_user",
      ]),
      this.demoUser(companyId, "projects@acme.local", "Project User", [
        "project_user",
      ]),
      this.demoUser(companyId, "audit@acme.local", "Auditor", ["auditor"]),
    ];

    for (const user of users) {
      if (!Object.hasOwn(passwords, user.email))
        throw new Error("Missing setup credential");
      user.passwordHash = hashPassword(passwords[user.email]);
    }
    const sessions: Session[] = [];

    const customer: Customer = {
      ...this.base(companyId, users[1].id),
      name: "Northwind Retail",
      code: "CUST-001",
      contactEmail: "ap@northwind.local",
      billingAddress: "200 Pine Street",
      status: "active",
    };

    const supplier: Supplier = {
      ...this.base(companyId, users[1].id),
      name: "Steel Supplies Co",
      code: "SUP-001",
      contactEmail: "sales@steelsupplies.local",
      billingAddress: "300 Dock Road",
      status: "active",
    };

    const item: Item = {
      ...this.base(companyId, users[1].id),
      sku: "FG-100",
      name: "Finished Widget",
      description: "Core saleable widget",
      uom: "Nos",
      itemGroup: "Finished Goods",
      isStockItem: true,
      standardCost: 35,
      salesPrice: 75,
      purchasePrice: 30,
    };

    const warehouse: Warehouse = {
      ...this.base(companyId, users[1].id),
      name: "Main Warehouse",
      code: "WH-001",
    };

    const approvalWorkflow: ApprovalWorkflow = {
      ...this.base(companyId, users[1].id),
      documentType: "purchase_order",
      minAmount: 1000,
      approverRoles: ["company_admin", "accounting_user"],
    };

    this.state.companies.push(company);
    this.state.users.push(...users);
    this.state.sessions.push(...sessions);
    this.state.customers.push(customer);
    this.state.suppliers.push(supplier);
    this.state.items.push(item);
    this.state.warehouses.push(warehouse);
    this.state.approvalWorkflows.push(approvalWorkflow);
  }

  private demoUser(
    companyId: string,
    email: string,
    name: string,
    roles: Role[],
  ): User {
    return {
      id: this.id(),
      email,
      name,
      roles,
      companyIds: [companyId],
      passwordHash: "",
      active: true,
    };
  }
}
