import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as splatty from "../src/index.js";
import { LogAppender } from "../src/log-appender.js";
import { startSplatty, stopSplatty } from "./helpers.js";

afterEach(async () => {
  await stopSplatty();
});

test("enqueues and dispatches log entries", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({
    level: "info",
    batchSize: 10,
    flushIntervalMs: 0,
    host: "h-1",
  });

  assert.equal(
    appender.log({
      time: new Date("2026-06-17T12:00:00Z"),
      level: "info",
      message: "hi",
      fields: {
        request_id: "rid",
        method: "GET",
        path: "/x",
        status: 200,
        duration_ms: 1.5,
        user: "u",
      },
    }),
    true,
  );

  await appender.close();

  assert.equal(harness.logBatches.length, 1);
  const batch = harness.logBatches[0];
  assert.equal(batch.host, "h-1");
  const entry = batch.logs[0];
  assert.equal(entry.message, "hi");
  assert.equal(entry.level, "info");
  assert.equal(entry.request_id, "rid");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/x");
  assert.equal(entry.status, 200);
  assert.equal(entry.duration_ms, 1.5);
  assert.equal(entry.environment, "test");
  assert.equal(entry.timestamp, Date.parse("2026-06-17T12:00:00Z"));
  assert.deepEqual(Object.keys(entry.fields), ["user"]);
});

test("skips when splatty is disabled", async () => {
  await stopSplatty();
  const appender = new LogAppender({ flushIntervalMs: 0 });
  assert.equal(appender.log({ level: "info", message: "hi" }), false);
  await appender.close();
});

test("drops logs about splatty intake paths", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({ flushIntervalMs: 0, host: "h" });

  for (const path of ["/api/4/logs", "/api/42/metrics", "/api/1/envelope/", "/api/envelope"]) {
    assert.equal(
      appender.log({
        level: "info",
        message: `Completed POST ${path}`,
        fields: { path, method: "POST", status: 202 },
      }),
      false,
      `expected ${path} to be dropped`,
    );
  }

  assert.equal(
    appender.log({
      level: "info",
      message: "real customer request",
      fields: { path: "/users/42", method: "GET", status: 200 },
    }),
    true,
  );

  await appender.close();
  assert.equal(harness.logBatches[0].logs.length, 1);
  assert.equal(harness.logBatches[0].logs[0].path, "/users/42");
});

test("inlines sql into the message", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({ flushIntervalMs: 0, host: "h" });
  appender.log({ level: "debug", message: "Load", fields: { sql: "SELECT 1" } });
  appender.log({ level: "debug", message: "", fields: { sql: "SELECT 2" } });
  await appender.close();

  const logs = harness.logBatches[0].logs;
  assert.equal(logs[0].message, "Load — SELECT 1");
  assert.equal(logs[1].message, "SELECT 2");
});

test("honours the minimum level", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({ level: "warn", flushIntervalMs: 0, host: "h" });
  assert.equal(appender.log({ level: "info", message: "quiet" }), false);
  assert.equal(appender.log({ level: "error", message: "loud" }), true);
  await appender.close();
  assert.equal(harness.logBatches[0].logs.length, 1);
  assert.equal(harness.logBatches[0].logs[0].message, "loud");
});

test("drops the oldest entry once the queue limit is hit", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({
    flushIntervalMs: 0,
    batchSize: 1000,
    queueLimit: 2,
    host: "h",
  });
  appender.log({ level: "info", message: "one" });
  appender.log({ level: "info", message: "two" });
  appender.log({ level: "info", message: "three" });
  await appender.close();

  const messages = harness.logBatches.flatMap((b) => b.logs.map((l) => l.message));
  assert.deepEqual(messages, ["two", "three"]);
});

test("init installs an appender that close() flushes", async () => {
  const harness = await startSplatty({ logs: true, logOptions: { flushIntervalMs: 0, host: "h" } });
  assert.ok(splatty.logAppender());
  assert.equal(splatty.captureLog({ level: "info", message: "through the global appender" }), true);
  await splatty.close();

  assert.equal(harness.logBatches.length, 1);
  assert.equal(harness.logBatches[0].logs[0].message, "through the global appender");
  assert.equal(splatty.logAppender(), null);
});

test("no appender is installed when logs are off", async () => {
  await startSplatty({ logs: false });
  assert.equal(splatty.logAppender(), null);
  assert.equal(splatty.captureLog({ level: "info", message: "dropped" }), false);
});

test("the interval timer ships batches on its own", async () => {
  const harness = await startSplatty();
  const appender = new LogAppender({ flushIntervalMs: 10, batchSize: 1000, host: "h" });
  appender.log({ level: "info", message: "tick" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(harness.logBatches.length, 1);
  await appender.close();
});
