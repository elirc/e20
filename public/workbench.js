const $ = (id) => document.getElementById(id);
const field = (key, label, type = "text", options = {}) => ({
  key,
  label,
  type,
  ...options,
});
const name = field("name", "Name", "text", { required: true, max: 120 });
const code = field("code", "Code", "text", { required: true, max: 80 });
const contact = [
  name,
  code,
  field("contactEmail", "Contact email", "email"),
  field("billingAddress", "Billing address", "textarea"),
  field("status", "Status", "select", {
    values: ["active", "inactive"],
    editOnly: true,
  }),
];
const module = (title, path, fields, read, write, help) => ({
  title,
  path,
  fields,
  read,
  write,
  help,
});
const modules = {
  customers: module(
    "Customers",
    "customers",
    contact,
    ["sales_user", "accounting_user"],
    ["sales_user"],
    "Maintain customer details. Referenced customers stay available for business history.",
  ),
  suppliers: module(
    "Suppliers",
    "suppliers",
    contact,
    ["purchase_user", "accounting_user"],
    ["purchase_user"],
    "Keep supplier codes unique and retain suppliers referenced by purchasing records.",
  ),
  items: module(
    "Items",
    "items",
    [
      field("sku", "SKU", "text", { required: true, max: 80 }),
      name,
      field("description", "Description", "textarea"),
      field("uom", "Unit of measure", "text", { required: true }),
      field("itemGroup", "Item group", "text", { required: true }),
      field("isStockItem", "Track stock", "checkbox", { default: true }),
      field("standardCost", "Standard cost (USD)", "money", {
        required: true,
        default: "0.00",
      }),
      field("salesPrice", "Sales price (USD)", "money", {
        required: true,
        default: "0.00",
      }),
      field("purchasePrice", "Purchase price (USD)", "money", {
        required: true,
        default: "0.00",
      }),
    ],
    ["sales_user", "purchase_user", "inventory_user"],
    ["inventory_user", "purchase_user"],
    "Prices use cents. Existing document costs remain as accepted when an item changes.",
  ),
  warehouses: module(
    "Warehouses",
    "warehouses",
    [name, code],
    ["inventory_user", "purchase_user", "sales_user"],
    ["inventory_user"],
    "Warehouses identify physical stock locations. Ledger history prevents deletion.",
  ),
  leads: module(
    "Leads",
    "crm/leads",
    [
      name,
      field("email", "Email", "email"),
      field("companyName", "Company name"),
      field("source", "Source"),
      field("status", "Status", "select", {
        values: ["open", "qualified", "converted", "lost"],
        editOnly: true,
      }),
    ],
    ["sales_user"],
    ["sales_user"],
    "Capture sales opportunities before creating a customer quotation.",
  ),
  projects: module(
    "Projects",
    "projects",
    [
      name,
      field("customerId", "Customer", "reference", { source: "customers" }),
      field("budgetHours", "Budget hours", "number", { min: 0, max: 1000000 }),
      field("status", "Status", "select", {
        values: ["open", "completed", "cancelled"],
        editOnly: true,
      }),
    ],
    ["project_user"],
    ["project_user"],
    "Group delivery work by customer, then record tasks and time against the project.",
  ),
  tasks: module(
    "Tasks",
    "projects/tasks",
    [
      field("projectId", "Project", "reference", {
        source: "projects",
        required: true,
      }),
      field("title", "Title", "text", { required: true, max: 160 }),
      field("status", "Status", "select", {
        values: ["open", "in_progress", "done"],
      }),
      field("priority", "Priority", "select", {
        values: ["low", "medium", "high"],
        default: "medium",
      }),
      field("assigneeUserId", "Assignee", "reference", { source: "users" }),
      field("dueDate", "Due date", "date"),
    ],
    ["project_user"],
    ["project_user"],
    "Use clear task titles, explicit priorities, and real due dates.",
  ),
  timesheets: module(
    "Timesheets",
    "projects/timesheets",
    [
      field("projectId", "Project", "reference", {
        source: "projects",
        required: true,
      }),
      field("taskId", "Task", "reference", { source: "tasks" }),
      field("userId", "Team member", "reference", {
        source: "users",
        required: true,
      }),
      field("hours", "Hours", "number", { required: true, min: 0.01, max: 24 }),
      field("billable", "Billable", "checkbox", { default: true }),
      field("note", "Note", "textarea"),
      field("workDate", "Work date", "date", { required: true }),
    ],
    ["project_user"],
    ["project_user"],
    "A timesheet task must belong to the selected project. Enter no more than 24 hours per entry.",
  ),
};
let session = null,
  current = "customers",
  rows = [],
  references = {},
  page = 1,
  editor = null,
  busy = false,
  uncertain = false;
