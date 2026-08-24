import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { splattyStream } from "../src/pino.js";
import { SplattyTransport } from "../src/winston.js";
import { installConsoleCapture, uninstallConsoleCapture } from "../src/console.js";
import * as splatty from "../src/index.js";
import { startSplatty, stopSplatty } from "./helpers.js";

afterEach(async () => {
  uninstallConsoleCapture();
  await stopSplatty();
});

const logOptions = { flushIntervalMs: 0, host: "h" };

test("the pino stream forwards a line", async () => {
  const harness = await startSplatty({ logs: true, logOptions });
  const stream = splattyStream();
  stream.write(
    `${JSON.stringify({
      level: 50,
      time: 1750000000000,
      msg: "kaboom",
      pid: 1,
      hostname: "ignored",
      req_id: "r-1",
    })}\n`,
  );
  await splatty.close();

  const entry = harness.logBatches[0].logs[0];
  assert.equal(entry.level, "error");
  assert.equal(entry.message, "kaboom");
  assert.equal(entry.timestamp, 1750000000000);
  assert.equal(entry.fields["req_id"], "r-1");
  assert.equal("pid" in entry.fields, false);
  assert.equal("hostname" in entry.fields, false);
});

test("the pino stream ignores malformed lines", async () => {
  await startSplatty({ logs: true, logOptions });
  const stream = splattyStream();
  assert.doesNotThrow(() => stream.write("not json\n"));
  assert.equal(splatty.logAppender()!.size, 0);
});

test("the winston transport forwards an entry", async () => {
  const harness = await startSplatty({ logs: true, logOptions });
  const transport = new SplattyTransport();
  transport.log({
    level: "warn",
    message: "watch out",
    timestamp: "2026-06-17T12:00:00Z",
    tenant: "acme",
    [Symbol.for("level")]: "warn",
  } as never);
  await splatty.close();

  const entry = harness.logBatches[0].logs[0];
  assert.equal(entry.level, "warn");
  assert.equal(entry.message, "watch out");
  assert.equal(entry.timestamp, Date.parse("2026-06-17T12:00:00Z"));
  assert.equal(entry.fields["tenant"], "acme");
});

test("console capture forwards and still prints", async () => {
  const harness = await startSplatty({ logs: true, logOptions });
  const printed: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    printed.push(String(args[0]));
  };

  installConsoleCapture({ methods: ["warn"] });
  console.warn("disk %s%% full", 91);
  uninstallConsoleCapture();
  console.warn = original;

  await splatty.close();

  assert.deepEqual(printed, ["disk %s%% full"]);
  const entry = harness.logBatches[0].logs[0];
  assert.equal(entry.level, "warn");
  assert.equal(entry.message, "disk 91% full");
  assert.equal(entry.fields["logger"], "console");
});

test("captureConsole wires console capture through init", async () => {
  const original = console.info;
  console.info = () => {};
  const harness = await startSplatty({ logs: true, logOptions, captureConsole: true });

  console.info("hello from console");
  await splatty.close();
  console.info = original;

  assert.equal(harness.logBatches[0].logs[0].message, "hello from console");
});

test("close() removes the console patch", async () => {
  const original = console.info;
  console.info = () => {};
  await startSplatty({ logs: true, logOptions, captureConsole: true });
  const patched = console.info;

  await splatty.close();
  assert.notEqual(console.info, patched);
  console.info = original;
});
