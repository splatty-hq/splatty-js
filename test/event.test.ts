import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExceptionEvent, buildMessageEvent } from "../src/event.js";
import { buildConfiguration } from "./helpers.js";

const config = buildConfiguration({
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
  assert.ok(value.stacktrace.frames.some((f) => typeof f.lineno === "number"));
  assert.match(event.event_id, /^[a-f0-9]{32}$/);
});

test("buildExceptionEvent attaches source context to frames", () => {
  const error = new Error("boom");
  const event = buildExceptionEvent(error, config, {});
  const frames = event.exception!.values[0]!.stacktrace.frames;
  const frame = frames[frames.length - 1]!;

  assert.match(frame.abs_path ?? "", /event\.test\.ts$/);
  assert.equal(frame.context_line?.trim(), 'const error = new Error("boom");');
  assert.equal(frame.pre_context?.length, 5);
  assert.equal(frame.post_context?.length, 5);
  assert.match(frame.post_context?.[0] ?? "", /buildExceptionEvent\(error, config/);
});

test("contextLines: 0 leaves frames bare", () => {
  const bare = buildConfiguration({
    url: "https://example.com",
    dsn: "test-dsn",
    contextLines: 0,
  });
  const event = buildExceptionEvent(new Error("boom"), bare, {});

  for (const frame of event.exception!.values[0]!.stacktrace.frames) {
    assert.equal(frame.context_line, undefined);
    assert.equal(frame.pre_context, undefined);
    assert.equal(frame.post_context, undefined);
  }
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

test("buildExceptionEvent handles a thrown non-error", () => {
  const event = buildExceptionEvent("just a string", config, {});
  const value = event.exception!.values[0];
  assert.equal(value.type, "NonError");
  assert.equal(value.value, "just a string");
  assert.deepEqual(value.stacktrace.frames, []);
});

test("buildMessageEvent builds a message event", () => {
  const event = buildMessageEvent("hi there", config, "warn", {
    tags: { service: "api" },
  });
  assert.equal(event.level, "warn");
  assert.equal(event.message?.formatted, "hi there");
  assert.deepEqual(event.tags, { service: "api" });
  assert.equal(event.exception, undefined);
});

test("scope request and transaction are passed through", () => {
  const event = buildMessageEvent("x", config, "info", {
    request: { url: "/x", method: "GET" },
    transaction: "GET /x",
  });
  assert.equal(event.request!.url, "/x");
  assert.equal(event.transaction, "GET /x");
});

test("transaction and request are omitted when absent", () => {
  const event = buildMessageEvent("x", config, "info", {});
  assert.equal("transaction" in event, false);
  assert.equal("request" in event, false);
  assert.deepEqual(event.tags, {});
  assert.deepEqual(event.extra, {});
});
