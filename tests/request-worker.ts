import { buildApp } from "../src/app.js";
process.send?.({ ready: true });
process.once(
  "message",
  async (job: {
    path: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: unknown;
  }) => {
    const app = buildApp({ databasePath: job.path });
    try {
      const response = await app.inject({
        method: job.method as "POST",
        url: job.url,
        headers: job.headers,
        payload: job.payload as object,
      });
      process.send?.({ status: response.statusCode, body: response.json() });
    } catch {
      process.send?.({ status: 500 });
    } finally {
      await app.close();
      process.disconnect?.();
    }
  },
);
