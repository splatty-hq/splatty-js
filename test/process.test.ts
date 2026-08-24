import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  installProcessHandlers,
  uninstallProcessHandlers,
} from "../src/process.js";
import { startSplatty, stopSplatty } from "./helpers.js";

afterEach(async () => {
  uninstallProcessHandlers();
  await stopSplatty();
});

type AnyListener = (...args: unknown[]) => void;

function listeners(event: string): AnyListener[] {
  return (process as unknown as { listeners(e: string): AnyListener[] }).listeners(event);
}

/**
 * Installs the handlers and hands back the listener that was just registered.
 * Invoking it directly keeps the real `process.emit` — and node:test's own
 * crash reporting — out of the way.
 */
function installAndGrab(event: string): AnyListener {
  const before = listeners(event);
  installProcessHandlers({ exit: false });
  const added = listeners(event).find((l) => !before.includes(l));
  assert.ok(added, `expected a ${event} listener to be registered`);
  return added;
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("reports an uncaught exception", async () => {
  const harness = await startSplatty();
  const listener = installAndGrab("uncaughtException");

  listener(new Error("crash"));
  await settle();

  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].level, "fatal");
  assert.equal(harness.events[0].tags["mechanism"], "uncaughtException");
  assert.equal(harness.events[0].exception!.values[0].value, "crash");
});

test("reports an unhandled rejection", async () => {
  const harness = await startSplatty();
  const listener = installAndGrab("unhandledRejection");

  listener(new Error("nope"), Promise.resolve());
  await settle();

  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].level, "error");
  assert.equal(harness.events[0].tags["mechanism"], "unhandledRejection");
});

test("installing twice adds one set of listeners", async () => {
  await startSplatty();
  const before = listeners("uncaughtException").length;
  const beforeRejections = listeners("unhandledRejection").length;
  installProcessHandlers({ exit: false });
  installProcessHandlers({ exit: false });
  assert.equal(listeners("uncaughtException").length, before + 1);
  assert.equal(listeners("unhandledRejection").length, beforeRejections + 1);

  uninstallProcessHandlers();
  assert.equal(listeners("uncaughtException").length, before);
  assert.equal(listeners("unhandledRejection").length, beforeRejections);
});

test("does nothing once closed", async () => {
  const harness = await startSplatty();
  const listener = installAndGrab("uncaughtException");
  await stopSplatty();

  listener(new Error("crash"));
  await settle();
  assert.equal(harness.events.length, 0);
});

test("captureUnhandled installs the handlers through init", async () => {
  const before = listeners("uncaughtException").length;
  await startSplatty({ captureUnhandled: true });
  assert.equal(listeners("uncaughtException").length, before + 1);

  await stopSplatty();
  assert.equal(listeners("uncaughtException").length, before);
});
