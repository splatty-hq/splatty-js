import { test } from "node:test";
import assert from "node:assert/strict";
import { Configuration } from "../src/configuration";
import { buildExceptionEvent, buildMessageEvent } from "../src/event";

const config = new Configuration({
  url: "https://example.com",
  dsn: "test-dsn",
  environment: "test",
  release: "v1",
});

test("buildExceptionEvent captures error type, message and frames", () => {
  function thrower() {
    throw new Error("boom");
  }
  let caught: unknown;
  try {
    thrower();
  } catch (e) {
    caught = e;
  }
  const event = buildExceptionEvent(caught, config, {});
  assert.equal(event.level, "error");
  assert.equal(event.platform, "node");
  assert.equal(event.environment, "test");
  assert.equal(event.release, "v1");
  assert.ok(event.exception);
  const value = event.exception!.values[0];
  assert.equal(value.type, "Error");
  assert.equal(value.value, "boom");
  assert.ok(value.stacktrace.frames.length > 0);
  assert.equal(typeof event.event_id, "string");
  assert.equal(event.event_id.length, 32);
});

test("buildExceptionEvent walks cause chain", () => {
  const root = new Error("root");
  const wrapped = new Error("wrapped", { cause: root });
  const event = buildExceptionEvent(wrapped, config, {});
  const values = event.exception!.values;
  assert.equal(values.length, 2);
  assert.equal(values[0].value, "root");
  assert.equal(values[1].value, "wrapped");
});

test("buildMessageEvent builds an info message", () => {
  const event = buildMessageEvent("hi there", config, "warn", {
    tags: { service: "api" },
  });
  assert.equal(event.level, "warn");
  assert.equal(event.message?.formatted, "hi there");
  assert.deepEqual(event.tags, { service: "api" });
  assert.equal(event.exception, undefined);
});

test("Configuration.validate requires dsn", () => {
  const c = new Configuration({ url: "https://x.test" });
  c.dsn = undefined;
  assert.throws(() => c.validate(), /dsn is required/);
});

test("Configuration.envelopeUrl strips trailing slash", () => {
  const c = new Configuration({ url: "https://x.test/", dsn: "k" });
  assert.equal(c.envelopeUrl(), "https://x.test/api/envelope");
});
