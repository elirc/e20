import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { ERPStore } from "./domain/store.js";
export const fixtureEmails = [
  "system@erp.local",
  "admin@acme.local",
  "sales@acme.local",
  "purchase@acme.local",
  "inventory@acme.local",
  "accounts@acme.local",
  "projects@acme.local",
  "audit@acme.local",
];
export function setup(databasePath: string, credentialPath: string) {
  const passwords = Object.fromEntries(
    fixtureEmails.map((email) => [
      email,
      randomBytes(24).toString("base64url"),
    ]),
  );
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(dirname(credentialPath), { recursive: true });
  // Reserve the credential output first. Never replace either existing file.
  const credentialFile = openSync(credentialPath, "wx", 0o600);
  try {
    closeSync(openSync(databasePath, "wx", 0o600));
    const store = new ERPStore({ databasePath, seedPasswords: passwords });
    store.close();
    writeFileSync(
      credentialFile,
      JSON.stringify(
        {
          warning: "Fictional local accounts. Keep this file private.",
          passwords,
        },
        null,
        2,
      ),
    );
  } finally {
    closeSync(credentialFile);
  }
}
if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("/setup.ts") ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/setup.js")
) {
  const databasePath = resolve(process.env.ERP_DATABASE ?? "data/erp.sqlite");
  const credentialPath = resolve(
    process.env.ERP_CREDENTIALS ?? "data/local-credentials.json",
  );
  try {
    setup(databasePath, credentialPath);
    console.log(
      "Created local ERP database and data/local-credentials.json. Existing files are never replaced.",
    );
  } catch {
    console.error(
      "Setup did not complete. Check existing paths and permissions; existing files were preserved.",
    );
    process.exitCode = 1;
  }
}
