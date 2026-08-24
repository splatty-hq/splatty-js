import { test } from "node:test";
import assert from "node:assert/strict";
import { Scrubber } from "../src/scrubber.js";
import type { EventPayload } from "../src/types.js";
import { buildConfiguration } from "./helpers.js";

function scrub(event: unknown, overrides = {}): EventPayload {
  const config = buildConfiguration(overrides);
  return new Scrubber(config).scrub(event as EventPayload);
}

function eventWithHeaders(headers: Record<string, string>): unknown {
  return { request: { url: "http://example.com/y", method: "GET", headers } };
}

test("filters sensitive headers by default", () => {
  const event = scrub(
    eventWithHeaders({
      Cookie: "session=abc",
      Authorization: "Bearer secret",
      "X-Csrf-Token": "tok",
      "X-Api-Key": "k",
      Accept: "text/html",
      "User-Agent": "curl",
    }),
  );

  const headers = event.request!.headers!;
  assert.equal(headers["Cookie"], "[Filtered]");
  assert.equal(headers["Authorization"], "[Filtered]");
  assert.equal(headers["X-Csrf-Token"], "[Filtered]");
  assert.equal(headers["X-Api-Key"], "[Filtered]");
  assert.equal(headers["Accept"], "text/html");
  assert.equal(headers["User-Agent"], "curl");
});

test("filters lowercased header names too", () => {
  const event = scrub(eventWithHeaders({ cookie: "a=b", authorization: "Bearer x" }));
  assert.equal(event.request!.headers!["cookie"], "[Filtered]");
  assert.equal(event.request!.headers!["authorization"], "[Filtered]");
});

test("passes headers through when sendDefaultPii is enabled", () => {
  const event = scrub(eventWithHeaders({ Cookie: "session=abc" }), {
    sendDefaultPii: true,
  });
  assert.equal(event.request!.headers!["Cookie"], "session=abc");
});

test("tolerates events without a request", () => {
  const payload = { exception: { values: [] } };
  assert.deepEqual(scrub(payload), payload);
});

test("tolerates a request without headers", () => {
  const event = scrub({ request: { url: "http://example.com" } });
  assert.equal(event.request!.url, "http://example.com");
});