const notice = (message, error = false) => {
  $("message").textContent = message;
  $("message").classList.toggle("error", error);
};
const allowed = (roles) =>
  session?.user.roles.some((r) =>
    ["system_admin", "company_admin", "auditor", ...roles].includes(r),
  );
const writable = () =>
  session?.user.roles.some((r) =>
    ["system_admin", "company_admin", ...modules[current].write].includes(r),
  );
function setBusy(value) {
  busy = value;
  document.body.setAttribute("aria-busy", String(value));
  for (const id of ["login-panel", "workspace", "editor-panel"])
    $(id).inert = value;
}
async function api(method, path, body) {
  let response;
  try {
    response = await fetch(`/${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session
          ? {
              Authorization: `Bearer ${session.token}`,
              "x-company-id": session.companyId,
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    const e = new Error(
      "Connection lost. The server may have saved this operation. Check the current record or list before deciding to retry.",
    );
    e.uncertain = method !== "GET";
    throw e;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    const e = new Error(
      "The server response could not be read. Check current data before retrying.",
    );
    e.uncertain = method !== "GET";
    throw e;
  }
  if (!response.ok) {
    const e = new Error(data.error || "Request failed");
    e.status = response.status;
    if (response.status === 401) {
      $("login-panel").hidden = false;
      notice(
        "Session expired. Your draft is still available. Sign in with the same account to continue.",
        true,
      );
    }
    throw e;
  }
  return data;
}
async function run(action) {
  if (busy) return;
  setBusy(true);
  try {
    await action();
  } catch (error) {
    if (error.uncertain) uncertain = true;
    notice(error.message, true);
  } finally {
    setBusy(false);
  }
}
function download(name, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function values() {
  if (!editor) return {};
  const data = {};
  for (const f of modules[current].fields.filter(
    (f) => !f.editOnly || editor.id,
  )) {
    const input = $("fields").querySelector(`[name="${f.key}"]`);
    if (f.type === "checkbox") data[f.key] = input.checked;
    else if (input.value !== "") data[f.key] = input.value;
  }
  return data;
}
function dirty() {
  return editor && JSON.stringify(values()) !== editor.baseline;
}
function canLeave() {
  return (
    !dirty() ||
    confirm(
      "Discard the unsaved draft? Export it first if you want to keep it.",
    )
  );
}
function closeEditor() {
  editor = null;
  uncertain = false;
  $("editor-panel").hidden = true;
}
function render() {
  const m = modules[current];
  $("module-title").textContent = m.title;
  $("module-help").textContent = m.help;
  $("new").hidden = !writable();
  $("navigation").replaceChildren();
  for (const [key, mod] of Object.entries(modules)) {
    if (!allowed(mod.read)) continue;
    const b = document.createElement("button");
    b.textContent = mod.title;
    b.setAttribute("aria-current", key === current ? "page" : "false");
    b.onclick = () =>
      run(async () => {
        if (!canLeave()) return;
        closeEditor();
        current = key;
        page = 1;
        $("search").value = "";
        await load();
      });
    $("navigation").append(b);
  }
  renderRows();
}
function renderRows() {
  const q = $("search").value.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(q),
  );
  page = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  $("count").textContent =
    `${filtered.length} matching records / ${rows.length} total`;
  $("records").replaceChildren();
  for (const r of filtered.slice((page - 1) * 20, page * 20)) {
    const card = document.createElement("article");
    card.className = "record";
    const details = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = r.name || r.title || `${r.workDate} / ${r.hours} hours`;
    const p = document.createElement("p");
    p.textContent = [
      r.code || r.sku || r.priority || "",
      r.status || "",
      `Version ${r.version}`,
    ]
      .filter(Boolean)
      .join(" / ");
    details.append(h, p);
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = writable() ? "Edit" : "View";
    b.setAttribute("aria-label", `${b.textContent} ${h.textContent}`);
    b.onclick = () =>
      run(async () => {
        if (!canLeave()) return;
        await openEditor(r);
      });
    card.append(details, b);
    $("records").append(card);
  }
  if (!filtered.length) {
    const p = document.createElement("p");
    p.textContent =
      "No matching records. Try another search or create a record.";
    $("records").append(p);
  }
  $("page").textContent =
    `Page ${page} of ${Math.max(1, Math.ceil(filtered.length / 20))}`;
  $("previous").disabled = page === 1;
  $("next").disabled = page * 20 >= filtered.length;
}
async function load() {
  rows = await api("GET", modules[current].path);
  render();
}
async function openEditor(record) {
  references = await api("GET", "reference-data");
  editor = {
    id: record?.id,
    version: record?.version,
    userId: session.user.id,
    companyId: session.companyId,
    baseline: "",
  };
  uncertain = false;
  $("fields").replaceChildren();
  for (const f of modules[current].fields.filter(
    (f) => !f.editOnly || editor.id,
  )) {
    const label = document.createElement("label");
    label.textContent = f.label;
    let input;
    if (["select", "reference"].includes(f.type)) {
      input = document.createElement("select");
      if (f.type === "reference") {
        const none = new Option(f.required ? "Choose a record" : "None", "");
        input.add(none);
        for (const r of references[f.source] || [])
          input.add(new Option(r.name, r.id));
      } else for (const value of f.values) input.add(new Option(value, value));
    } else {
      input = document.createElement(
        f.type === "textarea" ? "textarea" : "input",
      );
      if (input.tagName === "INPUT")
        input.type = f.type === "money" ? "text" : f.type;
      if (f.type === "money") {
        input.inputMode = "decimal";
        input.pattern = "[0-9]+([.][0-9]{1,2})?";
      }
      if (f.type === "number") {
        input.min = f.min ?? 0;
        input.max = f.max ?? 1000000;
        input.step = "0.01";
      }
      if (f.type === "date") {
        input.min = "2000-01-01";
        input.max = "2099-12-31";
      }
      input.maxLength = f.max || 2000;
    }
    input.name = f.key;
    input.setAttribute("aria-label", f.label);
    input.required = !!f.required;
    input.disabled = !writable();
    const value =
      record?.[f.key] ?? f.default ?? (f.type === "select" ? f.values[0] : "");
    if (f.type === "checkbox") input.checked = !!value;
    else input.value = String(value);
    label.append(input);
    $("fields").append(label);
  }
  editor.baseline = JSON.stringify(values());
  $("editor-title").textContent = record
    ? `${writable() ? "Edit" : "View"} ${record.name || record.title || "time entry"}`
    : `New ${{ customers: "customer", suppliers: "supplier", items: "item", warehouses: "warehouse", leads: "lead", projects: "project", tasks: "task", timesheets: "timesheet" }[current]}`;
  $("editor-version").textContent = record
    ? `Editing version ${record.version}. A newer version will require review before saving.`
    : "New record. Review the list after an uncertain response before creating again.";
  $("editor-panel").hidden = false;
  $("save").hidden = !writable();
  $("delete").hidden = !record || !writable();
  $("reload-record").hidden = !record;
  $("editor-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("login-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const form = new FormData(e.target);
    const result = await api("POST", "auth/login", {
      email: form.get("email"),
      password: form.get("password"),
    });
    if (editor && editor.userId !== result.user.id) {
      notice(
        "This draft belongs to another account. Export or close the draft before signing in as a different account.",
        true,
      );
      return;
    }
    const previousCompany = editor?.companyId;
    session = {
      ...result,
      companyId: previousCompany || result.companies[0].id,
    };
    if (!result.companies.some((c) => c.id === session.companyId))
      throw new Error(
        "The draft's company is no longer accessible. Export the draft before closing it.",
      );
    $("company").replaceChildren(
      ...result.companies.map((c) => new Option(c.name, c.id)),
    );
    $("company").value = session.companyId;
    $("identity").textContent = result.user.name;
    $("roles").textContent = result.user.roles.join(", ");
    $("workspace").hidden = false;
    $("login-panel").hidden = true;
    e.target.reset();
    if (!allowed(modules[current].read))
      current = Object.keys(modules).find((k) => allowed(modules[k].read));
    await load();
    notice("Signed in. Changes save to your local ERP database.");
  });
};
$("company").onchange = () =>
  run(async () => {
    const desired = $("company").value;
    if (!canLeave()) {
      $("company").value = session.companyId;
      return;
    }
    closeEditor();
    session.companyId = desired;
    rows = [];
    page = 1;
    $("search").value = "";
    await load();
    notice("Company changed. The list now belongs to the selected company.");
  });
$("logout").onclick = () =>
  run(async () => {
    if (!canLeave()) return;
    await api("POST", "auth/logout");
    closeEditor();
    session = null;
    rows = [];
    references = {};
    $("workspace").hidden = true;
    $("login-panel").hidden = false;
    notice("Signed out.");
  });
$("new").onclick = () =>
  run(async () => {
    if (canLeave()) await openEditor(null);
  });
$("close-editor").onclick = () => {
  if (!busy && canLeave()) closeEditor();
};
$("refresh").onclick = () =>
  run(async () => {
    await load();
    notice("List refreshed. Your open draft has not been replaced.");
  });
$("search").oninput = () => {
  page = 1;
  renderRows();
};
$("previous").onclick = () => {
  page--;
  renderRows();
};
$("next").onclick = () => {
  page++;
  renderRows();
};
$("export-records").onclick = () =>
  download(`${current}-export.json`, {
    companyId: session.companyId,
    records: rows,
  });
$("export-draft").onclick = () =>
  download(`${current}-draft.json`, {
    module: current,
    id: editor.id,
    version: editor.version,
    companyId: editor.companyId,
    data: values(),
  });
$("reload-record").onclick = () =>
  run(async () => {
    if (!canLeave()) return;
    const fresh = await api("GET", modules[current].path);
    const record = fresh.find((r) => r.id === editor.id);
    if (!record)
      throw new Error(
        "Record no longer exists. Export the draft before closing it.",
      );
    rows = fresh;
    await openEditor(record);
    renderRows();
    notice("Loaded the current saved record.");
  });
$("editor").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    if (
      !session ||
      session.user.id !== editor.userId ||
      session.companyId !== editor.companyId
    )
      throw new Error("Sign in to the draft's account and company first.");
    if (uncertain) {
      await load();
      if (
        !confirm(
          "The previous response was uncertain. Review the refreshed list for a saved record. Continue only if you have checked that retrying is appropriate.",
        )
      )
        return;
    }
    const data = values();
    for (const f of modules[current].fields) {
      if (data[f.key] !== undefined && ["money", "number"].includes(f.type))
        data[f.key] = Number(data[f.key]);
    }
    const saved = await api(
      editor.id ? "PUT" : "POST",
      `${modules[current].path}${editor.id ? `/${editor.id}` : ""}`,
      editor.id ? { version: editor.version, data } : data,
    );
    closeEditor();
    await load();
    notice(`Saved record at version ${saved.version}.`);
  });
};
$("delete").onclick = () =>
  run(async () => {
    if (
      !confirm(
        "Delete this record? Records referenced by other business data cannot be deleted.",
      )
    )
      return;
    await api("DELETE", `${modules[current].path}/${editor.id}`, {
      version: editor.version,
    });
    closeEditor();
    await load();
    notice("Record deleted.");
  });
window.addEventListener("beforeunload", (e) => {
  if (dirty() || busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
