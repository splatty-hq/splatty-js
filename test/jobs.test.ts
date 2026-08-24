import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { encodeArgs, MAX_ARGS_LENGTH } from "../src/jobs.js";
import { captureJobException, instrumentWorker } from "../src/bullmq.js";
import * as splatty from "../src/index.js";
import { startSplatty, stopSplatty } from "./helpers.js";

afterEach(async () => {
  await stopSplatty();
});

test("encodeArgs serializes and truncates", () => {
  assert.equal(encodeArgs(null), null);
  assert.equal(encodeArgs(undefined), null);
  assert.equal(encodeArgs([1, "two"]), '[1,"two"]');

  const encoded = encodeArgs(["x".repeat(4000)])!;
  assert.equal(encoded.length, MAX_ARGS_LENGTH + "...(truncated)".length);
  assert.ok(encoded.endsWith("...(truncated)"));
});

test("encodeArgs returns null for unserializable input", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic["self"] = cyclic;
  assert.equal(encodeArgs(cyclic), null);
});

test("captureJobException tags the backend and job context", async () => {
  const harness = await startSplatty();
  await captureJobException(new Error("boom"), {
    backend: "bullmq",
    jobClass: "Billing::UsageSweep",
    queue: "low",
    jobId: "42",
    attempts: 3,
    args: [1, "two"],
  });

  const event = harness.events[0];
  assert.equal(event.exception!.values[0].type, "Error");
  assert.equal(event.tags["job_backend"], "bullmq");
  assert.equal(event.tags["job_class"], "Billing::UsageSweep");
  assert.equal(event.tags["job_queue"], "low");
  assert.equal(event.transaction, "Billing::UsageSweep");
  assert.equal(event.extra["job_id"], "42");
  assert.equal(event.extra["job_attempts"], 3);
  assert.equal(event.extra["job_args"], '[1,"two"]');
});

test("captureJobException copes with a failure that carries no job", async () => {
  const harness = await startSplatty();
  await captureJobException(new Error("boom"), { backend: "bullmq" });

  const event = harness.events[0];
  assert.equal(event.tags["job_backend"], "bullmq");
  assert.equal("job_class" in event.tags, false);
  assert.equal("transaction" in event, false);
});

test("captureJobException reports an exception only once", async () => {
  const harness = await startSplatty();
  const err = new Error("boom");
  await captureJobException(err, { backend: "bullmq" });
  await captureJobException(err, { backend: "bullmq" });
  assert.equal(harness.events.length, 1);
});

function fakeWorker() {
  const worker = new EventEmitter() as EventEmitter & { name: string };
  worker.name = "default";
  return worker;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("instrumentWorker captures an exhausted job", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  instrumentWorker(worker);

  worker.emit(
    "failed",
    {
      id: "j-1",
      name: "SendEmail",
      queueName: "mailers",
      data: { to: "x@example.com" },
      opts: { attempts: 3 },
      attemptsMade: 3,
    },
    new Error("smtp down"),
  );
  await settle();

  assert.equal(harness.events.length, 1);
  const event = harness.events[0];
  assert.equal(event.tags["job_backend"], "bullmq");
  assert.equal(event.tags["job_class"], "SendEmail");
  assert.equal(event.tags["job_queue"], "mailers");
  assert.equal(event.transaction, "SendEmail");
  assert.equal(event.extra["job_id"], "j-1");
  assert.equal(event.extra["job_attempts"], 3);
  assert.equal(event.extra["job_args"], '{"to":"x@example.com"}');
});

test("instrumentWorker stays quiet while retries remain", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  instrumentWorker(worker);

  worker.emit(
    "failed",
    { id: "j-2", name: "SendEmail", opts: { attempts: 3 }, attemptsMade: 1 },
    new Error("will retry"),
  );
  await settle();
  assert.equal(harness.events.length, 0);
});

test("instrumentWorker can report every attempt", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  instrumentWorker(worker, { captureRetries: true });

  worker.emit(
    "failed",
    { id: "j-3", name: "SendEmail", opts: { attempts: 3 }, attemptsMade: 1 },
    new Error("will retry"),
  );
  await settle();
  assert.equal(harness.events.length, 1);
});

test("instrumentWorker captures worker-level errors", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  instrumentWorker(worker);

  worker.emit("error", new Error("redis gone"));
  await settle();

  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].tags["job_backend"], "bullmq");
  assert.equal(harness.events[0].tags["job_queue"], "default");
});

test("the returned teardown detaches the listeners", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  const uninstall = instrumentWorker(worker);
  uninstall();
  // An EventEmitter with no "error" listener rethrows the emitted error.
  worker.on("error", () => {});

  worker.emit("error", new Error("redis gone"));
  await settle();
  assert.equal(harness.events.length, 0);
  assert.equal(worker.listenerCount("failed"), 0);
  assert.equal(worker.listenerCount("error"), 1);
});

test("a job failure already reported elsewhere is not duplicated", async () => {
  const harness = await startSplatty();
  const worker = fakeWorker();
  instrumentWorker(worker);

  const err = new Error("boom");
  await splatty.captureException(err, { tags: { job_backend: "bullmq" } });
  worker.emit("failed", { id: "j-4", opts: { attempts: 1 }, attemptsMade: 1 }, err);
  await settle();

  assert.equal(harness.events.length, 1);
});
