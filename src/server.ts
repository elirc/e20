import { resolve } from "node:path";
import { buildApp } from "./app.js";
const port = Number(process.env.PORT ?? 5182);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be 1024-65535");
const app = buildApp({
  databasePath: resolve(process.env.ERP_DATABASE ?? "data/erp.sqlite"),
});
const close = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`ERP workbench: http://127.0.0.1:${port}`);
} catch {
  console.error(
    "ERP could not start; check setup, database access, and the port",
  );
  await app.close();
  process.exitCode = 1;
}
