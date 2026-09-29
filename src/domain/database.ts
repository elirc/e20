import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import type { ERPState } from "./models.js";
import { MAX_BYTES, validateState } from "./state-schema.js";
export class SnapshotDatabase {
  private db: DatabaseSync;
  constructor(path: string, allowInitialize = false) {
    if (path !== ":memory:" && !existsSync(path))
      throw new Error("Database not found; run explicit setup first");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    try {
      const table = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'",
        )
        .get();
      if (!table && !allowInitialize)
        throw new Error(
          "ERP workspace schema not found; existing database preserved",
        );
      if (!table)
        this.db.exec(
          "CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version=1), revision INTEGER NOT NULL CHECK(revision>=0), body TEXT NOT NULL) STRICT",
        );
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE;",
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  get initialized() {
    return !!this.db.prepare("SELECT id FROM workspace WHERE id=1").get();
  }
  initialize(state: ERPState) {
    const valid = validateState(state);
    this.db
      .prepare(
        "INSERT INTO workspace(id,schema_version,revision,body) VALUES(1,1,0,?)",
      )
      .run(JSON.stringify(valid));
  }
  access<T>(write: boolean, operation: (state: ERPState) => T): T {
    this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const row = this.db
        .prepare(
          "SELECT schema_version,revision,length(CAST(body AS BLOB)) AS bytes FROM workspace WHERE id=1",
        )
        .get();
      if (!row || row.schema_version !== 1 || Number(row.bytes) > MAX_BYTES)
        throw new Error(
          "Unsupported or oversized workspace; original data preserved",
        );
      const body = this.db
        .prepare("SELECT body FROM workspace WHERE id=1")
        .get()!.body as string;
      let state: ERPState;
      try {
        state = validateState(JSON.parse(body));
      } catch {
        throw new Error("Stored workspace is invalid; original data preserved");
      }
      const result = operation(state);
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new Error("Async transaction callback is unsupported");
      if (write) {
        const validated = JSON.stringify(validateState(state));
        if (validated !== body)
          this.db
            .prepare(
              "UPDATE workspace SET body=?,revision=revision+1 WHERE id=1",
            )
            .run(validated);
      } else if (JSON.stringify(state) !== body)
        throw new Error("Read handler attempted to mutate state");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
