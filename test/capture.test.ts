import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as splatty from "../src/index.js";
import { startSplatty, stopSplatty } from "./helpers.js";

afterEach(async () => {
  await stopSplatty();
});

test("reports an exception only once", async () => {
  const harness = await startSplatty();
  const err = new Error("boom");
  const first = await splatty.captureException(err);
  const second = await splatty.captureException(err);

  assert.equal(typeof first, "string");
  assert.equal(second, null);
  assert.equal(harness.events.length, 1);
});

test("distinct exception objects are both reported", async () => {
  const harness = await startSplatty();
  await splatty.captureException(new Error("boom"));
  await splatty.captureException(new Error("boom"));
  assert.equal(harness.events.length, 2);
});

test("captureMessage is not deduplicated", async () => {
  const harness = await startSplatty();
  await splatty.captureMessage("hello", { level: "info" });
  await splatty.captureMessage("hello", { level: "info" });
  assert.equal(harness.events.length, 2);
  assert.equal(harness.events[0].message!.formatted, "hello");
  assert.equal(harness.events[0].level, "info");
});

test("does nothing when disabled", async () => {
  const harness = await startSplatty({ enabled: false });
  assert.equal(splatty.enabled(), false);
  assert.equal(await splatty.captureException(new Error("boom")), null);
  assert.equal(await splatty.captureMessage("hi"), null);
  assert.equal(harness.events.length, 0);
});

test("does nothing once closed", async () => {
  const harness = await startSplatty();
  await stopSplatty();
  assert.equal(await splatty.captureException(new Error("boom")), null);
  assert.equal(harness.events.length, 0);
});

test("beforeSend can drop an event", async () => {
  const harness = await startSplatty({ beforeSend: () => null });
  assert.equal(await splatty.captureException(new Error("boom")), null);
  assert.equal(harness.events.length, 0);
});

test("beforeSend can mutate an event", async () => {
  const harness = await startSplatty({
    beforeSend: (event) => {
      event.tags["mutated"] = "yes";
      return event;
    },
  });
  await splatty.captureException(new Error("boom"));
  assert.equal(harness.events[0].tags["mutated"], "yes");
});

test("init accepts a configure block", async () => {
  await stopSplatty();
  splatty.init((config) => {
    config.url = "http://block.example";
    config.dsn = "block-dsn";
    config.environment = "blocktest";
    config.logs = false;
  });
  assert.equal(splatty.enabled(), true);
  assert.equal(splatty.configuration()!.environment, "blocktest");
  assert.equal(splatty.configuration()!.envelopeUrl(), "http://block.example/api/envelope");
});
